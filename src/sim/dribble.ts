import { dotFixed, fixedAdd, fixedMul, fixedSub, vScaleFixed } from '../core/fixed';
import type { Vec2Fixed } from '../core/types';
import { Direction8, type ButtonState } from '../input/types';
import type { BallState } from './state';
import { DIRECTION_VECTORS } from './constants';
import {
  DRIBBLE_CONTACT_RADIUS_SQ_FIXED,
  DRIBBLE_RADIUS_SQ_FIXED,
  DRIBBLE_TOUCH_MAX_HEIGHT_FIXED,
  DRIBBLE_TOUCH_SPEED_FIXED,
  DRIBBLE_TRAP_DAMPING_FIXED,
  DRIBBLE_TRAP_MAX_SPEED_FIXED,
  KICKOUT_IMPULSE_SPEED_FIXED,
} from './ballConstants';

/**
 * ★24周目サイクル②: ドリブルの離散タッチ化★
 *
 * 原作実測 (docs/parity-targets.md D1/D2) に基づき、18周目の追従サーボモデル
 * (毎tick「足元の少し前」の目標点へボールを引き寄せる) を廃止し、原作と同じ
 * 「蹴る→追う→蹴る」の離散リズムに再設計した。
 *
 * 新モデルの規則 (applyDribbleTouch):
 *  1. 接触半径 (7px) に入ったtickだけ、入力方向へ押し出す (それが「タッチ」)
 *  2. 触れていない間はボールに一切干渉しない — ボールは自由に転がり、
 *     転がり摩擦 (低速域は強い減衰、ballPhysics.ts) だけで沈んでいく
 *  3. ニュートラル入力では、足元の遅いボールに「トラップ」の減衰を掛けて殺す
 *     (立ち止まる=ボールを止める。不具合#7の恒久対策)
 *  4. 蹴り出しドリブル (L+R) 中の接触は KICKOUT_IMPULSE の大きな押し出しになる
 *     (不具合#6の修正。旧実装ではこの分岐がデッドコードだった)
 *
 * 方向転換の意味が変わることに注意: サーボと違い、ボールは選手についてこない。
 * 転がるボールの先へ自分が回り込み、次のタッチで新しい方向へ押し出すのが
 * 原作準拠の操作 (「操作しているのは選手であってボールではない」)。
 */

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

/** 実際に足が当たってタッチが発火する接触距離にあるか (プレー可能な間合いより内側)。 */
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

export interface DribbleTouchResult {
  readonly ball: BallState;
  /** このtickに通常タッチ/蹴り出しが発火したか (呼び出し側がクールダウンを設定する)。 */
  readonly touched: boolean;
}

/**
 * ドリブルタッチ (離散タッチ方式、冒頭のモデル解説参照)。
 * `near` = プレー可能な間合い(20px)、`inContact` = 接触距離(7px)、
 * `cooldownActive` = 前回のタッチからDRIBBLE_TOUCH_COOLDOWN_TICKS経っていない。
 */
export function applyDribbleTouch(
  ball: BallState,
  near: boolean,
  inContact: boolean,
  direction: Direction8,
  kickDribbleActive: boolean,
  cooldownActive = false,
): DribbleTouchResult {
  if (!near) return { ball, touched: false };
  if ((ball.height as number) > (DRIBBLE_TOUCH_MAX_HEIGHT_FIXED as number)) return { ball, touched: false }; // 浮き球はキックのみ

  const speedSq = dotFixed(ball.vel, ball.vel) as number;

  if (direction === Direction8.None) {
    // トラップ: 立ち止まったら、足元の遅いボールを減衰させて殺す。
    // キック直後の速いボール (>TRAP_MAX) には触れない = キック/パスを殺さない。
    const trapMaxSq = fixedMul(DRIBBLE_TRAP_MAX_SPEED_FIXED, DRIBBLE_TRAP_MAX_SPEED_FIXED) as number;
    if (speedSq > 0 && speedSq < trapMaxSq) {
      return { ball: { ...ball, vel: vScaleFixed(ball.vel, DRIBBLE_TRAP_DAMPING_FIXED) }, touched: false };
    }
    return { ball, touched: false };
  }

  // 離散タッチの核: 接触していないtickはボールに一切干渉しない。
  if (!inContact) return { ball, touched: false };

  if (kickDribbleActive) {
    // 蹴り出しドリブル: 大きなインパルスで前方へ蹴り出す (不具合#6の修正)。
    // クールダウンの対象外 (接触は長い追走の後にしか起きないため実質影響しないが、
    // 「触れたら必ず蹴り出す」という公式記述を優先する)。
    return {
      ball: { ...ball, vel: vScaleFixed(DIRECTION_VECTORS[direction], KICKOUT_IMPULSE_SPEED_FIXED) },
      touched: true,
    };
  }

  // 通常タッチ: クールダウン中は蹴り足が出ない (リズムの実体)。
  if (cooldownActive) return { ball, touched: false };

  // すでにタッチ速度以上で転がっているボールには触れない
  // (17周目の教訓: 蹴った直後のボールを掴み直して殺さないためのガード)。
  const touchSpeedSq = fixedMul(DRIBBLE_TOUCH_SPEED_FIXED, DRIBBLE_TOUCH_SPEED_FIXED) as number;
  if (speedSq >= touchSpeedSq) return { ball, touched: false };

  return {
    ball: { ...ball, vel: vScaleFixed(DIRECTION_VECTORS[direction], DRIBBLE_TOUCH_SPEED_FIXED) },
    touched: true,
  };
}
