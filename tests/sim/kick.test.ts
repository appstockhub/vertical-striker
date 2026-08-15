import { describe, expect, it } from 'vitest';
import { toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { applyKick, shiftKickDirection, updateKickCharge } from '../../src/sim/kick';
import { Direction8, emptyButtonState } from '../../src/input/types';
import type { BallState, PlayerState } from '../../src/sim/state';
import {
  HIGH_ARC_SPEED_MULTIPLIER_FIXED,
  KICK_MAX_CHARGE_FRAMES,
  KICK_Z_VEL_MAX_FIXED,
  KICK_Z_VEL_MIN_FIXED,
  STRONG_KICK_SPEED_FIXED,
  WEAK_KICK_SPEED_FIXED,
} from '../../src/sim/ballConstants';

function ball(): BallState {
  return { pos: { x: ZERO_FIXED, y: ZERO_FIXED }, vel: { x: ZERO_FIXED, y: ZERO_FIXED }, height: ZERO_FIXED, zVel: ZERO_FIXED };
}

function player(facing: Direction8 = Direction8.Up): PlayerState {
  return { pos: { x: ZERO_FIXED, y: ZERO_FIXED }, vel: { x: ZERO_FIXED, y: ZERO_FIXED }, facing, kickChargeFrames: 0 };
}

describe('updateKickCharge', () => {
  it('increments while B is held, clamped at KICK_MAX_CHARGE_FRAMES', () => {
    let frames = 0;
    for (let i = 0; i < KICK_MAX_CHARGE_FRAMES + 10; i++) {
      const result = updateKickCharge(frames, true);
      frames = result.nextFrames;
      expect(result.releasedFrames).toBe(0);
    }
    expect(frames).toBe(KICK_MAX_CHARGE_FRAMES);
  });

  it('reports releasedFrames on the tick B is let go, then resets to 0', () => {
    const held1 = updateKickCharge(0, true);
    const held2 = updateKickCharge(held1.nextFrames, true);
    const released = updateKickCharge(held2.nextFrames, false);
    expect(released.releasedFrames).toBe(2);
    expect(released.nextFrames).toBe(0);

    const idle = updateKickCharge(released.nextFrames, false);
    expect(idle.releasedFrames).toBe(0);
    expect(idle.nextFrames).toBe(0);
  });
});

describe('applyKick', () => {
  it('short press + direction -> strong grounder (min zVel, full horizontal speed)', () => {
    const next = applyKick(ball(), player(), 1, Direction8.Right);
    expect(next.zVel).toBe(KICK_Z_VEL_MIN_FIXED);
    expect(toFloat(next.vel.x)).toBeCloseTo(toFloat(STRONG_KICK_SPEED_FIXED), 1);
    expect(next.vel.y).toBe(ZERO_FIXED);
  });

  it('max-charge press + direction -> high loft, reduced horizontal speed', () => {
    const next = applyKick(ball(), player(), KICK_MAX_CHARGE_FRAMES, Direction8.Right);
    expect(next.zVel).toBe(KICK_Z_VEL_MAX_FIXED);
    const expectedSpeed = toFloat(STRONG_KICK_SPEED_FIXED) * toFloat(HIGH_ARC_SPEED_MULTIPLIER_FIXED);
    expect(toFloat(next.vel.x)).toBeCloseTo(expectedSpeed, 1);
    expect(toFloat(next.vel.x)).toBeLessThan(toFloat(STRONG_KICK_SPEED_FIXED));
  });

  it('release with no direction -> weak kick using player.facing', () => {
    const next = applyKick(ball(), player(Direction8.Left), 1, Direction8.None);
    expect(toFloat(-next.vel.x)).toBeCloseTo(toFloat(WEAK_KICK_SPEED_FIXED), 1); // facing Left => negative x
    expect(toFloat(next.vel.x)).not.toBeCloseTo(toFloat(STRONG_KICK_SPEED_FIXED), 1);
  });

  it('trajectory ratio increases zVel and decreases horizontal speed monotonically with charge', () => {
    const short = applyKick(ball(), player(), 1, Direction8.Right);
    const mid = applyKick(ball(), player(), Math.round(KICK_MAX_CHARGE_FRAMES / 2), Direction8.Right);
    const long = applyKick(ball(), player(), KICK_MAX_CHARGE_FRAMES, Direction8.Right);

    expect(toFloat(short.zVel)).toBeLessThanOrEqual(toFloat(mid.zVel));
    expect(toFloat(mid.zVel)).toBeLessThanOrEqual(toFloat(long.zVel));
    expect(toFloat(short.vel.x)).toBeGreaterThanOrEqual(toFloat(mid.vel.x));
    expect(toFloat(mid.vel.x)).toBeGreaterThanOrEqual(toFloat(long.vel.x));
  });
});

describe('shiftKickDirection (続編仕様: シフトキック)', () => {
  const none = emptyButtonState();

  it('no L/R held -> direction unchanged', () => {
    expect(shiftKickDirection(Direction8.Up, none)).toBe(Direction8.Up);
  });

  it('both L and R held -> direction unchanged (ambiguous, treated as no shift)', () => {
    expect(shiftKickDirection(Direction8.Up, { ...none, L: true, R: true })).toBe(Direction8.Up);
  });

  it('R held -> rotates one compass step clockwise', () => {
    expect(shiftKickDirection(Direction8.Up, { ...none, R: true })).toBe(Direction8.UpRight);
    expect(shiftKickDirection(Direction8.Right, { ...none, R: true })).toBe(Direction8.DownRight);
  });

  it('L held -> rotates one compass step counter-clockwise', () => {
    expect(shiftKickDirection(Direction8.Up, { ...none, L: true })).toBe(Direction8.UpLeft);
    expect(shiftKickDirection(Direction8.Right, { ...none, L: true })).toBe(Direction8.UpRight);
  });

  it('wraps around the compass (Up-Left + L -> Left)', () => {
    expect(shiftKickDirection(Direction8.UpLeft, { ...none, L: true })).toBe(Direction8.Left);
  });

  it('Direction8.None is never shifted (no base direction to rotate)', () => {
    expect(shiftKickDirection(Direction8.None, { ...none, L: true })).toBe(Direction8.None);
    expect(shiftKickDirection(Direction8.None, { ...none, R: true })).toBe(Direction8.None);
  });
});

describe('applyKick with shift kick (続編仕様)', () => {
  it('R held during a strong kick shifts the resulting velocity direction clockwise', () => {
    const straight = applyKick(ball(), player(), 1, Direction8.Up);
    const shifted = applyKick(ball(), player(), 1, Direction8.Up, { ...emptyButtonState(), R: true });
    // Up (0, -1) -> UpRight (+, -): x成分が0から正に変わる。
    expect(straight.vel.x).toBe(ZERO_FIXED);
    expect(toFloat(shifted.vel.x)).toBeGreaterThan(0);
    expect(toFloat(shifted.vel.y)).toBeLessThan(0);
  });

  it('shift also applies to weak kicks (no direction input, uses player.facing)', () => {
    const straight = applyKick(ball(), player(Direction8.Up), 1, Direction8.None);
    const shifted = applyKick(ball(), player(Direction8.Up), 1, Direction8.None, { ...emptyButtonState(), L: true });
    expect(straight.vel.x).toBe(ZERO_FIXED);
    expect(toFloat(shifted.vel.x)).toBeLessThan(0); // Up + L -> UpLeft
  });

  it('omitting buttons (existing callers: cursor pass / CPU kicks) leaves direction unshifted', () => {
    const next = applyKick(ball(), player(), 1, Direction8.Up);
    expect(next.vel.x).toBe(ZERO_FIXED);
  });
});
