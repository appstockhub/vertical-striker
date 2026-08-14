import { toFixed } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';
import { TeamId, teamDefendsNorth, type Half } from './formations';
import { GOAL_CENTER_X_FIXED, GOAL_HALF_WIDTH_FIXED } from './goalkeeperConstants';
import {
  CORNER_INSET_FIXED,
  CROSSBAR_HEIGHT_FIXED,
  GOAL_KICK_DEPTH_FIXED,
  THROW_IN_INSET_FIXED,
  THROW_IN_Y_MARGIN_FIXED,
} from './boundsConstants';

export type BoundaryEvent =
  | { readonly type: 'goal'; readonly scoringTeam: TeamId }
  | { readonly type: 'throwIn'; readonly restartTeam: TeamId; readonly pos: Vec2Fixed }
  | { readonly type: 'goalKick'; readonly restartTeam: TeamId; readonly pos: Vec2Fixed }
  | { readonly type: 'corner'; readonly restartTeam: TeamId; readonly pos: Vec2Fixed };

function otherTeam(team: TeamId): TeamId {
  return team === TeamId.A ? TeamId.B : TeamId.A;
}

const PITCH_WIDTH_FIXED = toFixed(PITCH_WIDTH) as number;
const PITCH_HEIGHT_FIXED = toFixed(PITCH_HEIGHT) as number;

/**
 * ボール(クランプ前の仮位置)がこのtickで境界を越えたかを判定する純関数。
 * `tentativePos` は sim/ballPhysics.ts の stepBallPhysicsDetailed が返す
 * 「クランプ前」の位置 (クランプ後の位置では境界越えを検出できないため必須)。
 *
 * 判定優先順位 (計画セクションC): 同tickでゴールラインとサイドラインを同時に
 * 越えた場合 (コーナー付近) はゴールライン判定を優先する。
 */
export function detectBoundaryEvent(
  tentativePos: Vec2Fixed,
  ballHeight: Fixed,
  half: Half,
  lastTouchTeam: TeamId | null,
): BoundaryEvent | null {
  const x = tentativePos.x as number;
  const y = tentativePos.y as number;

  if (y <= 0 || y >= PITCH_HEIGHT_FIXED) {
    const edgeIsNorth = y <= 0;
    const teamADefendsNorth = teamDefendsNorth(TeamId.A, half);
    const defendingTeam = edgeIsNorth === teamADefendsNorth ? TeamId.A : TeamId.B;
    const attackingTeam = otherTeam(defendingTeam);

    const withinGoalWidth = Math.abs(x - (GOAL_CENTER_X_FIXED as number)) <= (GOAL_HALF_WIDTH_FIXED as number);
    const underCrossbar = (ballHeight as number) <= (CROSSBAR_HEIGHT_FIXED as number);
    if (withinGoalWidth && underCrossbar) {
      return { type: 'goal', scoringTeam: attackingTeam };
    }

    // ゴールにならなかった枠外/バー超え: 最後に触れたのが守備側ならコーナー(攻撃側)、
    // それ以外(攻撃側が最後に触れた、またはlastTouchTeamが無い)ならゴールキック(守備側)。
    const cornerToAttacker = lastTouchTeam === defendingTeam;
    const restartTeam = cornerToAttacker ? attackingTeam : defendingTeam;
    const restartX = cornerToAttacker
      ? x < (GOAL_CENTER_X_FIXED as number)
        ? (CORNER_INSET_FIXED as number)
        : PITCH_WIDTH_FIXED - (CORNER_INSET_FIXED as number)
      : (GOAL_CENTER_X_FIXED as number);
    const restartY = edgeIsNorth
      ? cornerToAttacker
        ? (CORNER_INSET_FIXED as number)
        : (GOAL_KICK_DEPTH_FIXED as number)
      : cornerToAttacker
        ? PITCH_HEIGHT_FIXED - (CORNER_INSET_FIXED as number)
        : PITCH_HEIGHT_FIXED - (GOAL_KICK_DEPTH_FIXED as number);

    return {
      type: cornerToAttacker ? 'corner' : 'goalKick',
      restartTeam,
      pos: { x: restartX as Fixed, y: restartY as Fixed },
    };
  }

  if (x <= 0 || x >= PITCH_WIDTH_FIXED) {
    // ゴールラインを跨いでいない場合のみサイドライン判定へ進む。復帰チームは
    // 最後に触れた側の相手 (lastTouchTeamが無ければ安全側のデフォルトとしてTeam A)。
    const restartTeam = lastTouchTeam !== null ? otherTeam(lastTouchTeam) : TeamId.A;
    const restartX = x <= 0 ? (THROW_IN_INSET_FIXED as number) : PITCH_WIDTH_FIXED - (THROW_IN_INSET_FIXED as number);
    const restartY = Math.min(
      Math.max(y, THROW_IN_Y_MARGIN_FIXED as number),
      PITCH_HEIGHT_FIXED - (THROW_IN_Y_MARGIN_FIXED as number),
    );
    return { type: 'throwIn', restartTeam, pos: { x: restartX as Fixed, y: restartY as Fixed } };
  }

  return null;
}
