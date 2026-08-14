import { describe, expect, it } from 'vitest';
import { toFloat } from '../../src/core/fixed';
import { FormationId, TeamId, attackingIsUpward, getHomePosition } from '../../src/sim/formations';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../../src/config/pitch';

describe('formations', () => {
  it('places Team A GK near the large-y end (own goal) and Team B GK near y=0', () => {
    const gkA = getHomePosition(TeamId.A, 0, FormationId.F442);
    const gkB = getHomePosition(TeamId.B, 0, FormationId.F442);
    expect(toFloat(gkA.y)).toBeGreaterThan(PITCH_HEIGHT * 0.9);
    expect(toFloat(gkB.y)).toBeLessThan(PITCH_HEIGHT * 0.1);
  });

  it('mirrors Team A and Team B outfield depth around the halfway line', () => {
    for (let slot = 1; slot <= 10; slot++) {
      const a = getHomePosition(TeamId.A, slot, FormationId.F442);
      const b = getHomePosition(TeamId.B, slot, FormationId.F442);
      // 同じ slotIndex は同じ xFrac/depthFrac を使うため、halfway (PITCH_HEIGHT/2) を挟んで対称になる
      const halfway = PITCH_HEIGHT / 2;
      expect(toFloat(a.y) - halfway).toBeCloseTo(halfway - toFloat(b.y), 0);
      expect(a.x).toBe(b.x);
    }
  });

  it('keeps every slot within pitch bounds for all 4 formations', () => {
    for (const formationId of Object.values(FormationId)) {
      for (const team of [TeamId.A, TeamId.B]) {
        for (let slot = 0; slot <= 10; slot++) {
          const pos = getHomePosition(team, slot, formationId);
          expect(toFloat(pos.x)).toBeGreaterThanOrEqual(0);
          expect(toFloat(pos.x)).toBeLessThanOrEqual(PITCH_WIDTH);
          expect(toFloat(pos.y)).toBeGreaterThanOrEqual(0);
          expect(toFloat(pos.y)).toBeLessThanOrEqual(PITCH_HEIGHT);
        }
      }
    }
  });

  it('throws for an out-of-range slotIndex', () => {
    expect(() => getHomePosition(TeamId.A, 11, FormationId.F442)).toThrow();
  });

  it('attackingIsUpward is true for Team A, false for Team B', () => {
    expect(attackingIsUpward(TeamId.A)).toBe(true);
    expect(attackingIsUpward(TeamId.B)).toBe(false);
  });
});
