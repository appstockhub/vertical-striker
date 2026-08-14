import type { Half } from './formations';

/**
 * 試合時計・前後半・試合終了はすべて GameState.frame (単調増加、リセットしない) から
 * 導出する純関数群。新規のカウンタ状態は一切持たない (ホームポジションと同じ
 * 「derive、cacheしない」方針)。
 */

/** 1ハーフの長さ (tick、仮値)。60fps基準で3分。CLAUDE.mdに試合時間の指定が無いため、
 * アーケード的な短さで仮決めした。要プレイテスト調整。 */
export const HALF_DURATION_FRAMES = 60 * 60 * 3;
export const FULL_MATCH_DURATION_FRAMES = HALF_DURATION_FRAMES * 2;

export function getHalf(frame: number): Half {
  return frame < HALF_DURATION_FRAMES ? 1 : 2;
}

export function isFulltime(frame: number): boolean {
  return frame >= FULL_MATCH_DURATION_FRAMES;
}

/** 現在のハーフ内での経過秒数 (描画のスコアボード表示用)。 */
export function secondsElapsedInHalf(frame: number): number {
  const half = getHalf(frame);
  const framesIntoHalf = half === 1 ? frame : frame - HALF_DURATION_FRAMES;
  return Math.floor(framesIntoHalf / 60);
}
