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

/** スコアボードの「0〜90分」表示用に、実経過時間を圧縮した表示分を返す (演出のみ、
 * ゲームロジックには影響しない。計画セクションB/仮定2)。前半0〜45分、後半45〜90分。
 * フルタイム後もそれ以上増やさず90分で固定表示する。 */
const DISPLAY_MINUTES_PER_HALF = 45;

export function displayMinute(frame: number): number {
  const half = getHalf(frame);
  const framesIntoHalf = half === 1 ? frame : frame - HALF_DURATION_FRAMES;
  const fraction = Math.min(framesIntoHalf / HALF_DURATION_FRAMES, 1);
  const base = half === 1 ? 0 : DISPLAY_MINUTES_PER_HALF;
  return Math.floor(base + fraction * DISPLAY_MINUTES_PER_HALF);
}
