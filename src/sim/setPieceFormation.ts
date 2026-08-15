import { distSqFixed, toFixed } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';
import { Direction8 } from '../input/types';
import { attackingIsUpward, opponentOf, teamDefendsNorth, TeamId, type Half } from './formations';
import { PENALTY_AREA_DEPTH_FIXED, PENALTY_AREA_WIDTH_FIXED, penaltySpot } from './foul';
import { TacklePhase, type PlayerState } from './state';
import { KICKOFF_KICKER_STANDOFF_FIXED } from './boundsConstants';
import { PLAYER_RADIUS_FIXED } from './constants';
import { clampToPitchBounds } from './ballPhysics';

/**
 * フリーキック / ペナルティキックの選手配置 (競技規則 第13〜14条)。
 *
 * スローイン等と同じく「ボールを瞬間移動させ、キッカーもその場に置く」方式で統一する
 * (試合を止めない設計。誰も蹴りに来ない停止バグの再発防止 — restartTaken.test.ts 参照)。
 */

export interface SetPiecePlacement {
  readonly players: PlayerState[];
  /** キッカーの players[] index (カーソルスナップに使う)。 */
  readonly kickerIndex: number;
}

/** ボールへ最も近い team の選手 (GKは除外可)。 */
function nearestIndex(
  players: readonly PlayerState[],
  pos: Vec2Fixed,
  team: TeamId,
  excludeGoalkeeper: boolean,
): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  let found = false;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p || p.team !== team) continue;
    if (excludeGoalkeeper && p.isGoalkeeper) continue;
    const d = distSqFixed(pos, p.pos) as number;
    if (!found || d < bestDist) {
      best = i;
      bestDist = d;
      found = true;
    }
  }
  return best;
}

/**
 * フリーキックの配置。キッカーをボールの後ろ (自陣側) へ置いて攻撃方向を向かせる。
 * 相手の「9.15m離れる」は update.ts の setPieceLock 側の押し出しが担当する。
 */
export function placeFreeKick(
  players: readonly PlayerState[],
  ballPos: Vec2Fixed,
  restartTeam: TeamId,
  half: Half,
): SetPiecePlacement {
  const attackUp = attackingIsUpward(restartTeam, half);
  const kickerIndex = nearestIndex(players, ballPos, restartTeam, true);
  const standoff = attackUp
    ? (KICKOFF_KICKER_STANDOFF_FIXED as number)
    : -(KICKOFF_KICKER_STANDOFF_FIXED as number);
  const kickerPos = clampToPitchBounds(
    { x: ballPos.x, y: ((ballPos.y as number) + standoff) as Fixed },
    PLAYER_RADIUS_FIXED,
  );
  const next = players.map((p, i) =>
    i === kickerIndex
      ? {
          ...p,
          pos: kickerPos,
          vel: { x: 0 as Fixed, y: 0 as Fixed },
          facing: attackUp ? Direction8.Up : Direction8.Down,
          tacklePhase: TacklePhase.None,
          tackleFrames: 0,
          tackleDirection: Direction8.None,
        }
      : p,
  );
  return { players: next, kickerIndex };
}

/**
 * ペナルティキックの配置 (第14条)。
 *   - ボールはペナルティスポット (呼び出し側が設置する)
 *   - キッカーはスポットの後ろ
 *   - 守備側GKはゴールライン上、ボールに面する
 *   - それ以外の全員はペナルティエリアの外、かつボールより後方
 */
export function placePenaltyKick(
  players: readonly PlayerState[],
  restartTeam: TeamId,
  half: Half,
): { placement: SetPiecePlacement; ballPos: Vec2Fixed } {
  const defendingTeam = opponentOf(restartTeam);
  const spot = penaltySpot(defendingTeam, half);
  const attackUp = attackingIsUpward(restartTeam, half);
  const kickerIndex = nearestIndex(players, spot, restartTeam, true);

  const goalLineY: Fixed = teamDefendsNorth(defendingTeam, half)
    ? (toFixed(6) as Fixed)
    : ((toFixed(PITCH_HEIGHT) as number) - (toFixed(6) as number)) as Fixed;
  // ペナルティエリアの外側の境界 (この線より「ボール側」に他の選手を置かない)。
  const boxEdgeY: Fixed = teamDefendsNorth(defendingTeam, half)
    ? PENALTY_AREA_DEPTH_FIXED
    : (((toFixed(PITCH_HEIGHT) as number) - (PENALTY_AREA_DEPTH_FIXED as number)) as Fixed);
  // ボックスの外へ退かす方向 (攻撃方向の逆 = 自陣側)。
  const outwardSign = attackUp ? 1 : -1;

  let waiting = 0;
  const next = players.map((p, i) => {
    if (i === kickerIndex) {
      const standoff = attackUp
        ? (KICKOFF_KICKER_STANDOFF_FIXED as number)
        : -(KICKOFF_KICKER_STANDOFF_FIXED as number);
      return {
        ...p,
        pos: clampToPitchBounds(
          { x: spot.x, y: ((spot.y as number) + standoff) as Fixed },
          PLAYER_RADIUS_FIXED,
        ),
        vel: { x: 0 as Fixed, y: 0 as Fixed },
        facing: attackUp ? Direction8.Up : Direction8.Down,
        tacklePhase: TacklePhase.None,
        tackleFrames: 0,
        tackleDirection: Direction8.None,
      };
    }
    if (p.isGoalkeeper && p.team === defendingTeam) {
      // 守備側GK: ゴールライン上、ボールに正対する。
      return {
        ...p,
        pos: { x: toFixed(PITCH_WIDTH / 2), y: goalLineY },
        vel: { x: 0 as Fixed, y: 0 as Fixed },
        facing: attackUp ? Direction8.Down : Direction8.Up,
      };
    }
    if (p.isGoalkeeper) {
      return p; // 攻撃側GKはそのまま (自陣に居る)
    }
    // それ以外: ペナルティエリアの外、ボールより後方へ並べる。
    // 横一列に均等配置して、密集して押し出しが暴れるのを防ぐ。
    const laneCount = 9;
    const lane = waiting % laneCount;
    waiting++;
    const spread = (PENALTY_AREA_WIDTH_FIXED as number) / 2 + toFixed(30);
    const x = ((toFixed(PITCH_WIDTH / 2) as number) - spread + (lane * spread * 2) / (laneCount - 1)) as Fixed;
    const y = ((boxEdgeY as number) + outwardSign * (toFixed(28) as number) * (1 + Math.floor(waiting / laneCount))) as Fixed;
    return {
      ...p,
      pos: clampToPitchBounds({ x, y }, PLAYER_RADIUS_FIXED),
      vel: { x: 0 as Fixed, y: 0 as Fixed },
      tacklePhase: TacklePhase.None,
      tackleFrames: 0,
      tackleDirection: Direction8.None,
    };
  });

  return { placement: { players: next, kickerIndex }, ballPos: spot };
}
