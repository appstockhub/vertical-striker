import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { Direction8, emptyButtonState } from '../../src/input/types';

function inputs(direction: Direction8) {
  return { direction, buttons: emptyButtonState() };
}

describe('simulate (pure state transition)', () => {
  it('is deterministic: same seed + same input sequence -> identical states', () => {
    const sequence = [
      Direction8.Up,
      Direction8.Up,
      Direction8.UpRight,
      Direction8.Right,
      Direction8.None,
      Direction8.DownLeft,
    ];

    let stateA = createInitialState(123);
    let stateB = createInitialState(123);

    for (const dir of sequence) {
      stateA = simulate(stateA, inputs(dir));
      stateB = simulate(stateB, inputs(dir));
    }

    expect(stateA).toEqual(stateB);
  });

  it('does not mutate the input state object', () => {
    const state = createInitialState(1);
    const snapshotBefore = JSON.parse(JSON.stringify(state));
    simulate(state, inputs(Direction8.Up));
    expect(state).toEqual(snapshotBefore);
  });

  it('moves the player up when Direction8.Up is held', () => {
    const state = createInitialState(1);
    const next = simulate(state, inputs(Direction8.Up));
    expect(next.player.pos.y).toBeLessThan(state.player.pos.y);
    expect(next.player.pos.x).toBe(state.player.pos.x);
  });

  it('diagonal movement has the same speed as cardinal movement', () => {
    const state = createInitialState(1);
    const up = simulate(state, inputs(Direction8.Up));
    const upRight = simulate(state, inputs(Direction8.UpRight));

    const upDist = Math.abs(state.player.pos.y - up.player.pos.y);
    const upRightDx = Math.abs(state.player.pos.x - upRight.player.pos.x);
    const upRightDy = Math.abs(state.player.pos.y - upRight.player.pos.y);
    const upRightDist = Math.sqrt(upRightDx ** 2 + upRightDy ** 2);

    // 事前正規化された対角ベクトルにより、誤差1程度で速度が一致する
    expect(Math.abs(upDist - upRightDist)).toBeLessThanOrEqual(1);
  });

  it('increments the frame counter each tick', () => {
    const state = createInitialState(1);
    const next = simulate(state, inputs(Direction8.None));
    expect(next.frame).toBe(state.frame + 1);
  });

  it('keeps the player within pitch bounds', () => {
    let state = createInitialState(1);
    for (let i = 0; i < 1000; i++) {
      state = simulate(state, inputs(Direction8.Up));
    }
    expect(state.player.pos.y).toBeGreaterThanOrEqual(0);
  });
});
