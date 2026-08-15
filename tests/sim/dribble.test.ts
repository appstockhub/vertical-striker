import { describe, expect, it } from 'vitest';
import { fixedAdd, toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { applyDribbleTouch, computeKickDribbleState, isNearBall } from '../../src/sim/dribble';
import { Direction8, emptyButtonState } from '../../src/input/types';
import type { BallState } from '../../src/sim/state';
import {
  DRIBBLE_KEEP_SPEED_FIXED,
  DRIBBLE_TOUCH_MAX_HEIGHT_FIXED,
  DRIBBLE_TOUCH_SPEED_FIXED,
  LONG_DRIBBLE_TOUCH_SPEED_FIXED,
} from '../../src/sim/ballConstants';
import { PLAYER_SPEED_FIXED } from '../../src/sim/constants';

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
  it('足元(接触距離内)では前へ転がす速度で押し出す', () => {
    const b = ball({ vel: { x: ZERO_FIXED, y: ZERO_FIXED } });
    const next = applyDribbleTouch(b, true, true, Direction8.Right, false);
    expect(next.vel.x).toBe(DRIBBLE_TOUCH_SPEED_FIXED);
    expect(next.vel.y).toBe(ZERO_FIXED);
  });

  it('★逃げ防止★ 離れかけ(接触距離外・プレー可能な間合い内)では選手速度より遅い値に落とす', () => {
    // これが「ボールが永久に逃げてキックが効かない」実プレイ不具合の構造的な修正。
    // 押し出す速度が選手速度(3.0)を下回るので、選手は必ず追いつける。
    const b = ball({ vel: { x: ZERO_FIXED, y: ZERO_FIXED } });
    const next = applyDribbleTouch(b, true, false, Direction8.Right, false);
    expect(next.vel.x).toBe(DRIBBLE_KEEP_SPEED_FIXED);
    expect(toFloat(DRIBBLE_KEEP_SPEED_FIXED)).toBeLessThan(toFloat(PLAYER_SPEED_FIXED));
  });

  it('does not change the ball when the player is stationary (direction=None)', () => {
    const b = ball({ vel: { x: toFixed(1), y: toFixed(1) } });
    const next = applyDribbleTouch(b, true, true, Direction8.None, false);
    expect(next).toEqual(b);
  });

  it('does not change the ball when not near', () => {
    const b = ball({ vel: { x: toFixed(1), y: toFixed(1) } });
    const next = applyDribbleTouch(b, false, false, Direction8.Right, false);
    expect(next).toEqual(b);
  });

  it('does not touch an airborne ball (height above the touch threshold)', () => {
    const airborne = ball({ height: fixedAdd(DRIBBLE_TOUCH_MAX_HEIGHT_FIXED, toFixed(5)) });
    const next = applyDribbleTouch(airborne, true, true, Direction8.Right, false);
    expect(next).toEqual(airborne);
  });

  it('★18周目に挙動変更★ 蹴り出しドリブルは接触している時だけ押し出す', () => {
    // 旧挙動: 距離に関わらず毎tick速度6.0を与え続けていた。転がり摩擦が0.985と小さいため
    // ボールは加速し続け、実測で平均810px も離れて事実上ボールを捨てる動作になっていた。
    // 新挙動: 接触時のみ押し出す (押し出す→離れる→追いつく→また押す、というリズム)。
    // なお選手位置を渡す新しい追従モデル (update.ts の実経路) では、蹴り出しドリブルも
    // 「目標点を通常より前(16px)に置く」形で制御される。
    const b = ball();
    expect(applyDribbleTouch(b, true, true, Direction8.Right, true).vel.x).toBe(LONG_DRIBBLE_TOUCH_SPEED_FIXED);
    expect(applyDribbleTouch(b, true, false, Direction8.Right, true)).toEqual(b);
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
