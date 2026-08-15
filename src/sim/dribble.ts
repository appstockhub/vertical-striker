import { dotFixed, fixedAdd, fixedMul, fixedSub, toFixed, vAdd, vScaleFixed, vSub, ZERO_FIXED } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { Direction8, type ButtonState } from '../input/types';
import type { BallState } from './state';
import { DIRECTION_VECTORS } from './constants';
import { quantizeToDirection8 } from './steering';
import {
  DRIBBLE_CONTACT_RADIUS_SQ_FIXED,
  DRIBBLE_KEEP_SPEED_FIXED,
  DRIBBLE_RADIUS_SQ_FIXED,
  DRIBBLE_TOUCH_MAX_HEIGHT_FIXED,
  DRIBBLE_FOLLOW_DISTANCE_FIXED,
  DRIBBLE_FOLLOW_GAIN_FIXED,
  DRIBBLE_FOLLOW_MAX_SPEED_FIXED,
  DRIBBLE_HANDS_OFF_SPEED_FIXED,
  DRIBBLE_TOUCH_SPEED_FIXED,
  KICK_DRIBBLE_FOLLOW_DISTANCE_FIXED,
  KICK_DRIBBLE_FOLLOW_MAX_SPEED_FIXED,
  LONG_DRIBBLE_TOUCH_SPEED_FIXED,
} from './ballConstants';

/**
 * プレイヤーがそのボールを「プレーできる」間合いにあるかどうか (tick開始時点の位置で判定)。
 * sqrt を使わず、距離の二乗をしきい値の二乗と比較する。
 */
export function isNearBall(playerPos: Vec2Fixed, ballPos: Vec2Fixed): boolean {
  const dx = fixedSub(ballPos.x, playerPos.x);
  const dy = fixedSub(ballPos.y, playerPos.y);
  const distSq = fixedAdd(fixedMul(dx, dx), fixedMul(dy, dy));
  return (distSq as number) <= (DRIBBLE_RADIUS_SQ_FIXED as number);
}

/**
 * 実際に足が当たって蹴り出す接触距離にあるか (プレー可能な間合いより内側)。
 * この2段構えが「ボールが永久に逃げ続ける」バグの構造的な修正
 * (経緯は ballConstants.ts の DRIBBLE_CONTACT_RADIUS_FIXED のコメント参照)。
 */
export function isInDribbleContact(playerPos: Vec2Fixed, ballPos: Vec2Fixed): boolean {
  const dx = fixedSub(ballPos.x, playerPos.x);
  const dy = fixedSub(ballPos.y, playerPos.y);
  const distSq = fixedAdd(fixedMul(dx, dx), fixedMul(dy, dy));
  return (distSq as number) <= (DRIBBLE_CONTACT_RADIUS_SQ_FIXED as number);
}

/**
 * 蹴り出しドリブル(続編仕様)の有効状態を次tickへ持ち越すための状態遷移。
 * 「L と R を同時押しすると蹴り出す。その後 L か R の片方を押したまま選手がボールに
 * 触れると同様に蹴り出す」という公式説明書の記述どおり、L+Rの同時押しで新規に
 * トリガーし、以後はL/Rどちらか片方を押している間だけ継続する(片方だけを最初から
 * 押しても発動しない、既にモードに入っていることが継続の前提)。ボールを保持して
 * いなければ(near=false)即座に解除する。
 *
 * 決定論に影響する持続状態のため、呼び出し側(update.ts)は結果を必ず
 * PlayerState.kickDribbleActive として次tickへ持ち越すこと。
 */
export function computeKickDribbleState(prevActive: boolean, near: boolean, buttons: ButtonState): boolean {
  if (!near) return false;
  if (buttons.L && buttons.R) return true; // 新規トリガー
  if (prevActive && (buttons.L || buttons.R)) return true; // 継続
  return false; // 両方離した、またはそもそも未トリガー
}

/**
 * ドリブルタッチ (ボールを足元に吸着させず、触れると少し前に転がす)。
 * `inContact` (= isInDribbleContact、プレー可能な間合いより内側の接触距離) かつ接地に
 * 近いボールにのみ作用する。プレイヤーが移動中なら ball.vel を「上書き」する (加算ではない)
 * — 毎tick再適用されても速度が際限なく積み上がらない。
 * プレイヤーが停止中は何もしない (既存の転がり摩擦で自然に減衰し、足元に張り付かず
 * 近くで止まる)。蹴り出しドリブル中(kickDribbleActive)はより速い値で押し出す
 * (呼び出し側でcomputeKickDribbleStateにより判定済みの値を渡すこと。ここでは
 * L/Rボタンそのものは見ない — 単発のL/R押しと「モードとして継続中」を区別する
 * 責務はcomputeKickDribbleStateに一本化してある)。
 *
 * 第2引数に「プレー可能な間合い(20px)」ではなく「接触距離(12px)」を渡すことが必須。
 * 20pxを渡すと、ボール速度(3.6)>選手速度(3.0)のため毎tick再加速され続けてボールが
 * 永久に逃げ続ける (実プレイの「キックが反応しない」の主因、ballConstants.ts参照)。
 */
export function applyDribbleTouch(
  ball: BallState,
  near: boolean,
  inContact: boolean,
  direction: Direction8,
  kickDribbleActive: boolean,
  /**
   * ★18周目★ 追従モデル用の選手位置。渡すと「足元の少し前へ引き寄せる」制御になり、
   * 方向転換してもボールが置き去りにならない (ユーザー指示「ドリブル中は足から離れない
   * ようにして。LR同時押以外」)。省略時は従来の速度上書き方式のまま (既存テスト互換)。
   */
  playerPos?: Vec2Fixed,
): BallState {
  if (!near) return ball;
  if ((ball.height as number) > (DRIBBLE_TOUCH_MAX_HEIGHT_FIXED as number)) return ball; // 浮き球はキックのみ
  if (direction === Direction8.None) return ball; // 停止中は何もしない

  if (playerPos) {
    /**
     * --- 追従モデル (18周目) ---
     * 「足元の少し前」を目標点にしてボールを引き寄せる。通常ドリブルと蹴り出しドリブル
     * (L+R) の違いは**目標点の距離だけ**にする。速度を直接与える旧方式は、転がり摩擦が
     * 0.985 と非常に小さい (= 一度速度を与えると v/(1-0.985) ≒ 67倍の距離を転がる) ため
     * 制御不能で、実測でも通常ドリブルで最大302px、L+Rで平均831px も離れていた。
     * 目標点で制御すれば、摩擦がいくつでもボールは必ずその点に収束する。
     */
    const followDistance = kickDribbleActive
      ? KICK_DRIBBLE_FOLLOW_DISTANCE_FIXED
      : DRIBBLE_FOLLOW_DISTANCE_FIXED;
    const target = vAdd(playerPos, vScaleFixed(DIRECTION_VECTORS[direction], followDistance));
    const toTarget = vSub(target, ball.pos);
    const distSq = dotFixed(toTarget, toTarget) as number;
    // 目標点にほぼ乗っているなら何もしない (微小な押し合いでボールが震えるのを防ぐ)。
    if (distSq <= (fixedMul(toFixed(1), toFixed(1)) as number)) return ball;

    /**
     * すでに速く転がっているボールには触れない = キック/パス/こぼれ球を殺さないためのガード。
     * しきい値は追従の最大速度より上・最も弱いキック(6.2)より下に置く。
     * 「追従で与えた速度」は毎tick制御し直せる (= 収束する) が、キックはそのまま飛ばす。
     */
    if ((dotFixed(ball.vel, ball.vel) as number) >= (fixedMul(DRIBBLE_HANDS_OFF_SPEED_FIXED, DRIBBLE_HANDS_OFF_SPEED_FIXED) as number)) {
      return ball;
    }

    // 速度 = 目標までの距離 × ゲイン (上限あり)。距離が大きいほど速く追いつく。
    //
    // 決定論について: Math.sqrt は IEEE754 で「正確に丸められる」ことが規格で要求されており、
    // 準拠環境なら常にビット単位で同一の結果になる (Math.sin/cos/atan2 と違い実装依存の
    // 近似ではない) ため使用してよい。ただし戻り値は非整数になり得るので、必ず floor して
    // Fixed(1/256px単位の整数) の不変条件を壊さないようにする。
    // 注意: dotFixed は Fixed の乗算なので既に 1/256 されている (単位は px^2 * 256)。
    // そのまま sqrt すると px*16 になり、Fixed(px*256) より16倍小さい値になる
    // (最初の実装でこれを踏み、ボールが選手の1/17の速さでしか追従せず置き去りになった)。
    // 256 を掛けてから sqrt することで正しく Fixed スケールの距離になる。
    const dist = Math.floor(Math.sqrt(distSq * 256)) as Fixed;
    const maxSpeed = kickDribbleActive
      ? KICK_DRIBBLE_FOLLOW_MAX_SPEED_FIXED
      : DRIBBLE_FOLLOW_MAX_SPEED_FIXED;
    const speed = Math.min(fixedMul(dist, DRIBBLE_FOLLOW_GAIN_FIXED) as number, maxSpeed as number) as Fixed;
    // 方向は8方向に量子化する (sim全体の方針。ボールの追従では見た目に影響しない)。
    const dir = quantizeToDirection8(toTarget, ZERO_FIXED);
    if (dir === Direction8.None) return ball;
    return { ...ball, vel: vScaleFixed(DIRECTION_VECTORS[dir], speed) };
  }

  if (kickDribbleActive) {
    if (!inContact) return ball;
    return { ...ball, vel: vScaleFixed(DIRECTION_VECTORS[direction], LONG_DRIBBLE_TOUCH_SPEED_FIXED) };
  }

  // 距離によって押し出す強さを変えるのが要点 (ballConstants.ts の
  // DRIBBLE_KEEP_SPEED_FIXED のコメントに設計理由の全体像あり):
  //   足元 (<12px)     → 3.6 で前へ転がす (「吸着させない」ドリブルの手触り)
  //   離れかけ (12-20px) → 2.8 に落として選手 (3.0) が必ず追いつけるようにする
  // 蹴り出しドリブル (L+R) は「大きく前へ蹴り出してタックルに晒す」のが仕様なので、
  // 距離に関わらず常に速い値のままにして、意図的にボールを足元から離す。
  const touchSpeed: Fixed = kickDribbleActive
    ? LONG_DRIBBLE_TOUCH_SPEED_FIXED
    : inContact
      ? DRIBBLE_TOUCH_SPEED_FIXED
      : DRIBBLE_KEEP_SPEED_FIXED;

  /**
   * ★実ブラウザで発見した最重要バグの修正 (17周目)★
   *
   * ドリブルタッチは「速度を上書きする」実装なので、**蹴った直後のボールまで掴み直して
   * 減速させていた**。実測トレース: キックtickで8.86 → 次tickで2.75 → 2.75 → 2.75、
   * ボールは17.8pxのまま足元から離れない。つまり「蹴っても飛ばない」。
   * これが実プレイの「キックの反応が弱い」の正体だった
   * (キックtickの球速しか見ていなかったため、テストは全部greenのまま)。
   *
   * 修正: すでにタッチ速度以上で転がっているボールには触れない。
   * 物理的にも「自分が押し出せる速さより速いボールは足で止められない」であり、
   * ドリブル (遅いボールを押し出す) の役割はそのまま維持される。
   */
  const speedSq = dotFixed(ball.vel, ball.vel) as number;
  const touchSpeedSq = fixedMul(touchSpeed, touchSpeed) as number;
  if (speedSq >= touchSpeedSq) return ball;

  const vel = vScaleFixed(DIRECTION_VECTORS[direction], touchSpeed);

  return { ...ball, vel };
}
