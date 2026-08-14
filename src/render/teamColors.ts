import { TeamId } from '../sim/formations';

/**
 * チーム/UI要素の配色。色覚多様性(特に赤緑弱/緑赤弱、有病率が高い1型/2型)に配慮し、
 * 「色相の分離」と「明度の分離」の両方を満たす組み合わせにした:
 *
 * - 色相: 暖色の琥珀/金 (Team A) vs 寒色の濃紺 (Team B)。赤緑の弁別が困難な色覚でも、
 *   青チャンネルの有無で判別できる組み合わせ (deuteranopia/protanopia の簡易シミュレーション
 *   行列で確認済み: 琥珀は黄系、濃紺は青紫系に見え、両者は引き続き明確に分離する)。
 * - 明度: 琥珀(輝度目安182/255)は明るく、濃紺(輝度目安64/255)は暗い。色そのものが
 *   区別できない状況(全色盲・低照度・グレースケール印刷等)でも明暗だけで判別できるよう
 *   意図的に輝度差を大きくした (単純な色相分離だけだと明度が近く、この保険が効かない)。
 * - GKは各チーム色の薄い(高明度)版を使い、フィールドプレイヤーと即座に区別できるようにする。
 *
 * UI要素(カーソルリング/パスマーカー)はチーム色とも緑のピッチとも被らないシアン/マゼンタに
 * して、「どちらのチームの選手にも埋没しない」ことを優先する。
 */
export const TEAM_COLORS: Readonly<Record<TeamId, { outfield: number; goalkeeper: number }>> = {
  [TeamId.A]: { outfield: 0xffb020, goalkeeper: 0xffe0a0 },
  [TeamId.B]: { outfield: 0x1c3fae, goalkeeper: 0x9fb8f0 },
};

export const BALL_COLOR = 0xffffff;
export const CURSOR_RING_COLOR = 0x00e5ff;
export const PASS_MARKER_COLOR = 0xff3df0;
/** 選手の「頭」(進行方向・向きを示す小さな円、人型シルエットの最小表現)の色。
 * どちらのチームでも同じ見え方にするため、チーム色と競合しない白系に統一する。 */
export const PLAYER_HEAD_COLOR = 0xfff2d9;
/** ゴールネットの線色 (仮値、控えめな白の半透明)。 */
export const GOAL_NET_COLOR = 0xffffff;
