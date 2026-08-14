import { fixedMul, toFixed } from '../core/fixed';
import type { Fixed } from '../core/types';

/**
 * 非操作選手AIの重み付きベクトル合成に使う定数。すべて仮値 (要プレイテスト調整)。
 * 「ホームポジションへの復元力 + ボール位置への引力 + オフサイドライン意識」の3項を
 * それぞれ8方向に量子化してから重み付けする (CLAUDE.md Phase 2 箇条書き参照)。
 */
export const HOME_PULL_WEIGHT_FIXED: Fixed = toFixed(1.0);
export const BALL_ATTRACTION_WEIGHT_FIXED: Fixed = toFixed(0.6);
export const OFFSIDE_BIAS_WEIGHT_FIXED: Fixed = toFixed(0.8);

/** ホームポジションにこの距離以内なら「到着済み」とみなし復元力を0にする (px, 仮値、二乗)。 */
export const AI_HOME_DEADZONE_SQ_FIXED: Fixed = fixedMul(toFixed(4), toFixed(4));
/** ボールにこの距離以内なら引力を0にする (px, 仮値、二乗)。 */
export const AI_BALL_DEADZONE_SQ_FIXED: Fixed = fixedMul(toFixed(2), toFixed(2));
/** 合成後ベクトルの最終量子化デッドゾーン (px, 仮値、二乗)。ほぼ全項が打ち消し合った場合に静止させる。 */
export const AI_FINAL_DEADZONE_SQ_FIXED: Fixed = fixedMul(toFixed(0.5), toFixed(0.5));
