import { clampFixed, distSqFixed, dotFixed, fixedAdd, fixedMul, fixedSub, toFixed, vZero, ZERO_FIXED } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { Direction8, type ButtonState } from '../input/types';
import { teamDefendsNorth, type Half } from './formations';
import type { BallState, PlayerState } from './state';
import { quantizeToDirection8 } from './steering';
import {
  CATCH_MAX_SPEED_FIXED,
  CATCH_RANGE_SQ_FIXED,
  GK_AUTO_TAKEOVER_RADIUS_SQ_FIXED,
  GK_COVERAGE_RADIUS_FIXED,
  GK_SAVE_RANGE_SQ_FIXED,
  GOAL_CENTER_X_FIXED,
  PUNCH_DEFLECT_DAMPING_FIXED,
  PUNCH_POP_Z_VEL_FIXED,
  PUNCH_RANGE_SQ_FIXED,
} from './goalkeeperConstants';

const GOAL_CENTER_X: Fixed = GOAL_CENTER_X_FIXED;
// デッドゾーンは GK の1tick移動量 (GK_AUTO_SPEED=2.2px) より大きくすること。
// バグ修正 (観戦シミュレーターの振動検出で発覚): 旧値0.5pxは移動量2.2pxより小さく、
// GKが目標x座標を毎tick跨ぎ越して±2.2pxを永久に往復するジッターを構造的に起こしていた
// (0にできない理由は従来どおり: 差ベクトル(0,0)がデッドゾーン判定を素通りしUpへ
// フォールバックする既知の回帰があるため)。
const AI_STEER_DEADZONE_SQ: Fixed = fixedMul(toFixed(2.5), toFixed(2.5));

/** ボールx座標の追従グリッド (px)。GKの1tick移動量(2.2px)より大きい8px単位に量子化する。 */
const GK_TRACK_GRID_FIXED: Fixed = toFixed(8);

/**
 * キーパーの自動ステアリング目標位置。ゴールライン上、ボールのx位置に追従しつつ
 * GK_COVERAGE_RADIUS でクランプする。y座標はフォーメーションのホームy (homeY) へ戻る。
 *
 * バグ修正 (観戦シミュレーターで発覚): 旧実装は y に gk.pos.y (現在位置) を使っており、
 * GKがセーブやボール確保後のドリブルでゴール前から動いた場合、二度と定位置に戻らず
 * ゴールががら空きのままになる不具合があった。homeY は呼び出し側がフォーメーションから
 * 毎tick導出して渡す (「derive、cacheしない」方針)。
 *
 * ボールxは8pxグリッドに量子化してから使う (観戦シミュレーターの振動検出で発覚した
 * ジッターの修正: 生のボールxを追うと、ボールの毎tickの微小な横揺れにGKが延々と
 * シャッフルし続ける。グリッド1つぶんボールが動いた時だけGKが動けば十分)。
 */
export function computeGoalkeeperTargetPos(gk: PlayerState, ballPos: Vec2Fixed, homeY?: Fixed): Vec2Fixed {
  const grid = GK_TRACK_GRID_FIXED as number;
  const quantizedBallX = (Math.floor((ballPos.x as number) / grid) * grid) as Fixed;
  const targetX = clampFixed(
    quantizedBallX,
    fixedSub(GOAL_CENTER_X, GK_COVERAGE_RADIUS_FIXED),
    fixedAdd(GOAL_CENTER_X, GK_COVERAGE_RADIUS_FIXED),
  );
  return { x: targetX, y: homeY ?? gk.pos.y };
}

/**
 * 自動モード (人間が操作していない側のGK) の1tickぶんの操作方向。
 * 「反応速度」は呼び出し側 (sim/update.ts) が GK_AUTO_SPEED_FIXED を使って
 * 通常より遅い速度でこの方向へ動かすことで表現する (パラメータ化された反応速度)。
 */
export function computeGoalkeeperAutoDirection(gk: PlayerState, ballPos: Vec2Fixed, homeY?: Fixed): Direction8 {
  const target = computeGoalkeeperTargetPos(gk, ballPos, homeY);
  const toTarget = { x: fixedSub(target.x, gk.pos.x), y: fixedSub(target.y, gk.pos.y) };
  return quantizeToDirection8(toTarget, AI_STEER_DEADZONE_SQ);
}

/**
 * Team A GK への自動交代 (手動操作の乗っ取り) が発生すべきか。
 * ボールが近づいた場合、または L を押し続けていて Team A がボールを保持していない場合。
 * 呼び出し側 (sim/update.ts) で「操作選手がキック溜め中/タックル中はガードする」を担う。
 */
export function shouldTakeOverGoalkeeper(
  goalkeeper: PlayerState,
  ballPos: Vec2Fixed,
  buttons: ButtonState,
  teamAInPossession: boolean,
): boolean {
  /**
   * ★18周目に削除: 「Lボタンでキーパーへ交代」★
   *
   * 12周目までの仮実装で L に割り当てていたが、公式仕様のどこにも存在しない当プロジェクト
   * 独自の割り当てだった (公式はGKのAUTO/MANUALを試合前に選ぶ方式)。しかも L/R は
   * シフトキック・蹴り出しドリブル(L+R)・パスカーソル切替に使うため、実プレイで正面衝突する:
   * 蹴り出しドリブル中に保持判定が一瞬揺れるたびカーソルがキーパーへ飛び、
   * **ドリブルが1tickおきに中断されてボールを置き去りにする**のを実ブラウザで実測した
   * (controlled が 9↔0 で毎tick入れ替わるトレースを取得)。
   * ボール接近による自動交代のみを残す。
   */
  void buttons;
  void teamAInPossession;
  return (distSqFixed(goalkeeper.pos, ballPos) as number) <= (GK_AUTO_TAKEOVER_RADIUS_SQ_FIXED as number);
}

/** ボールがキーパーのセーブ文脈 (Y=キャッチ/B=パンチング) に入る範囲内か。 */
export function isInSaveRange(goalkeeper: PlayerState, ballPos: Vec2Fixed): boolean {
  return (distSqFixed(goalkeeper.pos, ballPos) as number) <= (GK_SAVE_RANGE_SQ_FIXED as number);
}

/**
 * そのボールが「このキーパーの自陣ゴールへ向かってきている」か。
 *
 * ★バグ修正 (実プレイ報告「キーパーはキャッチしない」の主因の一つ)★
 * 旧実装の自動GKは「ボール速度 > 4.5px/tick」だけを反応条件にしていた。転がり摩擦で
 * 減速して到達したシュート(遠目からのシュートは到達時に4.5を割る)を**セーブ対象として
 * 認識すらせず素通りさせていた**。かといって速度条件を単純に外すと、GK自身が足元に
 * 収めた/ドリブルしているボールを毎tickキャッチし直して固まる既知のデッドロックが
 * 再発する (goalkeeperConstants.ts の SAVE_CONTEXT_MIN_BALL_SPEED_FIXED のコメント参照)。
 *
 * そこで速度の大小ではなく「自陣ゴール方向へ動いているか」という向きで判定する。
 * 静止球・GK自身が前へ運んでいる球は自陣方向ではないので対象外になり、デッドロックを
 * 構造的に避けたまま、遅く到達したシュートにもきちんと反応できる。
 */
export function isBallApproachingOwnGoal(goalkeeper: PlayerState, ball: BallState, half: Half): boolean {
  const towardOwnGoalIsNegativeY = teamDefendsNorth(goalkeeper.team, half);
  const velY = ball.vel.y as number;
  if (velY === 0) return false;
  return towardOwnGoalIsNegativeY ? velY < 0 : velY > 0;
}

export type SaveOutcome = 'secured' | 'deflected' | 'missed';

/**
 * セーブ判定 (純関数)。CLAUDE.mdの「確実に届くならY、ギリギリならB、
 * ただしBのこぼれ球は詰められるリスク」に対応:
 * - キャッチ(Y): CATCH_RANGE以内 かつ 速度がCATCH_MAX_SPEED以下 -> 確保 (secured)。
 *   範囲内だが速すぎる -> 弾く (deflected、パンチングと同じ扱い)。範囲外 -> 届かない (missed)。
 * - パンチング(B): PUNCH_RANGE以内なら常に弾く (deflected)。範囲外 -> 届かない (missed)。
 */
export function resolveSaveOutcome(
  goalkeeper: PlayerState,
  ball: BallState,
  action: 'catch' | 'punch',
): SaveOutcome {
  const distSq = distSqFixed(goalkeeper.pos, ball.pos) as number;

  if (action === 'catch') {
    if (distSq > (CATCH_RANGE_SQ_FIXED as number)) return 'missed';
    const speedSq = dotFixed(ball.vel, ball.vel) as number;
    const maxSpeedSq = fixedMul(CATCH_MAX_SPEED_FIXED, CATCH_MAX_SPEED_FIXED) as number;
    return speedSq <= maxSpeedSq ? 'secured' : 'deflected';
  }

  return distSq <= (PUNCH_RANGE_SQ_FIXED as number) ? 'deflected' : 'missed';
}

/**
 * セーブの結果をボールに適用する。
 * secured: キーパーの位置で確保 (速度0、地面に静止)。
 * deflected: 自陣ゴールから遠ざける向きへy速度の符号を強制し、★浮き球のこぼれ球★にする。
 *   RNGは使わず、符号を強制するだけの決定論的な跳ね返り。x速度は維持する。
 *
 * ★24周目-6 (台帳L-05)★ 旧実装のdeflectedは「地上のままy符号反転」で、見た目は
 * 「ボールが勝手に反転した」ようにしか見えず、キャッチと弾きの区別が付かなかった。
 * 原作 (t=144.2-145.6) のパンチングは弾いたボールが前方へ浮いて飛び、こぼれ球の
 * 詰め合いが発生する。水平速度を減衰させつつ (強シュートがそのままの速度で戻ると
 * 誰も追いつけない)、上向きの垂直速度で「弾いた」ことを見せる。
 */
export function applySave(
  ball: BallState,
  goalkeeper: PlayerState,
  outcome: SaveOutcome,
  half: Half,
): BallState {
  if (outcome === 'missed') return ball;

  if (outcome === 'secured') {
    return { pos: goalkeeper.pos, vel: vZero(), height: ZERO_FIXED, zVel: ZERO_FIXED };
  }

  const magnitude = Math.abs(fixedMul(ball.vel.y, PUNCH_DEFLECT_DAMPING_FIXED) as number);
  // 北(y=0側)を守るチームは自陣から遠ざけるには+y、南を守るチームは-y。
  const sign = teamDefendsNorth(goalkeeper.team, half) ? 1 : -1;
  const deflectedVelY = (sign * magnitude) as Fixed;
  const deflectedVelX = fixedMul(ball.vel.x, PUNCH_DEFLECT_DAMPING_FIXED);

  return {
    ...ball,
    vel: { x: deflectedVelX, y: deflectedVelY },
    height: ZERO_FIXED,
    zVel: PUNCH_POP_Z_VEL_FIXED,
  };
}
