/**
 * 色計算の小さな純関数群。★描画専用★ (sim/ からは使わない)。
 *
 * V-4 (ビジュアル手法転換の案C) で、芝の空気遠近グラデーションとスタンドの群衆色に
 * 同じ補間・減光ロジックが必要になったため、stadium.ts に個別実装していた lerpColor を
 * ここへ切り出して共通化した。
 */

/** 2色を t (0..1) で線形補間する。 */
export function lerpColor(from: number, to: number, t: number): number {
  const fr = (from >> 16) & 0xff;
  const fg = (from >> 8) & 0xff;
  const fb = from & 0xff;
  const tr = (to >> 16) & 0xff;
  const tg = (to >> 8) & 0xff;
  const tb = to & 0xff;
  const r = Math.round(fr + (tr - fr) * t);
  const gg = Math.round(fg + (tg - fg) * t);
  const b = Math.round(fb + (tb - fb) * t);
  return (r << 16) | (gg << 8) | b;
}

/** 色を factor 倍に明るく/暗く (1.0=不変、>1で明るく、<1で暗く)。チャンネルは0..255にクランプ。 */
export function shadeColor(color: number, factor: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((color >> 16) & 0xff) * factor)));
  const g = Math.min(255, Math.max(0, Math.round(((color >> 8) & 0xff) * factor)));
  const b = Math.min(255, Math.max(0, Math.round((color & 0xff) * factor)));
  return (r << 16) | (g << 8) | b;
}
