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

/**
 * カーブ(続編仕様③)関連の定数。すべて仮値(実機データ無し、プレイフィールで調整する対象。
 * CLAUDE.md「独自仕様」節のバックスピンと同様の扱い)。
 *
 * 入力受付ウィンドウ: 公式説明書は「キックボタンを押した"瞬間に"+字を入れる」と記述するが、
 * この実装は1tickにつき方向入力を1つしか読めず、キック発動tickの方向入力は既に
 * ショット自体の照準(シフトキック含む)に使われている。そのため「同時」を「キック発動
 * tickの直後から始まる短いウィンドウ」で近似する。初代CLAUDE.mdが計画していた
 * 「キック後Nフレーム(仮値20f)」より大幅に短くしてある(「同時」に近づける意図)。
 */
export const CURVE_INPUT_WINDOW_TICKS = 6;
/** カーブが実際に効いている持続tick数 (仮値)。 */
export const CURVE_DURATION_TICKS = 24;
/**
 * カーブによる毎tickの側方加速度 (px/tick、仮値)。CURVE_DURATION_TICKS(24)分
 * 累積すると側方速度が最大で約2.4px/tick増える計算 (STRONG_KICK_SPEED=9.0の
 * 約27%相当)。軌道を明確に曲げつつ直進性を完全には殺さない、上限側の初期値として
 * 選んだ(要プレイテスト調整。初期実装値0.35は最大8.4px/tickまで積み上がり
 * ショットを完全に横へねじ曲げてしまい、観戦シミュレーターで新規の振動を誘発したため
 * 大幅に下げた)。
 */
export const CURVE_ACCEL_FIXED: Fixed = toFixed(0.04);
