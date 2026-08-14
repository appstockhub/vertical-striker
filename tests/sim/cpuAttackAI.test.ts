import { describe, expect, it } from 'vitest';
import { toFixed, ZERO_FIXED } from '../../src/core/fixed';
import { createRng } from '../../src/core/rng';
import { decideCpuAttack } from '../../src/sim/cpuAttackAI';
import { TeamId } from '../../src/sim/formations';
import { Direction8 } from '../../src/input/types';
import { TacklePhase, type PlayerState } from '../../src/sim/state';

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

// half=1: Team B は南(y=1800側、Team Aのゴール)へ攻める (formations.tsの規約: 前半はTeam Bが北側を守る)。
const HALF1 = 1 as const;
const RNG = createRng(1);

describe('decideCpuAttack (half 1: Team B attacks south/down)', () => {
  it('shoots when close to goal and within lateral range, aiming away from the keeper', () => {
    const carrier = makePlayer(240, 1750, TeamId.B, 9); // ゴール(240,1800)のすぐ手前
    const keeperOnLeft = makePlayer(200, 1780, TeamId.A, 0); // ゴール中央より左
    const players: PlayerState[] = [];
    players[0] = keeperOnLeft;
    players[12] = carrier;

    const result = decideCpuAttack(12, players, HALF1, 'hard', RNG);
    expect(result.action).toBe('shoot');
    expect(result.passTargetIndex).toBeNull();
    expect(result.direction).not.toBe(Direction8.None);
    // キーパーが左寄りなので、遠い右ポストを狙う -> 方向は右寄り(x成分が正)になるはず
    expect([Direction8.Right, Direction8.DownRight]).toContain(result.direction);
  });

  it('aims toward the opposite side when the keeper stands on the right', () => {
    const carrier = makePlayer(240, 1750, TeamId.B, 9);
    const keeperOnRight = makePlayer(280, 1780, TeamId.A, 0); // ゴール中央より右
    const players: PlayerState[] = [];
    players[0] = keeperOnRight;
    players[12] = carrier;

    const result = decideCpuAttack(12, players, HALF1, 'hard', RNG);
    expect(result.action).toBe('shoot');
    expect([Direction8.Left, Direction8.DownLeft]).toContain(result.direction);
  });

  it('does not consume RNG on the "hard" tier (zero aim noise)', () => {
    const carrier = makePlayer(240, 1750, TeamId.B, 9);
    const keeper = makePlayer(200, 1780, TeamId.A, 0);
    const players: PlayerState[] = [];
    players[0] = keeper;
    players[12] = carrier;

    const result = decideCpuAttack(12, players, HALF1, 'hard', RNG);
    expect(result.rngState).toBe(RNG);
  });

  it('consumes RNG (aim noise) on the "easy" tier', () => {
    const carrier = makePlayer(240, 1750, TeamId.B, 9);
    const keeper = makePlayer(200, 1780, TeamId.A, 0);
    const players: PlayerState[] = [];
    players[0] = keeper;
    players[12] = carrier;

    const result = decideCpuAttack(12, players, HALF1, 'easy', RNG);
    expect(result.rngState).not.toBe(RNG);
  });

  it('is deterministic: same inputs always produce the same decision', () => {
    const carrier = makePlayer(240, 1750, TeamId.B, 9);
    const keeper = makePlayer(200, 1780, TeamId.A, 0);
    const players: PlayerState[] = [];
    players[0] = keeper;
    players[12] = carrier;

    const a = decideCpuAttack(12, players, HALF1, 'easy', RNG);
    const b = decideCpuAttack(12, players, HALF1, 'easy', RNG);
    expect(a).toEqual(b);
  });

  it('passes to a teammate in the forward cone when out of shooting range', () => {
    const carrier = makePlayer(240, 900, TeamId.B, 9, { facing: Direction8.Down }); // ゴールまで遠い
    const receiver = makePlayer(240, 950, TeamId.B, 8); // 前方(南)、近い
    const players: PlayerState[] = [];
    players[12] = carrier;
    players[11] = receiver;

    const result = decideCpuAttack(12, players, HALF1, 'easy', RNG);
    expect(result.action).toBe('pass');
    expect(result.passTargetIndex).toBe(11);
    expect(result.rngState).toBe(RNG); // パス経路ではRNGを消費しない
  });

  it('dribbles toward the opponent goal when neither shooting nor passing is available', () => {
    const carrier = makePlayer(240, 900, TeamId.B, 9, { facing: Direction8.Down }); // 味方も射程内にゴールも無い
    const players: PlayerState[] = [];
    players[12] = carrier;

    const result = decideCpuAttack(12, players, HALF1, 'easy', RNG);
    expect(result.action).toBe('dribble');
    expect(result.passTargetIndex).toBeNull();
    expect(result.direction).toBe(Direction8.Down); // ゴールはこの選手の真南
  });
});

describe('decideCpuAttack (half 2: attack direction flips)', () => {
  it('now shoots toward the north goal (y=0) since Team B attacks north in half 2', () => {
    const carrier = makePlayer(240, 50, TeamId.B, 9);
    const keeper = makePlayer(200, 20, TeamId.A, 0);
    const players: PlayerState[] = [];
    players[0] = keeper;
    players[12] = carrier;

    const result = decideCpuAttack(12, players, 2, 'hard', RNG);
    expect(result.action).toBe('shoot');
  });
});
