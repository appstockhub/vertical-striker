import { describe, expect, it } from 'vitest';
import { toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { clampToPitchBounds, stepBallPhysics, stepBallPhysicsDetailed } from '../../src/sim/ballPhysics';
import type { BallState } from '../../src/sim/state';
import { BALL_RADIUS_FIXED, CURVE_DURATION_TICKS, GRAVITY_FIXED } from '../../src/sim/ballConstants';
import { PITCH_BOUNDS } from '../../src/sim/constants';
import { Direction8 } from '../../src/input/types';

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
    // height が小さく、落下時の速度が閾値を超えないケース。
    // テンポ変更追従: 重力が BALL_TEMPO² 倍 (0.35→0.0315) になり、1tickでは地面に
    // 届かなくなったため、着地まで数tick進める。「一度もバウンドせずに静止する」
    // (zVelが正に反転しない) という検証の意味は変えない。
    let state = ball({ height: toFixed(0.05), zVel: ZERO_FIXED });
    for (let i = 0; i < 5; i++) {
      state = stepBallPhysics(state);
      expect(toFloat(state.zVel), `t${i}: バウンドしてしまった`).toBeLessThanOrEqual(0);
      if (state.height === ZERO_FIXED) break;
    }
    expect(state.height).toBe(ZERO_FIXED);
    expect(state.zVel).toBe(ZERO_FIXED);
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

describe('stepBallPhysicsDetailed', () => {
  it('reports a tentativePos that goes beyond the pitch edge, unlike the clamped ball.pos (Phase 3 milestone 3: bounds detection needs the pre-clamp position)', () => {
    const b = ball({ pos: { x: PITCH_BOUNDS.maxX, y: ZERO_FIXED }, vel: { x: toFixed(20), y: ZERO_FIXED } });
    const step = stepBallPhysicsDetailed(b);
    expect(toFloat(step.tentativePos.x)).toBeGreaterThan(toFloat(PITCH_BOUNDS.maxX));
    expect(toFloat(step.ball.pos.x)).toBeLessThanOrEqual(toFloat(PITCH_BOUNDS.maxX));
  });

  it('stepBallPhysics is a thin wrapper returning the same ball as stepBallPhysicsDetailed().ball', () => {
    const b = ball({ height: toFixed(10), vel: { x: toFixed(3), y: toFixed(-2) } });
    expect(stepBallPhysics(b)).toEqual(stepBallPhysicsDetailed(b).ball);
  });
});

describe('stepBallPhysicsDetailed: curve (続編仕様③)', () => {
  it('does nothing when curveDirection is None/absent (existing behavior unchanged)', () => {
    const b = ball({ vel: { x: toFixed(5), y: ZERO_FIXED }, height: toFixed(10) });
    const next = stepBallPhysicsDetailed(b).ball;
    expect(next.vel.y).toBe(ZERO_FIXED);
  });

  // ★24周目サイクル①: カーブは「毎tick加算」から「CURVE_ROTATION_INTERVAL(4)tickごとの
  // 速度ベクトル回転」へ方式変更 (量子化対策、ballConstants.ts参照)。契約を新方式に合わせた:
  // 「INTERVAL tick以内に必ず曲がり始め、回転の適用ごとに単調に曲がっていく」。
  it('bends the trajectory sideways within one rotation interval while curveTicksLeft > 0', () => {
    let state = ball({
      vel: { x: toFixed(5), y: ZERO_FIXED },
      height: toFixed(10),
      curveDirection: Direction8.Down,
      curveTicksLeft: CURVE_DURATION_TICKS,
    });
    for (let i = 0; i < 4; i++) state = stepBallPhysicsDetailed(state).ball;
    expect(toFloat(state.vel.y)).toBeGreaterThan(0); // Down方向のカーブでy成分が正に
    expect(state.curveTicksLeft).toBe(CURVE_DURATION_TICKS - 4);
    expect(state.curveDirection).toBe(Direction8.Down);
  });

  it('curve accumulates over rotation intervals, bending the path further over time', () => {
    let state = ball({
      vel: { x: toFixed(5), y: ZERO_FIXED },
      height: toFixed(50),
      curveDirection: Direction8.Down,
      curveTicksLeft: CURVE_DURATION_TICKS,
    });
    const yVelAtInterval: number[] = [];
    for (let block = 0; block < 5; block++) {
      for (let i = 0; i < 4; i++) state = stepBallPhysicsDetailed(state).ball;
      yVelAtInterval.push(toFloat(state.vel.y));
    }
    for (let i = 1; i < yVelAtInterval.length; i++) {
      expect(yVelAtInterval[i]!).toBeGreaterThan(yVelAtInterval[i - 1]!);
    }
  });

  it('curve stops (direction resets to None) once curveTicksLeft is exhausted', () => {
    let state = ball({
      vel: { x: toFixed(5), y: ZERO_FIXED },
      height: toFixed(50),
      curveDirection: Direction8.Down,
      curveTicksLeft: 1,
    });
    state = stepBallPhysicsDetailed(state).ball;
    expect(state.curveTicksLeft).toBe(0);
    expect(state.curveDirection).toBe(Direction8.None);
    const yVelWhenExhausted = toFloat(state.vel.y);

    const before = state;
    state = stepBallPhysicsDetailed(state).ball;
    expect(toFloat(state.vel.y)).toBeCloseTo(yVelWhenExhausted, 5); // これ以上曲がらない
    expect(state.vel.x).toBe(before.vel.x);
  });

  it('curveWindowTicksLeft decays by 1 each tick down to 0 (window itself does not curve the ball)', () => {
    let state = ball({ curveWindowTicksLeft: 3 });
    state = stepBallPhysicsDetailed(state).ball;
    expect(state.curveWindowTicksLeft).toBe(2);
    state = stepBallPhysicsDetailed(state).ball;
    expect(state.curveWindowTicksLeft).toBe(1);
    state = stepBallPhysicsDetailed(state).ball;
    expect(state.curveWindowTicksLeft).toBe(0);
    state = stepBallPhysicsDetailed(state).ball;
    expect(state.curveWindowTicksLeft).toBe(0); // 0未満にはならない
  });
});

describe('clampToPitchBounds', () => {
  it('clamps a position outside the pitch back within bounds minus the radius', () => {
    const clamped = clampToPitchBounds({ x: toFixed(-100), y: toFixed(-100) }, BALL_RADIUS_FIXED);
    expect(toFloat(clamped.x)).toBeCloseTo(toFloat(BALL_RADIUS_FIXED), 3);
    expect(toFloat(clamped.y)).toBeCloseTo(toFloat(BALL_RADIUS_FIXED), 3);
  });
});
