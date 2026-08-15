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
 * near かつ接地に近いボールにのみ作用する。プレイヤーが移動中なら ball.vel を
 * 「上書き」する (加算ではない) — 毎tick再適用されても速度が際限なく積み上がらない。
 * プレイヤーが停止中は何もしない (既存の転がり摩擦で自然に減衰し、足元に張り付かず
 * 近くで止まる)。蹴り出しドリブル中(kickDribbleActive)はより速い値で押し出す
 * (呼び出し側でcomputeKickDribbleStateにより判定済みの値を渡すこと。ここでは
 * L/Rボタンそのものは見ない — 単発のL/R押しと「モードとして継続中」を区別する
 * 責務はcomputeKickDribbleStateに一本化してある)。
 */
export function applyDribbleTouch(
  ball: BallState,
  near: boolean,
  direction: Direction8,
  kickDribbleActive: boolean,
): BallState {
  if (!near) return ball;
  if ((ball.height as number) > (DRIBBLE_TOUCH_MAX_HEIGHT_FIXED as number)) return ball; // 浮き球はキックのみ
  if (direction === Direction8.None) return ball; // 停止中は何もしない

  const touchSpeed: Fixed = kickDribbleActive ? LONG_DRIBBLE_TOUCH_SPEED_FIXED : DRIBBLE_TOUCH_SPEED_FIXED;
  const vel = vScaleFixed(DIRECTION_VECTORS[direction], touchSpeed);

  return { ...ball, vel };
}
