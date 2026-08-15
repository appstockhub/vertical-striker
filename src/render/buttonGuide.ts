import type { GameState } from '../sim/state';
import { findTouchPriorityPlayer } from '../sim/ballTouch';
import { TeamId } from '../sim/formations';

/**
 * 画面下部のボタンガイド (文言生成の純関数)。★描画専用★
 *
 * ★存在理由★ ユーザーから「チャージとかしないしスライディングしないしAボタン反応しない」
 * という報告が繰り返された。原因は実装がボタン表と食い違っていたこと (tests/sim/
 * buttonLayout.test.ts 参照) だが、**そもそも「今この状況でどのボタンが何をするのか」が
 * 画面のどこにも出ていない**ことが、不具合の切り分けを難しくしていた。
 * 続編仕様のボタンは文脈依存 (ルーズボール / キープ / 相手ボール) で意味が変わるため、
 * 今の文脈と各ボタンの役割を常に画面に出す。
 *
 * キーボード割り当て (src/input/keyboard.ts) と論理ボタンの対応も併記する:
 *   Z=B / X=A / C=Y / V=X / Q=L / E=R / Shift=START
 * ゲームパッドは SFC 配置を位置対応で写す (下=B / 右=A / 左=Y / 上=X)。
 * PlayStation系なら ✕=B, ○=A, □=Y, △=X に対応する。
 */

export type BallContext = 'loose' | 'keeping' | 'defending';

/** いまの状況が3つの文脈のどれかを判定する (ボタンの意味が変わる単位)。 */
export function resolveBallContext(state: GameState): BallContext {
  const holder = findTouchPriorityPlayer(state.players, state.ball.pos, state.lastTouchPlayerIndex);
  if (holder === null) return 'loose';
  const player = state.players[holder];
  if (!player) return 'loose';
  return player.team === TeamId.A ? 'keeping' : 'defending';
}

// 画面幅480pxに収める必要があるため、文言は最小限に切り詰める (実機で見切れを確認済み)。
const CONTEXT_LABEL: Record<BallContext, string> = {
  loose: 'ルーズ',
  keeping: 'キープ',
  defending: '相手球',
};

/**
 * 文脈ごとのボタンの役割 (CLAUDE.md 続編仕様のボタン表そのもの)。
 * 文言は画面幅480pxに収まるよう最小限に切り詰める (自己観察で見切れを確認済み)。
 */
const BUTTON_ROLES: Record<BallContext, ReadonlyArray<readonly [string, string]>> = {
  loose: [
    ['B(Z)', 'クリア'],
    ['Y(C)', 'パス'],
    ['A(X)', 'スライド'],
    ['X(V)', 'ロビング'],
  ],
  keeping: [
    ['B(Z)', 'シュート'],
    ['Y(C)', 'パス'],
    ['A(X)', '前方パス'],
    ['X(V)', 'ロング'],
  ],
  defending: [
    ['B(Z)', 'チャージ'],
    ['Y(C)', 'スライド'],
    ['A(X)', 'スライド'],
    ['X(V)', 'チャージ'],
  ],
};

/** 画面下部に1行で出すガイド文字列。 */
export function formatButtonGuide(state: GameState): string {
  const context = resolveBallContext(state);
  const roles = BUTTON_ROLES[context].map(([key, role]) => `${key}:${role}`).join('  ');
  return `[${CONTEXT_LABEL[context]}]  ${roles}`;
}
