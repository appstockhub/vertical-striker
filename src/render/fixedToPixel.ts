import { toFloat } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';

/**
 * Fixed(1/256px) -> 描画用 float px への変換。
 * これが唯一の「決定論領域(sim/)から描画領域(render/)へ抜ける」境界であり、
 * ここから先 (Phaser の座標系) では float を使ってよい。
 */
export function fixedToPx(v: Fixed): number {
  return toFloat(v);
}

export function vecToPx(v: Vec2Fixed): { x: number; y: number } {
  return { x: toFloat(v.x), y: toFloat(v.y) };
}

/** 見た目上の強調係数。ボールの高さ(z)を画面上の見かけの持ち上げ量(px)に変換する (演出用、描画専用)。 */
const BALL_HEIGHT_VISUAL_SCALE = 1.6;

/** ボールの高さ(Fixed) -> 画面上での持ち上げ量(float px)。疑似3D描画用。 */
export function ballLiftPx(height: Fixed): number {
  return toFloat(height) * BALL_HEIGHT_VISUAL_SCALE;
}
