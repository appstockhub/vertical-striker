import { describe, expect, it } from 'vitest';
import {
  FIXED_ONE,
  clampFixed,
  fixedAdd,
  fixedDiv,
  fixedMul,
  fixedSub,
  toFixed,
  toFloat,
  vAdd,
} from '../../src/core/fixed';
import type { Fixed } from '../../src/core/types';

describe('fixed-point math', () => {
  it('round-trips px -> Fixed -> px', () => {
    expect(toFloat(toFixed(10))).toBe(10);
    expect(toFloat(toFixed(-3.5))).toBeCloseTo(-3.5, 2);
  });

  it('FIXED_ONE represents 1.0', () => {
    expect(FIXED_ONE).toBe(256);
    expect(toFloat(FIXED_ONE as Fixed)).toBe(1);
  });

  it('fixedAdd/fixedSub are exact integer ops', () => {
    const a = toFixed(2);
    const b = toFixed(3);
    expect(fixedAdd(a, b)).toBe(toFixed(5));
    expect(fixedSub(b, a)).toBe(toFixed(1));
  });

  it('fixedMul multiplies in Fixed scale (2.0 * 3.0 = 6.0)', () => {
    const a = toFixed(2);
    const b = toFixed(3);
    expect(toFloat(fixedMul(a, b))).toBe(6);
  });

  it('fixedDiv divides in Fixed scale (6.0 / 3.0 = 2.0)', () => {
    const a = toFixed(6);
    const b = toFixed(3);
    expect(toFloat(fixedDiv(a, b))).toBe(2);
  });

  it('clampFixed clamps within bounds', () => {
    const lo = toFixed(0);
    const hi = toFixed(10);
    expect(toFloat(clampFixed(toFixed(-5), lo, hi))).toBe(0);
    expect(toFloat(clampFixed(toFixed(15), lo, hi))).toBe(10);
    expect(toFloat(clampFixed(toFixed(5), lo, hi))).toBe(5);
  });

  it('vAdd adds vectors component-wise', () => {
    const a = { x: toFixed(1), y: toFixed(2) };
    const b = { x: toFixed(3), y: toFixed(4) };
    const sum = vAdd(a, b);
    expect(toFloat(sum.x)).toBe(4);
    expect(toFloat(sum.y)).toBe(6);
  });
});
