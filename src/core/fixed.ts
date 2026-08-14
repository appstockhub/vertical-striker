import type { Fixed, Vec2Fixed } from './types';

/**
 * 固定小数点ユーティリティ (1/256 px サブピクセル精度)。
 *
 * 決定論を守るための鉄則 (sim/ 配下からの利用を前提とする):
 * - Math.sin / Math.cos / Math.atan2 / Math.sqrt など超越関数は使わない。
 *   ECMA-262 は加減乗除・sqrt については正確な丸めを規定するが、sin/cos/atan2 系は
 *   処理系依存の近似実装を許容しており、エンジン間で bit-exact にならない可能性がある。
 * - 8方向移動は本ファイルの事前計算済み整数定数のみで表現できるため、Phase 0 では
 *   上記の超越関数を一切必要としない。
 */

export const FIXED_SHIFT = 8;
export const FIXED_ONE = 1 << FIXED_SHIFT; // 256

/** 浮動小数点(px) から Fixed へ変換する。設定値の初期化など、非ホットパス専用。 */
export function toFixed(px: number): Fixed {
  return Math.round(px * FIXED_ONE) as Fixed;
}

/** Fixed から浮動小数点(px) へ変換する。描画境界 (render/fixedToPixel.ts) 専用。 */
export function toFloat(f: Fixed): number {
  return f / FIXED_ONE;
}

/** 整数ピクセル値から Fixed を作る (px << 8)。 */
export function fixedFromInt(n: number): Fixed {
  return (n << FIXED_SHIFT) as Fixed;
}

export function fixedAdd(a: Fixed, b: Fixed): Fixed {
  return ((a as number) + (b as number)) as Fixed;
}

export function fixedSub(a: Fixed, b: Fixed): Fixed {
  return ((a as number) - (b as number)) as Fixed;
}

/** a * b を Fixed 同士で行う (結果も Fixed スケール)。中間計算は整数のまま桁あふれに注意。 */
export function fixedMul(a: Fixed, b: Fixed): Fixed {
  return (Math.trunc(((a as number) * (b as number)) / FIXED_ONE)) as Fixed;
}

export function fixedDiv(a: Fixed, b: Fixed): Fixed {
  return (Math.trunc(((a as number) * FIXED_ONE) / (b as number))) as Fixed;
}

export function clampFixed(v: Fixed, lo: Fixed, hi: Fixed): Fixed {
  return Math.min(Math.max(v as number, lo as number), hi as number) as Fixed;
}

export const ZERO_FIXED = 0 as Fixed;

export function vAdd(a: Vec2Fixed, b: Vec2Fixed): Vec2Fixed {
  return { x: fixedAdd(a.x, b.x), y: fixedAdd(a.y, b.y) };
}

export function vSub(a: Vec2Fixed, b: Vec2Fixed): Vec2Fixed {
  return { x: fixedSub(a.x, b.x), y: fixedSub(a.y, b.y) };
}

/** ベクトル v を scalar(Fixed) 倍する。scalar は「1.0 = FIXED_ONE」の固定小数点表現。 */
export function vScaleFixed(v: Vec2Fixed, scalar: Fixed): Vec2Fixed {
  return { x: fixedMul(v.x, scalar), y: fixedMul(v.y, scalar) };
}

export function vZero(): Vec2Fixed {
  return { x: ZERO_FIXED, y: ZERO_FIXED };
}
