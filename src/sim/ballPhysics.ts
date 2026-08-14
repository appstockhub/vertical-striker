import { clampFixed, fixedAdd, fixedMul, fixedSub, vAdd, vScaleFixed, ZERO_FIXED } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import type { BallState } from './state';
import { PITCH_BOUNDS } from './constants';
import { BALL_RADIUS_FIXED, BOUNCE_DAMPING_FIXED, BOUNCE_MIN_VEL_FIXED, GRAVITY_FIXED, ROLLING_FRICTION_FIXED } from './ballConstants';

/**
 * ボールの1tick分の物理更新 (重力・バウンド・転がり摩擦・ピッチ境界クランプ)。
 * ドリブルタッチ/キックが ball.vel / ball.zVel を書き換えた「後」に毎tick必ず呼ぶ。
 *
 * 重要: 重力は「空中 (height>0 または zVel>0)」の場合のみ適用する。無条件に適用すると
 * 静止しているボール (初期状態や着地後) が毎tick沈み込んで跳ね返る挙動を永久に繰り返し、
 * 見た目上振動し続けてしまう。着地速度が BOUNCE_MIN_VEL_FIXED 未満なら跳ねさせず静止させる。
 */
export function stepBallPhysics(ball: BallState): BallState {
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
  const vel: Vec2Fixed = grounded ? vScaleFixed(ball.vel, ROLLING_FRICTION_FIXED) : ball.vel; // 空中は摩擦なし
  const pos = clampToPitchBounds(vAdd(ball.pos, vel), BALL_RADIUS_FIXED);

  return { pos, vel, height, zVel };
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
