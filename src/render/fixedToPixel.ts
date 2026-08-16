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

// 旧 ballLiftPx() は16周目の疑似3D化で使われなくなり、段階1で削除した。
// ボールの高さ表現の係数は render/viewConstants.ts の BALL_HEIGHT_* に一本化してある
// (持ち上げ量は投影スケールに依存するため、PitchScene.renderBall で直接掛ける)。
