import { fixedMul, toFixed } from '../core/fixed';
import type { Fixed } from '../core/types';

/**
 * Phase 1 のボール物理・ドリブル・キック関連の定数。
 * すべてプレイテスト前提の仮値 (Phase 0 の PLAYER_SPEED_FIXED 等と同じ扱い)。
 * 実機確認・手触り調整で見直す想定 (CLAUDE.md「要検証仕様」と同種)。
 */

/** ボールの当たり半径 (px, 仮値)。描画スプライトの見た目半径(7px)に合わせた。 */
export const BALL_RADIUS_FIXED: Fixed = toFixed(7);

/** ドリブルタッチが発生する中心間距離のしきい値 (px, 仮値)。 */
export const DRIBBLE_RADIUS_FIXED: Fixed = toFixed(20);
export const DRIBBLE_RADIUS_SQ_FIXED: Fixed = fixedMul(DRIBBLE_RADIUS_FIXED, DRIBBLE_RADIUS_FIXED);

/** これ以下の高さのボールのみドリブルタッチの対象とする (px, 仮値)。浮き球はキックのみで触れる。 */
export const DRIBBLE_TOUCH_MAX_HEIGHT_FIXED: Fixed = toFixed(2.0);

/** ドリブルタッチ時にボールへ与える速度 (px/tick, 仮値)。PLAYER_SPEED(3.0)よりわずかに速い。 */
export const DRIBBLE_TOUCH_SPEED_FIXED: Fixed = toFixed(3.6);

/** ロングドリブル(L/R押し続け)時のプレイヤー速度 (px/tick, 仮値。通常の約1.4倍、要実機検証)。 */
export const LONG_DRIBBLE_PLAYER_SPEED_FIXED: Fixed = toFixed(4.2);

/** ロングドリブル時にボールへ与える速度 (px/tick, 仮値。ドリブル半径外まで蹴り出す想定、要実機検証)。 */
export const LONG_DRIBBLE_TOUCH_SPEED_FIXED: Fixed = toFixed(6.0);

/** キック溜め時間の下限/上限 (tick、60fps基準。上限は約0.5秒、仮値)。 */
export const KICK_MIN_CHARGE_FRAMES = 1;
export const KICK_MAX_CHARGE_FRAMES = 30;

/** 弱キック (方向入力無しで解放) の基準速度 (px/tick, 仮値)。 */
export const WEAK_KICK_SPEED_FIXED: Fixed = toFixed(4.0);
/** 強キック (方向入力ありで解放) の基準速度 (px/tick, 仮値)。 */
export const STRONG_KICK_SPEED_FIXED: Fixed = toFixed(9.0);

/** 弾道軸: 溜め時間0→最大 で zVel をこの範囲に線形補間する (仮値)。 */
export const KICK_Z_VEL_MIN_FIXED: Fixed = toFixed(0);
export const KICK_Z_VEL_MAX_FIXED: Fixed = toFixed(6.0);

/** 最大溜め時に水平速度へ掛かる係数 (仮値)。高弾道シュートほど球速が落ちる表現。 */
export const HIGH_ARC_SPEED_MULTIPLIER_FIXED: Fixed = toFixed(0.7);

/** 重力加速度 (px/tick^2, 仮値)。 */
export const GRAVITY_FIXED: Fixed = toFixed(0.35);
/** バウンド時に残る垂直速度の割合 (仮値)。 */
export const BOUNCE_DAMPING_FIXED: Fixed = toFixed(0.5);
/** これ未満の着地速度はバウンドさせず静止させる (px/tick, 仮値)。無限微小バウンド防止。 */
export const BOUNCE_MIN_VEL_FIXED: Fixed = toFixed(0.5);
/** 接地中、毎tick水平速度に掛ける減衰係数 (仮値)。 */
export const ROLLING_FRICTION_FIXED: Fixed = toFixed(0.96);
