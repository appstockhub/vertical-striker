import { describe, expect, it } from 'vitest';
import { fixedAdd, toFixed, ZERO_FIXED } from '../../src/core/fixed';
import { applyDribbleTouch, computeKickDribbleState, isNearBall } from '../../src/sim/dribble';
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
  it('overwrites ball velocity toward the movement direction when near and moving', () => {
    const b = ball({ vel: { x: ZERO_FIXED, y: ZERO_FIXED } });
    const next = applyDribbleTouch(b, true, Direction8.Right, false);
    expect(next.vel.x).toBe(DRIBBLE_TOUCH_SPEED_FIXED);
    expect(next.vel.y).toBe(ZERO_FIXED);
  });

  it('does not change the ball when the player is stationary (direction=None)', () => {
    const b = ball({ vel: { x: toFixed(1), y: toFixed(1) } });
    const next = applyDribbleTouch(b, true, Direction8.None, false);
    expect(next).toEqual(b);
  });

  it('does not change the ball when not near', () => {
    const b = ball({ vel: { x: toFixed(1), y: toFixed(1) } });
    const next = applyDribbleTouch(b, false, Direction8.Right, false);
    expect(next).toEqual(b);
  });

  it('does not touch an airborne ball (height above the touch threshold)', () => {
    const airborne = ball({ height: fixedAdd(DRIBBLE_TOUCH_MAX_HEIGHT_FIXED, toFixed(5)) });
    const next = applyDribbleTouch(airborne, true, Direction8.Right, false);
    expect(next).toEqual(airborne);
  });

  it('uses the faster kick-dribble speed when kickDribbleActive is true', () => {
    const b = ball();
    const next = applyDribbleTouch(b, true, Direction8.Right, true);
    expect(next.vel.x).toBe(LONG_DRIBBLE_TOUCH_SPEED_FIXED);
  });
});

describe('computeKickDribbleState (続編仕様: 蹴り出しドリブル)', () => {
  const none = emptyButtonState();
  const lOnly = { ...none, L: true };
  const rOnly = { ...none, R: true };
  const both = { ...none, L: true, R: true };

  it('L+R together triggers it fresh, even if not previously active', () => {
    expect(computeKickDribbleState(false, true, both)).toBe(true);
  });

  it('holding only L or only R does NOT trigger it fresh (must start with both)', () => {
    expect(computeKickDribbleState(false, true, lOnly)).toBe(false);
    expect(computeKickDribbleState(false, true, rOnly)).toBe(false);
  });

  it('once active, holding just one of L/R sustains it', () => {
    expect(computeKickDribbleState(true, true, lOnly)).toBe(true);
    expect(computeKickDribbleState(true, true, rOnly)).toBe(true);
    expect(computeKickDribbleState(true, true, both)).toBe(true);
  });

  it('releasing both L and R clears it', () => {
    expect(computeKickDribbleState(true, true, none)).toBe(false);
  });

  it('losing the ball (near=false) clears it immediately regardless of buttons', () => {
    expect(computeKickDribbleState(true, false, both)).toBe(false);
    expect(computeKickDribbleState(true, false, lOnly)).toBe(false);
  });
});
