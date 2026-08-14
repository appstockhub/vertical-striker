import type { GameState, NotableEventKind } from '../sim/state';
import { TeamId } from '../sim/state';

/**
 * イベントバナーHUD用の文言フォーマット (純関数、描画層のみの関心事、scoreboard.tsと同じ流儀)。
 * GameState を直接読むだけで、新たな状態は一切持たない。
 *
 * 経緯: スローイン/GKキャッチは実装上は正しく動作しているが (state.ts の GameState.lastEvent
 * 参照)、画面上・音声上、他の瞬間と見分ける手がかりが無いため実プレイで「起きていない」ように
 * 見える、という報告への対応 (Phase 5)。既存の「非得点の境界復帰は試合停止の演出を持たない」
 * (Phase 3) 方針は維持し、ゲームプレイを止めない一時的なHUD文言のみで対応する。
 */

/** バナー表示を保持するtick数 (仮値、0.75秒 @60fps)。要プレイテスト調整。 */
export const EVENT_BANNER_DURATION_TICKS = 45;

const KIND_LABEL: Record<NotableEventKind, string> = {
  throwIn: 'スローイン',
  goalKick: 'ゴールキック',
  corner: 'コーナーキック',
  gkCatch: 'キャッチ！',
};

/** GameState.lastEvent が無い、または表示期限(EVENT_BANNER_DURATION_TICKS)切れなら null。 */
export function formatEventBannerText(state: GameState): string | null {
  const event = state.lastEvent;
  if (!event) return null;
  if (state.frame - event.atFrame >= EVENT_BANNER_DURATION_TICKS) return null;
  const teamLabel = event.team === TeamId.A ? 'チームA' : 'チームB';
  return `${teamLabel} ${KIND_LABEL[event.kind]}`;
}
