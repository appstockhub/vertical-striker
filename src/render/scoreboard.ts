import { displayMinute, getHalf, isFulltime } from '../sim/matchClock';
import type { GameState } from '../sim/state';

/**
 * スコアボードHUD用の文言フォーマット (純関数、描画層のみの関心事)。
 * GameState を直接読むだけで、新たな状態は一切持たない。
 */

export function formatScoreText(state: GameState): string {
  return `${state.score[0]} - ${state.score[1]}`;
}

export function formatClockText(state: GameState): string {
  if (isFulltime(state.frame)) return 'FULL TIME';
  const half = getHalf(state.frame);
  const minute = displayMinute(state.frame);
  return `H${half}  ${minute}'`;
}
