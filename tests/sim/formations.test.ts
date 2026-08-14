import { describe, expect, it } from 'vitest';
import { toFloat } from '../../src/core/fixed';
import { FormationId, TeamId, attackingIsUpward, getHomePosition, teamDefendsNorth } from '../../src/sim/formations';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../../src/config/pitch';

describe('formations (half 1: Team A defends south/large-y, Team B defends north/y=0)', () => {
  it('places Team A GK near the large-y end (own goal) and Team B GK near y=0', () => {
    const gkA = getHomePosition(TeamId.A, 0, FormationId.F442, 1);
    const gkB = getHomePosition(TeamId.B, 0, FormationId.F442, 1);
    expect(toFloat(gkA.y)).toBeGreaterThan(PITCH_HEIGHT * 0.9);
    expect(toFloat(gkB.y)).toBeLessThan(PITCH_HEIGHT * 0.1);
  });

  it('mirrors Team A and Team B outfield depth around the halfway line', () => {
    for (let slot = 1; slot <= 10; slot++) {
      const a = getHomePosition(TeamId.A, slot, FormationId.F442, 1);
      const b = getHomePosition(TeamId.B, slot, FormationId.F442, 1);
      // 同じ slotIndex は同じ xFrac/depthFrac を使うため、halfway (PITCH_HEIGHT/2) を挟んで対称になる
      const halfway = PITCH_HEIGHT / 2;
      expect(toFloat(a.y) - halfway).toBeCloseTo(halfway - toFloat(b.y), 0);
      expect(a.x).toBe(b.x);
    }
  });

  it('keeps every slot within pitch bounds for all 4 formations and both halves', () => {
    for (const formationId of Object.values(FormationId)) {
      for (const team of [TeamId.A, TeamId.B]) {
        for (const half of [1, 2] as const) {
          for (let slot = 0; slot <= 10; slot++) {
            const pos = getHomePosition(team, slot, formationId, half);
            expect(toFloat(pos.x)).toBeGreaterThanOrEqual(0);
            expect(toFloat(pos.x)).toBeLessThanOrEqual(PITCH_WIDTH);
            expect(toFloat(pos.y)).toBeGreaterThanOrEqual(0);
            expect(toFloat(pos.y)).toBeLessThanOrEqual(PITCH_HEIGHT);
          }
        }
      }
    }
  });

  it('throws for an out-of-range slotIndex', () => {
    expect(() => getHomePosition(TeamId.A, 11, FormationId.F442, 1)).toThrow();
  });

  it('attackingIsUpward is true for Team A, false for Team B in half 1', () => {
    expect(attackingIsUpward(TeamId.A, 1)).toBe(true);
    expect(attackingIsUpward(TeamId.B, 1)).toBe(false);
  });
});

describe('formations (half 2: sides swap)', () => {
  it('teamDefendsNorth flips for both teams between half 1 and half 2', () => {
    expect(teamDefendsNorth(TeamId.A, 1)).toBe(false);
    expect(teamDefendsNorth(TeamId.A, 2)).toBe(true);
    expect(teamDefendsNorth(TeamId.B, 1)).toBe(true);
    expect(teamDefendsNorth(TeamId.B, 2)).toBe(false);
  });

  it('attackingIsUpward flips for both teams in half 2', () => {
    expect(attackingIsUpward(TeamId.A, 2)).toBe(false);
    expect(attackingIsUpward(TeamId.B, 2)).toBe(true);
  });

  it('places Team A GK near y=0 and Team B GK near the large-y end in half 2 (mirror of half 1)', () => {
    const gkA = getHomePosition(TeamId.A, 0, FormationId.F442, 2);
    const gkB = getHomePosition(TeamId.B, 0, FormationId.F442, 2);
    expect(toFloat(gkA.y)).toBeLessThan(PITCH_HEIGHT * 0.1);
    expect(toFloat(gkB.y)).toBeGreaterThan(PITCH_HEIGHT * 0.9);
  });

  it('an outfield slot mirrors its half-1 Y position around the halfway line in half 2', () => {
    const half1 = getHomePosition(TeamId.A, 1, FormationId.F442, 1);
    const half2 = getHomePosition(TeamId.A, 1, FormationId.F442, 2);
    const halfway = PITCH_HEIGHT / 2;
    expect(toFloat(half2.y) - halfway).toBeCloseTo(halfway - toFloat(half1.y), 0);
    expect(half1.x).toBe(half2.x);
  });
});
