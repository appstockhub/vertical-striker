import { fixedAdd, fixedMul, fixedSub, vScaleFixed } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { Direction8, type ButtonState } from '../input/types';
import type { BallState } from './state';
import { DIRECTION_VECTORS } from './constants';
import {
  DRIBBLE_CONTACT_RADIUS_SQ_FIXED,
  DRIBBLE_KEEP_SPEED_FIXED,
  DRIBBLE_RADIUS_SQ_FIXED,
  DRIBBLE_TOUCH_MAX_HEIGHT_FIXED,
  DRIBBLE_TOUCH_SPEED_FIXED,
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
): BallState {
  if (!near) return ball;
  if ((ball.height as number) > (DRIBBLE_TOUCH_MAX_HEIGHT_FIXED as number)) return ball; // 浮き球はキックのみ
  if (direction === Direction8.None) return ball; // 停止中は何もしない

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
  const vel = vScaleFixed(DIRECTION_VECTORS[direction], touchSpeed);

  return { ...ball, vel };
}
