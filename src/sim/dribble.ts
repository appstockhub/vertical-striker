import { fixedAdd, fixedMul, fixedSub, vScaleFixed } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { Direction8, type ButtonState } from '../input/types';
import type { BallState } from './state';
import { DIRECTION_VECTORS } from './constants';
import {
  DRIBBLE_RADIUS_SQ_FIXED,
  DRIBBLE_TOUCH_MAX_HEIGHT_FIXED,
  DRIBBLE_TOUCH_SPEED_FIXED,
  LONG_DRIBBLE_TOUCH_SPEED_FIXED,
} from './ballConstants';

/**
 * プレイヤーとボールが「ドリブルタッチ」の間合いにあるかどうか (tick開始時点の位置で判定)。
 * sqrt を使わず、距離の二乗をしきい値の二乗と比較する。
 */
export function isNearBall(playerPos: Vec2Fixed, ballPos: Vec2Fixed): boolean {
  const dx = fixedSub(ballPos.x, playerPos.x);
  const dy = fixedSub(ballPos.y, playerPos.y);
  const distSq = fixedAdd(fixedMul(dx, dx), fixedMul(dy, dy));
  return (distSq as number) <= (DRIBBLE_RADIUS_SQ_FIXED as number);
}

/**
 * ドリブルタッチ (ボールを足元に吸着させず、触れると少し前に転がす)。
 * near かつ接地に近いボールにのみ作用する。プレイヤーが移動中なら ball.vel を
 * 「上書き」する (加算ではない) — 毎tick再適用されても速度が際限なく積み上がらない。
 * プレイヤーが停止中は何もしない (既存の転がり摩擦で自然に減衰し、足元に張り付かず
 * 近くで止まる)。ロングドリブル(L/R押し続け)時はより速い値で押し出す。
 */
export function applyDribbleTouch(
  ball: BallState,
  near: boolean,
  direction: Direction8,
  buttons: ButtonState,
): BallState {
  if (!near) return ball;
  if ((ball.height as number) > (DRIBBLE_TOUCH_MAX_HEIGHT_FIXED as number)) return ball; // 浮き球はキックのみ
  if (direction === Direction8.None) return ball; // 停止中は何もしない

  const longDribble = buttons.L || buttons.R;
  const touchSpeed: Fixed = longDribble ? LONG_DRIBBLE_TOUCH_SPEED_FIXED : DRIBBLE_TOUCH_SPEED_FIXED;
  const vel = vScaleFixed(DIRECTION_VECTORS[direction], touchSpeed);

  return { ...ball, vel };
}

/** ロングドリブル(L/R押し続け)が有効かどうか (プレイヤー移動速度の差し替え判定用)。 */
export function isLongDribbleActive(near: boolean, direction: Direction8, buttons: ButtonState): boolean {
  return near && direction !== Direction8.None && (buttons.L || buttons.R);
}
