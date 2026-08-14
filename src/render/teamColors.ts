import { TeamId } from '../sim/formations';

/**
 * チーム/GK/UI要素の配色。Team A (人間操作) は Phase 1 の橙赤を踏襲、Team B は明確に異なる青系。
 * 橙赤vs青は色相環でほぼ正反対かつ warm/cool が明確に分かれるため、赤緑弱/緑赤弱でも
 * 区別しやすい組み合わせとして意図的に選んでいる (Phase 4後半、見た目の最小限改善で再確認済み)。
 */
export const TEAM_COLORS: Readonly<Record<TeamId, { outfield: number; goalkeeper: number }>> = {
  [TeamId.A]: { outfield: 0xff5a1f, goalkeeper: 0xffb37a },
  [TeamId.B]: { outfield: 0x2f6fed, goalkeeper: 0x8fc4ff },
};

export const BALL_COLOR = 0xffffff;
export const CURSOR_RING_COLOR = 0xffe14d;
export const PASS_MARKER_COLOR = 0xffe14d;
/** 選手の向き表示(facing pip)の色。チーム色と競合しない白系に統一し、どちらのチームでも同じ見え方にする。 */
export const FACING_PIP_COLOR = 0xffffff;
/** ゴールネットの線色 (仮値、控えめな白の半透明)。 */
export const GOAL_NET_COLOR = 0xffffff;
