import { describe, expect, it } from 'vitest';
import { toFloat } from '../../src/core/fixed';
import { placeKickoffFormation } from '../../src/sim/kickoff';
import { FormationId, TeamId } from '../../src/sim/formations';
import { Direction8 } from '../../src/input/types';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../../src/config/pitch';

const FORMATIONS: readonly [FormationId, FormationId] = [FormationId.F442, FormationId.F442];

describe('placeKickoffFormation', () => {
  it('returns 22 players and a centered, stationary ball', () => {
    const { players, ball } = placeKickoffFormation(1, FORMATIONS);
    expect(players).toHaveLength(22);
    expect(toFloat(ball.pos.x)).toBeCloseTo(PITCH_WIDTH / 2, 1);
    expect(toFloat(ball.pos.y)).toBeCloseTo(PITCH_HEIGHT * 0.5, 1);
    expect(ball.vel.x).toBe(0);
    expect(ball.vel.y).toBe(0);
  });

  it('half 1: Team A faces Up (attacks toward y=0), Team B faces Down', () => {
    const { players } = placeKickoffFormation(1, FORMATIONS);
    for (const p of players) {
      if (p.team === TeamId.A) expect(p.facing).toBe(Direction8.Up);
      else expect(p.facing).toBe(Direction8.Down);
    }
  });

  it('half 2: facing flips for both teams (regression for the half-swap facing bug)', () => {
    const { players } = placeKickoffFormation(2, FORMATIONS);
    for (const p of players) {
      if (p.team === TeamId.A) expect(p.facing).toBe(Direction8.Down);
      else expect(p.facing).toBe(Direction8.Up);
    }
  });

  it('half 2: Team A GK is positioned near y=0 (mirrors half 1 Team B GK spot)', () => {
    const half1 = placeKickoffFormation(1, FORMATIONS);
    const half2 = placeKickoffFormation(2, FORMATIONS);
    const half1TeamBGK = half1.players[11];
    const half2TeamAGK = half2.players[0];
    expect(half1TeamBGK).toBeDefined();
    expect(half2TeamAGK).toBeDefined();
    if (half1TeamBGK && half2TeamAGK) {
      expect(toFloat(half2TeamAGK.pos.y)).toBeCloseTo(toFloat(half1TeamBGK.pos.y), 1);
    }
  });

  it('every player starts with zero velocity, no kick charge, and no tackle in progress', () => {
    const { players } = placeKickoffFormation(1, FORMATIONS);
    for (const p of players) {
      expect(p.vel.x).toBe(0);
      expect(p.vel.y).toBe(0);
      expect(p.kickChargeFrames).toBe(0);
      expect(p.tackleFrames).toBe(0);
    }
  });

  it('follows the players[] index convention (0=TeamA GK, 11=TeamB GK)', () => {
    const { players } = placeKickoffFormation(1, FORMATIONS);
    expect(players[0]?.team).toBe(TeamId.A);
    expect(players[0]?.isGoalkeeper).toBe(true);
    expect(players[11]?.team).toBe(TeamId.B);
    expect(players[11]?.isGoalkeeper).toBe(true);
  });

  it('is a pure function: same inputs always produce equal output', () => {
    const a = placeKickoffFormation(1, FORMATIONS);
    const b = placeKickoffFormation(1, FORMATIONS);
    expect(a).toEqual(b);
  });
});
