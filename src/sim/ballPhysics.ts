import { clampFixed, fixedAdd, fixedMul, fixedSub, vAdd, vScaleFixed, ZERO_FIXED } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import type { BallState } from './state';
import { Direction8 } from '../input/types';
import { DIRECTION_VECTORS, PITCH_BOUNDS } from './constants';
import {
  BALL_RADIUS_FIXED,
  BOUNCE_DAMPING_FIXED,
  BOUNCE_MIN_VEL_FIXED,
  CURVE_ROTATION_INTERVAL,
  CURVE_ROTATION_STEP_FIXED,
  GRAVITY_FIXED,
  ROLLING_FRICTION_FIXED,
} from './ballConstants';

/** stepBallPhysicsDetailed() の戻り値。tentativePos はピッチ境界クランプ「前」の位置。 */
export interface BallPhysicsStep {
  readonly ball: BallState;
  /** クランプ前の仮位置。sim/bounds.ts の境界越え検出はこちらを見る必要がある
   * (クランプ後の位置は既に境界内に丸められているため、越えた事実そのものが消えてしまう)。 */
  readonly tentativePos: Vec2Fixed;
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

  const airborne = (height as number) > (ZERO_FIXED as number) || (zVel as number) > (ZERO_FIXED as number);

  if (airborne) {
    zVel = fixedSub(zVel, GRAVITY_FIXED);
    height = fixedAdd(height, zVel);

    if ((height as number) <= (ZERO_FIXED as number)) {
      const impactSpeed = -(zVel as number) as Fixed; // 正の値 (着地速度)
      height = ZERO_FIXED;
      zVel =
        (impactSpeed as number) > (BOUNCE_MIN_VEL_FIXED as number)
          ? fixedMul(impactSpeed, BOUNCE_DAMPING_FIXED) // バウンド
          : ZERO_FIXED; // 静かに着地、跳ねない
    }
  } else {
    height = ZERO_FIXED;
    zVel = ZERO_FIXED;
  }

  const grounded = (height as number) <= (ZERO_FIXED as number);
  let vel: Vec2Fixed = grounded ? vScaleFixed(ball.vel, ROLLING_FRICTION_FIXED) : ball.vel; // 空中は摩擦なし

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
