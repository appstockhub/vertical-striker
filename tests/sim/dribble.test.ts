import { describe, expect, it } from 'vitest';
import { toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { applyDribbleTouch, computeKickDribbleState, isInDribbleContact, isNearBall } from '../../src/sim/dribble';
import { Direction8, emptyButtonState } from '../../src/input/types';
import type { BallState } from '../../src/sim/state';
import {
  DRIBBLE_TOUCH_MAX_HEIGHT_FIXED,
  DRIBBLE_TOUCH_SPEED_FIXED,
  DRIBBLE_TRAP_DAMPING_FIXED,
  KICKOUT_IMPULSE_SPEED_FIXED,
} from '../../src/sim/ballConstants';

/**
 * ★24周目サイクル②で全面書き直し★ 離散タッチ方式 (dribble.ts 冒頭のモデル解説) の契約:
 *  1. 接触半径内のtickだけタッチが発火し、touched=true を返す
 *  2. 接触外・クールダウン中は一切干渉しない (touched=false、ボール無変更)
 *  3. ニュートラルでは遅いボールをトラップ減衰させる (touched=false)
 *  4. 蹴り出しドリブル中の接触は KICKOUT_IMPULSE の大きな押し出し
 *
 * 旧テストは追従サーボモデルのデッドコード (蹴り出し分岐に到達しない旧引数系) だけを
 * 検証していた (凍結文書の「空振りテスト」の1つ)。
 */

function ball(overrides: Partial<BallState> = {}): BallState {
  return {
    pos: { x: ZERO_FIXED, y: ZERO_FIXED },
    vel: { x: ZERO_FIXED, y: ZERO_FIXED },
    height: ZERO_FIXED,
    zVel: ZERO_FIXED,
    ...overrides,
  };
}

describe('isNearBall / isInDribbleContact', () => {
  it('プレー間合い(20px)と接触半径(7px)の2段構えになっている', () => {
    const origin = { x: ZERO_FIXED, y: ZERO_FIXED };
    expect(isNearBall(origin, { x: toFixed(15), y: ZERO_FIXED })).toBe(true);
    expect(isNearBall(origin, { x: toFixed(25), y: ZERO_FIXED })).toBe(false);
    expect(isInDribbleContact(origin, { x: toFixed(6), y: ZERO_FIXED })).toBe(true);
    expect(isInDribbleContact(origin, { x: toFixed(8), y: ZERO_FIXED })).toBe(false);
  });
});

describe('applyDribbleTouch (離散タッチ)', () => {
  it('接触中のタッチは入力方向へ DRIBBLE_TOUCH_SPEED で押し出し、touched=true', () => {
    const r = applyDribbleTouch(ball(), true, true, Direction8.Up, false);
    expect(r.touched).toBe(true);
    expect(toFloat(r.ball.vel.y)).toBeCloseTo(-toFloat(DRIBBLE_TOUCH_SPEED_FIXED), 1);
  });

  it('接触していないtickはボールに一切干渉しない (離散性の核)', () => {
    const rolling = ball({ vel: { x: ZERO_FIXED, y: toFixed(-0.5) } });
    const r = applyDribbleTouch(rolling, true, false, Direction8.Up, false);
    expect(r.touched).toBe(false);
    expect(r.ball).toBe(rolling);
  });

  it('クールダウン中は接触してもタッチが発火しない (歩幅=リズムの実体)', () => {
    const r = applyDribbleTouch(ball(), true, true, Direction8.Up, false, true);
    expect(r.touched).toBe(false);
    expect(r.ball.vel.y).toBe(ZERO_FIXED);
  });

  it('タッチ速度以上で転がっているボールには触れない (キック直後を殺さない)', () => {
    const kicked = ball({ vel: { x: ZERO_FIXED, y: toFixed(-2.7) } });
    const r = applyDribbleTouch(kicked, true, true, Direction8.Up, false);
    expect(r.touched).toBe(false);
    expect(r.ball).toBe(kicked);
  });

  it('ニュートラル入力では足元の遅いボールをトラップ減衰させる (不具合#7の恒久対策)', () => {
    const slow = ball({ vel: { x: ZERO_FIXED, y: toFixed(-0.6) } });
    const r = applyDribbleTouch(slow, true, true, Direction8.None, false);
    expect(r.touched).toBe(false);
    const expected = -0.6 * toFloat(DRIBBLE_TRAP_DAMPING_FIXED);
    expect(toFloat(r.ball.vel.y)).toBeCloseTo(expected, 2);
  });

  it('ニュートラルでも速いボール (キック直後) はトラップしない', () => {
    const fast = ball({ vel: { x: ZERO_FIXED, y: toFixed(-2.7) } });
    const r = applyDribbleTouch(fast, true, true, Direction8.None, false);
    expect(r.ball).toBe(fast);
  });

  it('プレー間合いの外では何もしない', () => {
    const rolling = ball({ vel: { x: toFixed(1), y: ZERO_FIXED } });
    const r = applyDribbleTouch(rolling, false, false, Direction8.Up, false);
    expect(r.ball).toBe(rolling);
    expect(r.touched).toBe(false);
  });

  it('浮き球には触れない (キックのみ)', () => {
    const airborne = ball({ height: toFixed(toFloat(DRIBBLE_TOUCH_MAX_HEIGHT_FIXED) + 1) });
    const r = applyDribbleTouch(airborne, true, true, Direction8.Up, false);
    expect(r.touched).toBe(false);
  });

  it('蹴り出しドリブル中の接触は KICKOUT_IMPULSE で大きく蹴り出す [不具合#6]', () => {
    const r = applyDribbleTouch(ball(), true, true, Direction8.Up, true);
    expect(r.touched).toBe(true);
    expect(toFloat(r.ball.vel.y)).toBeCloseTo(-toFloat(KICKOUT_IMPULSE_SPEED_FIXED), 1);
  });

  it('蹴り出しドリブルでも接触していなければ蹴り出さない', () => {
    const r = applyDribbleTouch(ball(), true, false, Direction8.Up, true);
    expect(r.touched).toBe(false);
  });
});

describe('computeKickDribbleState (仕様は変更なし)', () => {
  const btn = (l: boolean, r: boolean) => ({ ...emptyButtonState(), L: l, R: r });

  it('L+R同時押しで新規トリガー', () => {
    expect(computeKickDribbleState(false, true, btn(true, true))).toBe(true);
  });

  it('片方押しっぱなしで継続、両方離すと解除', () => {
    expect(computeKickDribbleState(true, true, btn(true, false))).toBe(true);
    expect(computeKickDribbleState(true, true, btn(false, true))).toBe(true);
    expect(computeKickDribbleState(true, true, btn(false, false))).toBe(false);
  });

  it('最初から片方だけでは発動しない', () => {
    expect(computeKickDribbleState(false, true, btn(true, false))).toBe(false);
  });

  it('ボールが間合いに無ければ即解除', () => {
    expect(computeKickDribbleState(true, false, btn(true, true))).toBe(false);
  });
});
