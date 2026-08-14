import { describe, expect, it } from 'vitest';
import { toFixed, ZERO_FIXED } from '../../src/core/fixed';
import { checkOffside } from '../../src/sim/offsideRule';
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

// half=1: Team A は北(y小さい方向)へ攻める、Team B が北側を守る (formations.ts の規約と同じ)。
// Team B のDFライン (2番目に深い選手のY) はここでは y=162 になるよう配置する。
function teamBBackLine(): PlayerState[] {
  return [
    makePlayer(240, 36, TeamId.B, 0),
    makePlayer(100, 162, TeamId.B, 1),
    makePlayer(200, 162, TeamId.B, 2),
    makePlayer(300, 162, TeamId.B, 3),
  ];
}

describe('checkOffside (half 1: Team A attacks north/up)', () => {
  it('is offside when a teammate is in the opponent half and beyond the opponent back line', () => {
    const kicker = makePlayer(100, 500, TeamId.A, 9);
    const advancedTeammate = makePlayer(200, 100, TeamId.A, 8); // 相手陣内、DFライン(162)より前
    const players = [kicker, advancedTeammate, ...teamBBackLine()];
    const result = checkOffside(0, TeamId.A, players, 1);
    expect(result.offside).toBe(true);
    expect(result.offsidePlayerIndex).toBe(1);
  });

  it('is not offside when the advanced teammate is level with or behind the opponent back line', () => {
    const kicker = makePlayer(100, 500, TeamId.A, 9);
    const teammate = makePlayer(200, 200, TeamId.A, 8); // DFライン(162)より深い(自陣寄り)
    const players = [kicker, teammate, ...teamBBackLine()];
    const result = checkOffside(0, TeamId.A, players, 1);
    expect(result.offside).toBe(false);
    expect(result.offsidePlayerIndex).toBeNull();
  });

  it('excludes the kicker themself from the check, even if the kicker is deep in the opponent half', () => {
    const kicker = makePlayer(200, 50, TeamId.A, 9);
    const players = [kicker, ...teamBBackLine()];
    const result = checkOffside(0, TeamId.A, players, 1);
    expect(result.offside).toBe(false);
  });

  it('excludes a teammate who is technically beyond the line value but still in their own half (advanced defensive line)', () => {
    const kicker = makePlayer(100, 300, TeamId.A, 9);
    // Team Bのラインがハーフウェー(900)を越えて押し上げられている、という極端な配置。
    const teammate = makePlayer(200, 920, TeamId.A, 8); // 自陣(y>900)だが、ライン(950)より前
    const advancedTeamB = [
      makePlayer(240, 900, TeamId.B, 0),
      makePlayer(100, 950, TeamId.B, 1),
      makePlayer(200, 950, TeamId.B, 2),
    ];
    const players = [kicker, teammate, ...advancedTeamB];
    const result = checkOffside(0, TeamId.A, players, 1);
    expect(result.offside).toBe(false);
  });

  it('when multiple teammates are offside, picks the lowest players[] index', () => {
    const kicker = makePlayer(100, 500, TeamId.A, 9);
    const t1 = makePlayer(150, 50, TeamId.A, 7); // index 1
    const t2 = makePlayer(250, 30, TeamId.A, 8); // index 2
    const players = [kicker, t1, t2, ...teamBBackLine()];
    const result = checkOffside(0, TeamId.A, players, 1);
    expect(result.offside).toBe(true);
    expect(result.offsidePlayerIndex).toBe(1);
  });

  it('a Team B kicker is checked against Team A\'s back line (symmetry)', () => {
    const kicker = makePlayer(240, 1300, TeamId.B, 9);
    const advanced = makePlayer(240, 1790, TeamId.B, 8); // Team Aの自陣(南側)深くまで攻め上がっている
    const teamABackLine = [
      makePlayer(240, 1764, TeamId.A, 0),
      makePlayer(100, 1638, TeamId.A, 1),
      makePlayer(200, 1638, TeamId.A, 2),
    ];
    const players = [kicker, advanced, ...teamABackLine];
    const result = checkOffside(0, TeamId.B, players, 1);
    expect(result.offside).toBe(true);
  });
});

describe('checkOffside (half 2: attack direction flips)', () => {
  it('Team A now attacks south/down, so being deep in the south end can be offside', () => {
    const kicker = makePlayer(100, 1300, TeamId.A, 9);
    const advanced = makePlayer(200, 1750, TeamId.A, 8);
    const teamB = [
      makePlayer(240, 1764, TeamId.B, 0), // half2: Team B defends south now
      makePlayer(100, 1638, TeamId.B, 1),
      makePlayer(200, 1638, TeamId.B, 2),
    ];
    const players = [kicker, advanced, ...teamB];
    const result = checkOffside(0, TeamId.A, players, 2);
    expect(result.offside).toBe(true);
  });
});
