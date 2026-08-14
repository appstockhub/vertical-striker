import { describe, expect, it } from 'vitest';
import { fixedAdd, toFixed, ZERO_FIXED } from '../../src/core/fixed';
import { applyDribbleTouch, isLongDribbleActive, isNearBall } from '../../src/sim/dribble';
import { Direction8, emptyButtonState } from '../../src/input/types';
import type { BallState } from '../../src/sim/state';
import {
  DRIBBLE_TOUCH_MAX_HEIGHT_FIXED,
  DRIBBLE_TOUCH_SPEED_FIXED,
  LONG_DRIBBLE_TOUCH_SPEED_FIXED,
} from '../../src/sim/ballConstants';

function ball(overrides: Partial<BallState> = {}): BallState {
  return {
    pos: { x: ZERO_FIXED, y: ZERO_FIXED },
    vel: { x: ZERO_FIXED, y: ZERO_FIXED },
    height: ZERO_FIXED,
    zVel: ZERO_FIXED,
    ...overrides,
  };
}

describe('isNearBall', () => {
  it('is true within the dribble radius', () => {
    expect(isNearBall({ x: ZERO_FIXED, y: ZERO_FIXED }, { x: toFixed(5), y: ZERO_FIXED })).toBe(true);
  });

  it('is false outside the dribble radius', () => {
    expect(isNearBall({ x: ZERO_FIXED, y: ZERO_FIXED }, { x: toFixed(100), y: ZERO_FIXED })).toBe(false);
  });
});

describe('applyDribbleTouch', () => {
  const buttonsNone = emptyButtonState();
  const buttonsL = { ...emptyButtonState(), L: true };

  it('overwrites ball velocity toward the movement direction when near and moving', () => {
    const b = ball({ vel: { x: ZERO_FIXED, y: ZERO_FIXED } });
    const next = applyDribbleTouch(b, true, Direction8.Right, buttonsNone);
    expect(next.vel.x).toBe(DRIBBLE_TOUCH_SPEED_FIXED);
    expect(next.vel.y).toBe(ZERO_FIXED);
  });

  it('does not change the ball when the player is stationary (direction=None)', () => {
    const b = ball({ vel: { x: toFixed(1), y: toFixed(1) } });
    const next = applyDribbleTouch(b, true, Direction8.None, buttonsNone);
    expect(next).toEqual(b);
  });

  it('does not change the ball when not near', () => {
    const b = ball({ vel: { x: toFixed(1), y: toFixed(1) } });
    const next = applyDribbleTouch(b, false, Direction8.Right, buttonsNone);
    expect(next).toEqual(b);
  });

  it('does not touch an airborne ball (height above the touch threshold)', () => {
    const airborne = ball({ height: fixedAdd(DRIBBLE_TOUCH_MAX_HEIGHT_FIXED, toFixed(5)) });
    const next = applyDribbleTouch(airborne, true, Direction8.Right, buttonsNone);
    expect(next).toEqual(airborne);
  });

  it('uses the faster long-dribble speed when L/R is held', () => {
    const b = ball();
    const next = applyDribbleTouch(b, true, Direction8.Right, buttonsL);
    expect(next.vel.x).toBe(LONG_DRIBBLE_TOUCH_SPEED_FIXED);
  });
});

describe('isLongDribbleActive', () => {
  it('requires near + moving + (L or R)', () => {
    const buttonsL = { ...emptyButtonState(), L: true };
    const buttonsNone = emptyButtonState();

    expect(isLongDribbleActive(true, Direction8.Up, buttonsL)).toBe(true);
    expect(isLongDribbleActive(false, Direction8.Up, buttonsL)).toBe(false); // not near
    expect(isLongDribbleActive(true, Direction8.None, buttonsL)).toBe(false); // not moving
    expect(isLongDribbleActive(true, Direction8.Up, buttonsNone)).toBe(false); // no L/R
  });
});
