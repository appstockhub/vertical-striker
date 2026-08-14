import { describe, expect, it } from 'vitest';
import { createRng, nextRangeInt, nextUint32 } from '../../src/core/rng';

describe('mulberry32 rng', () => {
  it('is deterministic for a given seed', () => {
    const seedA = createRng(42);
    const seedB = createRng(42);

    let stateA = seedA;
    let stateB = seedB;
    const outA: number[] = [];
    const outB: number[] = [];
    for (let i = 0; i < 20; i++) {
      const [va, na] = nextUint32(stateA);
      const [vb, nb] = nextUint32(stateB);
      outA.push(va);
      outB.push(vb);
      stateA = na;
      stateB = nb;
    }
    expect(outA).toEqual(outB);
  });

  it('produces different streams for different seeds', () => {
    let stateA = createRng(1);
    let stateB = createRng(2);
    const [va] = nextUint32(stateA);
    const [vb] = nextUint32(stateB);
    expect(va).not.toBe(vb);
  });

  it('does not mutate external state (pure, state-passing)', () => {
    const state = createRng(7);
    nextUint32(state);
    expect(state).toBe(createRng(7));
  });

  it('nextRangeInt stays within [min, max)', () => {
    let state = createRng(99);
    for (let i = 0; i < 100; i++) {
      const [v, next] = nextRangeInt(state, 5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(10);
      state = next;
    }
  });
});
