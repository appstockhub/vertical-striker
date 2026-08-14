import { describe, expect, it } from 'vitest';
import { FULL_MATCH_DURATION_FRAMES, HALF_DURATION_FRAMES, getHalf, isFulltime, secondsElapsedInHalf } from '../../src/sim/matchClock';

describe('getHalf', () => {
  it('is half 1 for frame 0 and just before the boundary', () => {
    expect(getHalf(0)).toBe(1);
    expect(getHalf(HALF_DURATION_FRAMES - 1)).toBe(1);
  });

  it('is half 2 exactly at the boundary and beyond', () => {
    expect(getHalf(HALF_DURATION_FRAMES)).toBe(2);
    expect(getHalf(HALF_DURATION_FRAMES + 1)).toBe(2);
  });
});

describe('isFulltime', () => {
  it('is false just before the full-match boundary', () => {
    expect(isFulltime(FULL_MATCH_DURATION_FRAMES - 1)).toBe(false);
  });

  it('is true exactly at and beyond the full-match boundary', () => {
    expect(isFulltime(FULL_MATCH_DURATION_FRAMES)).toBe(true);
    expect(isFulltime(FULL_MATCH_DURATION_FRAMES + 100)).toBe(true);
  });
});

describe('secondsElapsedInHalf', () => {
  it('counts up from 0 in half 1', () => {
    expect(secondsElapsedInHalf(0)).toBe(0);
    expect(secondsElapsedInHalf(60)).toBe(1);
  });

  it('resets to 0 at the start of half 2', () => {
    expect(secondsElapsedInHalf(HALF_DURATION_FRAMES)).toBe(0);
    expect(secondsElapsedInHalf(HALF_DURATION_FRAMES + 60)).toBe(1);
  });
});
