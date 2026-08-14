import { describe, expect, it } from 'vitest';
import { toFixed, ZERO_FIXED } from '../../src/core/fixed';
import { quantizeToDirection8 } from '../../src/sim/steering';
import { Direction8 } from '../../src/input/types';

const NO_DEADZONE = ZERO_FIXED;

describe('quantizeToDirection8', () => {
  it('returns None for a near-zero vector under the deadzone', () => {
    const deadzone = toFixed(5);
    expect(quantizeToDirection8({ x: toFixed(0.1), y: toFixed(0.1) }, deadzone)).toBe(Direction8.None);
  });

  it('quantizes the 4 cardinal directions exactly', () => {
    expect(quantizeToDirection8({ x: ZERO_FIXED, y: toFixed(-10) }, NO_DEADZONE)).toBe(Direction8.Up);
    expect(quantizeToDirection8({ x: ZERO_FIXED, y: toFixed(10) }, NO_DEADZONE)).toBe(Direction8.Down);
    expect(quantizeToDirection8({ x: toFixed(-10), y: ZERO_FIXED }, NO_DEADZONE)).toBe(Direction8.Left);
    expect(quantizeToDirection8({ x: toFixed(10), y: ZERO_FIXED }, NO_DEADZONE)).toBe(Direction8.Right);
  });

  it('quantizes the 4 diagonal directions exactly', () => {
    expect(quantizeToDirection8({ x: toFixed(10), y: toFixed(-10) }, NO_DEADZONE)).toBe(Direction8.UpRight);
    expect(quantizeToDirection8({ x: toFixed(10), y: toFixed(10) }, NO_DEADZONE)).toBe(Direction8.DownRight);
    expect(quantizeToDirection8({ x: toFixed(-10), y: toFixed(10) }, NO_DEADZONE)).toBe(Direction8.DownLeft);
    expect(quantizeToDirection8({ x: toFixed(-10), y: toFixed(-10) }, NO_DEADZONE)).toBe(Direction8.UpLeft);
  });

  it('picks the angularly nearest direction for a non-aligned vector', () => {
    // ほぼ真上だが少し右寄り -> Up が最も近い (UpRightには届かない角度)
    expect(quantizeToDirection8({ x: toFixed(1), y: toFixed(-20) }, NO_DEADZONE)).toBe(Direction8.Up);
  });

  it('is deterministic for the same input (repeated calls agree)', () => {
    const v = { x: toFixed(7), y: toFixed(-3) };
    const first = quantizeToDirection8(v, NO_DEADZONE);
    const second = quantizeToDirection8(v, NO_DEADZONE);
    expect(first).toBe(second);
  });

  it('magnitude does not affect the chosen direction (only angle matters)', () => {
    const small = quantizeToDirection8({ x: toFixed(1), y: toFixed(-1) }, NO_DEADZONE);
    const large = quantizeToDirection8({ x: toFixed(100), y: toFixed(-100) }, NO_DEADZONE);
    expect(small).toBe(large);
    expect(small).toBe(Direction8.UpRight);
  });
});
