import { TeamId } from '../sim/formations';

/** チーム/GK/UI要素の配色。Team A (人間操作) は Phase 1 の橙赤を踏襲、Team B は明確に異なる青系。 */
export const TEAM_COLORS: Readonly<Record<TeamId, { outfield: number; goalkeeper: number }>> = {
  [TeamId.A]: { outfield: 0xff5a1f, goalkeeper: 0xffb37a },
  [TeamId.B]: { outfield: 0x2f6fed, goalkeeper: 0x8fc4ff },
};

export const BALL_COLOR = 0xffffff;
export const CURSOR_RING_COLOR = 0xffe14d;
export const PASS_MARKER_COLOR = 0xffe14d;
