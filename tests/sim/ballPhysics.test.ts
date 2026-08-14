import { describe, expect, it } from 'vitest';
import { toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { clampToPitchBounds, stepBallPhysics } from '../../src/sim/ballPhysics';
import type { BallState } from '../../src/sim/state';
import { BALL_RADIUS_FIXED, GRAVITY_FIXED } from '../../src/sim/ballConstants';
import { PITCH_BOUNDS } from '../../src/sim/constants';

function ball(overrides: Partial<BallState> = {}): BallState {
  return {
    pos: { x: ZERO_FIXED, y: ZERO_FIXED },
    vel: { x: ZERO_FIXED, y: ZERO_FIXED },
    height: ZERO_FIXED,
    zVel: ZERO_FIXED,
    ...overrides,
  };
}

describe('stepBallPhysics', () => {
  it('applies gravity while airborne: height and zVel both decrease each tick', () => {
    const b = ball({ height: toFixed(10), zVel: ZERO_FIXED });
    const next = stepBallPhysics(b);
    expect(toFloat(next.zVel)).toBeCloseTo(-toFloat(GRAVITY_FIXED), 2);
    expect(toFloat(next.height)).toBeLessThan(10);
  });

  it('does NOT apply gravity to a resting ball (regression: initial state must not bounce forever)', () => {
    let state = ball(); // height=0, zVel=0, matches createInitialState's ball
    for (let i = 0; i < 300; i++) {
      state = stepBallPhysics(state);
      expect(state.height).toBe(ZERO_FIXED);
      expect(state.zVel).toBe(ZERO_FIXED);
    }
  });

  it('bounces when impact speed exceeds the settle threshold: height resets to 0, zVel reflects and damps', () => {
    // 十分な高さから開始し、地面に到達するまで数tick進める
    let state = ball({ height: toFixed(20), zVel: ZERO_FIXED });
    let bounced = false;
    let velBeforeImpact = 0;
    for (let i = 0; i < 60 && !bounced; i++) {
      const prevZVel = state.zVel;
      state = stepBallPhysics(state);
      if (state.height === ZERO_FIXED && toFloat(state.zVel) > 0) {
        bounced = true;
        velBeforeImpact = -toFloat(prevZVel);
      }
    }
    expect(bounced).toBe(true);
    expect(toFloat(state.zVel)).toBeGreaterThan(0);
    expect(toFloat(state.zVel)).toBeLessThan(velBeforeImpact);
  });

  it('settles without bouncing when impact speed is below the threshold', () => {
    // height が小さく、1tick分の重力だけでは閾値を超えないケース
    const b = ball({ height: toFixed(0.05), zVel: ZERO_FIXED });
    const next = stepBallPhysics(b);
    expect(next.height).toBe(ZERO_FIXED);
    expect(next.zVel).toBe(ZERO_FIXED);
  });

  it('converges to exactly zero height/zVel after many bounces', () => {
    let state = ball({ height: toFixed(30), zVel: ZERO_FIXED });
    for (let i = 0; i < 500; i++) {
      state = stepBallPhysics(state);
    }
    expect(state.height).toBe(ZERO_FIXED);
    expect(state.zVel).toBe(ZERO_FIXED);
  });

  it('applies rolling friction to horizontal velocity only while grounded, converging to exactly zero', () => {
    let state = ball({ vel: { x: toFixed(5), y: ZERO_FIXED } });
    for (let i = 0; i < 500; i++) {
      state = stepBallPhysics(state);
    }
    expect(state.vel.x).toBe(ZERO_FIXED);
  });

  it('does not apply rolling friction while airborne (horizontal velocity unchanged)', () => {
    const b = ball({ height: toFixed(10), vel: { x: toFixed(5), y: ZERO_FIXED } });
    const next = stepBallPhysics(b);
    expect(next.vel.x).toBe(b.vel.x);
  });

  it('keeps the ball within pitch bounds after a long roll toward a wall', () => {
    let state = ball({ pos: { x: PITCH_BOUNDS.maxX, y: ZERO_FIXED }, vel: { x: toFixed(20), y: ZERO_FIXED } });
    for (let i = 0; i < 200; i++) {
      state = stepBallPhysics(state);
    }
    expect(toFloat(state.pos.x)).toBeLessThanOrEqual(toFloat(PITCH_BOUNDS.maxX));
  });
});

describe('clampToPitchBounds', () => {
  it('clamps a position outside the pitch back within bounds minus the radius', () => {
    const clamped = clampToPitchBounds({ x: toFixed(-100), y: toFixed(-100) }, BALL_RADIUS_FIXED);
    expect(toFloat(clamped.x)).toBeCloseTo(toFloat(BALL_RADIUS_FIXED), 3);
    expect(toFloat(clamped.y)).toBeCloseTo(toFloat(BALL_RADIUS_FIXED), 3);
  });
});
