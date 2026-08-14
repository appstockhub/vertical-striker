// ピッチ/ビューポート寸法の純定数。Phaser には依存しない。
// 単位はすべて「論理ピクセル」(整数)。sim/ 側では toFixed() して使う。

/** ビューポート（画面に見える範囲）の論理解像度。CLAUDE.md の縦長比 1.5:1 を採用。 */
export const VIEWPORT_WIDTH = 480;
export const VIEWPORT_HEIGHT = 720;

/**
 * ピッチ全体（スクロールする試合フィールド）の論理サイズ。
 * 幅はビューポートと同一（横スクロールは行わない）。
 * 高さはビューポートの2.5倍とし、縦スクロールが明確に確認できる広さにする。
 *
 * 仮値: CLAUDE.md の「1.5:1」がビューポートを指すのかピッチ全体を指すのか
 * 明記が無いため、ビューポート側の比率と解釈した (Phase 0 実装計画の assumption #1/#2)。
 */
export const PITCH_WIDTH = VIEWPORT_WIDTH;
export const PITCH_HEIGHT = VIEWPORT_HEIGHT * 2.5;

/** レーダー(ミニマップ)の画面上のサイズと余白。 */
export const RADAR_WIDTH = Math.round(VIEWPORT_WIDTH * 0.22);
export const RADAR_HEIGHT = Math.round(RADAR_WIDTH * (PITCH_HEIGHT / PITCH_WIDTH));
export const RADAR_MARGIN = 10;
