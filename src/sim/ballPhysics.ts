import { clampFixed, dotFixed, fixedAdd, fixedMul, fixedSub, toFixed, vAdd, vScaleFixed, ZERO_FIXED } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import type { BallState } from './state';
import { Direction8 } from '../input/types';
import { DIRECTION_VECTORS, PITCH_BOUNDS } from './constants';
import {
  BALL_RADIUS_FIXED,
  BOUNCE_DAMPING_FIXED,
  BOUNCE_HORIZONTAL_DAMPING_FIXED,
  BOUNCE_MIN_VEL_FIXED,
  CURVE_ROTATION_INTERVAL,
  CURVE_ROTATION_STEP_FIXED,
  GRAVITY_FIXED,
  ROLLING_FRICTION_FIXED,
  ROLL_SLOW_FRICTION_FIXED,
  ROLL_SLOW_SPEED_FIXED,
  THROW_IN_CARRY_MATCH_FIXED,
  THROW_IN_SPEED_MAX_FIXED,
  THROW_IN_Z_VEL_FIXED,
} from './ballConstants';

/** stepBallPhysicsDetailed() の戻り値。tentativePos はピッチ境界クランプ「前」の位置。 */
export interface BallPhysicsStep {
  readonly ball: BallState;
  /** クランプ前の仮位置。sim/bounds.ts の境界越え検出はこちらを見る必要がある
   * (クランプ後の位置は既に境界内に丸められているため、越えた事実そのものが消えてしまう)。 */
  readonly tentativePos: Vec2Fixed;
}

/**
 * ★スローインの投げ込み変換 (台帳L-04、24周目-6)★
 *
 * 原作のスローインは蹴るのではなく「放物線で投げ入れる」(docs/visual-behavior-audit.md
 * 2-3節、vf2085-2088)。当実装のスローイン再開はキック経路 (B/Y/A) を共用しているため、
 * そのままだと地上を転がるキックイン (実プレイ報告7件の1つ) になっていた。
 * スローインの再開ロックが「ボールが動いた」ことで解除される瞬間にこの関数を通し、
 * どのボタン経路で出たボールも投げ込みの弾道 (速度クランプ + 放物線) へ変換する。
 *
 * 純関数・決定論 (fixed演算のみ)。方向は元のキック入力の方向を保存する。
 */
export function applyThrowInRelease(ball: BallState): BallState {
  const rawSpeedSq = dotFixed(ball.vel, ball.vel) as number;
  if (rawSpeedSq === 0) return ball; // 位置ずらしのみの解除 (投げていない) はそのまま

  // 到達点の保存 (THROW_IN_CARRY_MATCH_FIXED のコメント参照): 滞空中は転がり摩擦が
  // 効かないため、水平速度を落とさないと意図した受け手を飛び越えてしまう。
  let vel = vScaleFixed(ball.vel, THROW_IN_CARRY_MATCH_FIXED);

  const speedSq = dotFixed(vel, vel) as number;
  const maxSq = fixedMul(THROW_IN_SPEED_MAX_FIXED, THROW_IN_SPEED_MAX_FIXED) as number;
  if (speedSq > maxSq) {
    // 速度の大きさだけを上限へ丸める (方向保存)。Math.sqrt を経由した比を fixed へ
    // 量子化して用いる (入力が同じなら出力も同じ = 決定論は保たれる)。
    const scale = toFixed(Math.sqrt((maxSq as number) / (speedSq as number)));
    vel = vScaleFixed(vel, scale);
  }
  return { ...ball, vel, height: ZERO_FIXED, zVel: THROW_IN_Z_VEL_FIXED };
}

/**
 * ボールの1tick分の物理更新 (重力・バウンド・転がり摩擦・ピッチ境界クランプ)。
 * ドリブルタッチ/キックが ball.vel / ball.zVel を書き換えた「後」に毎tick必ず呼ぶ。
 *
 * 重要: 重力は「空中 (height>0 または zVel>0)」の場合のみ適用する。無条件に適用すると
 * 静止しているボール (初期状態や着地後) が毎tick沈み込んで跳ね返る挙動を永久に繰り返し、
 * 見た目上振動し続けてしまう。着地速度が BOUNCE_MIN_VEL_FIXED 未満なら跳ねさせず静止させる。
 */
export function stepBallPhysicsDetailed(ball: BallState): BallPhysicsStep {
  let height: Fixed = ball.height;
  let zVel: Fixed = ball.zVel;
  let horizontalVel: Vec2Fixed = ball.vel;

  const airborne = (height as number) > (ZERO_FIXED as number) || (zVel as number) > (ZERO_FIXED as number);

  if (airborne) {
    zVel = fixedSub(zVel, GRAVITY_FIXED);
    height = fixedAdd(height, zVel);

    if ((height as number) <= (ZERO_FIXED as number)) {
      const impactSpeed = -(zVel as number) as Fixed; // 正の値 (着地速度)
      height = ZERO_FIXED;
      const bounces = (impactSpeed as number) > (BOUNCE_MIN_VEL_FIXED as number);
      zVel = bounces
        ? fixedMul(impactSpeed, BOUNCE_DAMPING_FIXED) // バウンド
        : ZERO_FIXED; // 静かに着地、跳ねない
      // ★24周目サイクル④★ バウンドする着地は水平速度も削る (芝との衝突)。これが無いと
      // 浮き球が着地後も初速のままバウンドし続け、Xロングフィード(飛距離180px)が着地後
      // さらに175px転がって受け手を置き去りにする (スルーパス不成立の一因)。
      // 「静かな着地」(微小ホップの接地) には適用しない: 低い弾道のキックの転がりまで
      // 削ってしまい、グラウンダーの飛程(=K7カーブ等の基準)を歪めるため。値の根拠は
      // BOUNCE_HORIZONTAL_DAMPING_FIXED (ballConstants.ts) のコメント参照。
      if (bounces) {
        horizontalVel = vScaleFixed(horizontalVel, BOUNCE_HORIZONTAL_DAMPING_FIXED);
      }
    }
  } else {
    height = ZERO_FIXED;
    zVel = ZERO_FIXED;
  }

  const grounded = (height as number) <= (ZERO_FIXED as number);
  // 転がり摩擦: 低速域 (ROLL_SLOW_SPEED未満) は強い減衰へ切り替える
  // (24周目サイクル②、離散タッチドリブルの成立条件。ballConstants.ts参照)。
  const slowSq = fixedMul(ROLL_SLOW_SPEED_FIXED, ROLL_SLOW_SPEED_FIXED) as number;
  const friction =
    (dotFixed(horizontalVel, horizontalVel) as number) < slowSq ? ROLL_SLOW_FRICTION_FIXED : ROLLING_FRICTION_FIXED;
  let vel: Vec2Fixed = grounded ? vScaleFixed(horizontalVel, friction) : horizontalVel; // 空中は摩擦なし

  // カーブ (続編仕様③): curveTicksLeftが残っている間、毎tick速度ベクトルを入力方向側へ
  // 微小角回転させる (24周目サイクル①で加算方式から変更。理由は ballConstants.ts の
  // CURVE_ROTATION_PER_TICK_FIXED のコメント参照)。トリガー判定(方向入力受付ウィンドウの
  // 消費)はupdate.ts側の責務、ここでは「既に設定されたカーブを毎tick適用し、持続時間を
  // 減衰させる」だけを行う。
  const curveDirectionIn = ball.curveDirection ?? Direction8.None;
  let curveTicksLeft = ball.curveTicksLeft ?? 0;
  if (curveTicksLeft > 0 && curveDirectionIn !== Direction8.None) {
    // 回転の向き = 速度ベクトルから見て入力方向がどちら側か (外積の符号)。
    // 入力方向が速度と平行/反平行 (cross=0) なら曲げようがないので何もしない。
    const target = DIRECTION_VECTORS[curveDirectionIn];
    const cross = (fixedMul(vel.x, target.y) as number) - (fixedMul(vel.y, target.x) as number);
    // 量子化対策: INTERVALごとにまとめて回す (ballConstants.tsのコメント参照)
    if (cross !== 0 && curveTicksLeft % CURVE_ROTATION_INTERVAL === 0) {
      const k = CURVE_ROTATION_STEP_FIXED;
      const dx = fixedMul(vel.y, k) as number;
      const dy = fixedMul(vel.x, k) as number;
      // cross>0 = 入力方向は速度の時計回り側 (画面座標系はy下向き) → その向きへ回す
      vel =
        cross > 0
          ? { x: fixedSub(vel.x, dx as Fixed), y: fixedAdd(vel.y, dy as Fixed) }
          : { x: fixedAdd(vel.x, dx as Fixed), y: fixedSub(vel.y, dy as Fixed) };
    }
    curveTicksLeft -= 1;
  }
  const curveDirection = curveTicksLeft > 0 ? curveDirectionIn : Direction8.None;
  const curveWindowTicksLeft = Math.max(0, (ball.curveWindowTicksLeft ?? 0) - 1);

  const tentativePos = vAdd(ball.pos, vel);
  const pos = clampToPitchBounds(tentativePos, BALL_RADIUS_FIXED);

  return { ball: { pos, vel, height, zVel, curveDirection, curveTicksLeft, curveWindowTicksLeft }, tentativePos };
}

/**
 * stepBallPhysicsDetailed() の薄いラッパー。境界越え検出が不要な既存の呼び出し元
 * (テスト等) 向けに Phase 2 までと同じシグネチャを維持する。
 */
export function stepBallPhysics(ball: BallState): BallState {
  return stepBallPhysicsDetailed(ball).ball;
}

/**
 * 位置をピッチ境界(半径分の余白込み)にクランプする。プレイヤー(sim/update.ts)とボール
 * (このファイル)の両方で使う共通ヘルパー。速度の反射は行わない (壁は位置クランプのみ、
 * 上下=地面のみバウンドをモデル化する)。
 */
export function clampToPitchBounds(pos: Vec2Fixed, radius: Fixed): Vec2Fixed {
  return {
    x: clampFixed(pos.x, fixedAdd(PITCH_BOUNDS.minX, radius), fixedSub(PITCH_BOUNDS.maxX, radius)),
    y: clampFixed(pos.y, fixedAdd(PITCH_BOUNDS.minY, radius), fixedSub(PITCH_BOUNDS.maxY, radius)),
  };
}
