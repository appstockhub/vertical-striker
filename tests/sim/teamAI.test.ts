import { describe, expect, it } from 'vitest';
import { toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { computeNonControlledDirection, computeOffsideLine } from '../../src/sim/teamAI';
import { createInitialState } from '../../src/sim/state';
import type { PlayerState } from '../../src/sim/state';
import { TeamId, FormationId } from '../../src/sim/formations';
import { Direction8 } from '../../src/input/types';
import { TacklePhase } from '../../src/sim/state';

function makePlayer(
  x: number,
  y: number,
  team: TeamId,
  slotIndex: number,
  overrides: Partial<PlayerState> = {},
): PlayerState {
  return {
    pos: { x: toFixed(x), y: toFixed(y) },
    vel: { x: ZERO_FIXED, y: ZERO_FIXED },
    facing: Direction8.Up,
    kickChargeFrames: 0,
    team,
    isGoalkeeper: slotIndex === 0,
    slotIndex,
    tacklePhase: TacklePhase.None,
    tackleFrames: 0,
    tackleDirection: Direction8.None,
    ...overrides,
  };
}

const FORMATIONS: readonly [FormationId, FormationId] = [FormationId.F442, FormationId.F442];

describe('computeOffsideLine', () => {
  it('is the Y of the 2nd-deepest player (index 1 among ascending-depth-from-own-goal)', () => {
    // Team B (自陣は y=0側): GK y=10(最も深い), DF y=50(2番目に深い), FW y=300
    const players = [
      makePlayer(0, 10, TeamId.B, 0),
      makePlayer(100, 50, TeamId.B, 1),
      makePlayer(200, 300, TeamId.B, 9),
    ];
    const line = computeOffsideLine(players, TeamId.B, 1);
    expect(toFloat(line)).toBeCloseTo(50, 3);
  });

  it('handles an exact tie for deepest without throwing, and both tied players share the same Y', () => {
    // 2人のCBが完全に同じ深さ (左右対称のキックオフでよく起きる)
    const players = [
      makePlayer(100, 162, TeamId.A, 1),
      makePlayer(300, 162, TeamId.A, 2),
      makePlayer(200, 900, TeamId.A, 9),
    ];
    const line = computeOffsideLine(players, TeamId.A, 1);
    // 2番目に深い選手のYは、タイの2人のどちらが選ばれても同じ値になる
    expect(toFloat(line)).toBeCloseTo(162, 3);
  });

  it('works against the real 22-player kickoff state without throwing', () => {
    const state = createInitialState(1);
    expect(() => computeOffsideLine(state.players, TeamId.A, 1)).not.toThrow();
    expect(() => computeOffsideLine(state.players, TeamId.B, 1)).not.toThrow();
    expect(() => computeOffsideLine(state.players, TeamId.A, 2)).not.toThrow();
  });
});

describe('computeNonControlledDirection', () => {
  it('home-pull dominates when the ball is co-located (no ball attraction) and offside is not triggered', () => {
    // Team A DF (slotIndex 1) の home は (72, 1638) 付近。プレイヤーをその真上に置く
    // (同じx、home.yより小さいy) -> home方向は Down。ボールを同じ位置に置き ballDir=None にする。
    const player = makePlayer(72, 1538, TeamId.A, 1);
    const ballPos = player.pos; // 同一座標 -> ballDir は deadzone で None
    const teamB = Array.from({ length: 11 }, (_, slot) => makePlayer(240, 100 + slot * 5, TeamId.B, slot));
    const direction = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1);
    expect(direction).toBe(Direction8.Down);
  });

  it('ball-attraction dominates when the player is already at home (no home pull)', () => {
    const player = makePlayer(72, 1638, TeamId.A, 1); // 4-4-2 DF1 の home ちょうど
    const ballPos = { x: toFixed(72), y: toFixed(1438) }; // 真上 (小さいy) -> Up
    const teamB = Array.from({ length: 11 }, (_, slot) => makePlayer(240, 100 + slot * 5, TeamId.B, slot));
    const direction = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1);
    expect(direction).toBe(Direction8.Up);
  });

  it('offside bias reinforces home-pull, pushing a too-advanced attacker back toward their own half', () => {
    // Team A FW (slotIndex 9) の home x=168。そのxのまま、相手ゴール前深く (y=50) に置く
    // -> Team Bのオフサイドライン(既定フォーメーションで約162)より前に出ている。
    const player = makePlayer(168, 50, TeamId.A, 9);
    const ballPos = player.pos; // ballDir=None にして home+offside の効果に絞る
    // Team B は実際のキックオフフォーメーションで配置する (現実的なオフサイドライン値にするため)
    const state = createInitialState(1);
    const realTeamB = state.players.slice(11, 22);
    const direction = computeNonControlledDirection(player, [player, ...realTeamB], ballPos, FORMATIONS, 1);
    // home(y=1035, 遠い)・offside、どちらも「自陣方向(y増加=Down)」を向くため Down になる
    expect(direction).toBe(Direction8.Down);
  });

  it('combines home-pull and ball-attraction into a direction leaning toward both influences', () => {
    // home が右(Right)方向、ボールが上(Up)方向にあるケース。
    // HOME_WEIGHT(1.0) > BALL_WEIGHT(0.6) なので、水平成分(Right由来)が優勢になり、
    // 結果は Right 寄り (Right か UpRight のいずれか) になるはず。
    const player = makePlayer(0, 1638, TeamId.A, 1); // home は (72, 1638) = 真右
    const ballPos = { x: ZERO_FIXED, y: toFixed(1438) }; // 真上
    const teamB = Array.from({ length: 11 }, (_, slot) => makePlayer(240, 100 + slot * 5, TeamId.B, slot));
    const direction = computeNonControlledDirection(player, [player, ...teamB], ballPos, FORMATIONS, 1);
    expect([Direction8.Right, Direction8.UpRight]).toContain(direction);
  });

  it('does not throw against the real 22-player kickoff state for every player', () => {
    const state = createInitialState(1);
    for (const player of state.players) {
      expect(() =>
        computeNonControlledDirection(player, state.players, state.ball.pos, state.teamFormations, 1),
      ).not.toThrow();
    }
  });
});
