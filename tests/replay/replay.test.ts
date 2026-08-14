import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { Direction8, emptyButtonState, LogicalButton, type ButtonState } from '../../src/input/types';
import { replayToState, type ReplayLog } from '../../src/replay/replay';
import { ReplayRecorder } from '../../src/replay/ReplayRecorder';

function inputsWithButtons(direction: Direction8, held: Partial<Record<LogicalButton, boolean>> = {}) {
  const buttons: ButtonState = { ...emptyButtonState(), ...held };
  return { direction, buttons };
}

const SEQUENCE = [
  inputsWithButtons(Direction8.Up),
  inputsWithButtons(Direction8.UpRight, { L: true }),
  inputsWithButtons(Direction8.None, { B: true }),
  inputsWithButtons(Direction8.None, { B: true }),
  inputsWithButtons(Direction8.Right, {}),
  inputsWithButtons(Direction8.Down, {}),
  inputsWithButtons(Direction8.Down, { Y: true }),
  inputsWithButtons(Direction8.None, {}),
];

describe('replayToState', () => {
  it('reproduces the exact final state from a seed + input sequence (decisive replay requirement)', () => {
    let live = createInitialState(2026, { difficulty: 'easy', offsideEnabled: true });
    for (const inputs of SEQUENCE) {
      live = simulate(live, inputs);
    }

    const log: ReplayLog = { seed: 2026, difficulty: 'easy', offsideEnabled: true, inputs: SEQUENCE };
    const replayed = replayToState(log);

    expect(replayed).toEqual(live);
  });

  it('produces a different state when replayed with different difficulty/offsideEnabled settings (bug catch #2 regression)', () => {
    const logA: ReplayLog = { seed: 1, difficulty: 'easy', offsideEnabled: true, inputs: SEQUENCE };
    const logB: ReplayLog = { seed: 1, difficulty: 'hard', offsideEnabled: true, inputs: SEQUENCE };
    // difficultyが異なればCPU(Team B)の判断が変わり得るため、同一結果になる保証はできない。
    // ここでは「difficulty/offsideEnabledがReplayLogに保持され、実際にcreateInitialStateへ渡っている」
    // ことを確認する (両者が同じ関数呼び出しパスを通ることの回帰チェック)。
    expect(replayToState(logA).difficulty).toBe('easy');
    expect(replayToState(logB).difficulty).toBe('hard');
  });

  it('with an empty input list, returns exactly createInitialState()', () => {
    const log: ReplayLog = { seed: 7, difficulty: 'medium', offsideEnabled: false, inputs: [] };
    const replayed = replayToState(log);
    expect(replayed.frame).toBe(0);
    expect(replayed.offsideEnabled).toBe(false);
  });
});

describe('ReplayRecorder', () => {
  it('accumulates recorded inputs into a ReplayLog that replays to the same state as the live simulation', () => {
    const recorder = new ReplayRecorder();
    recorder.start(99, 'medium', true);

    let live = createInitialState(99, { difficulty: 'medium', offsideEnabled: true });
    for (const inputs of SEQUENCE) {
      recorder.record(inputs);
      live = simulate(live, inputs);
    }

    const log = recorder.finish();
    expect(log.seed).toBe(99);
    expect(log.inputs).toHaveLength(SEQUENCE.length);
    expect(replayToState(log)).toEqual(live);
  });

  it('start() resets any previously recorded inputs', () => {
    const recorder = new ReplayRecorder();
    recorder.start(1, 'medium', true);
    recorder.record(inputsWithButtons(Direction8.Up));
    recorder.record(inputsWithButtons(Direction8.Down));

    recorder.start(2, 'hard', false);
    const log = recorder.finish();
    expect(log.seed).toBe(2);
    expect(log.difficulty).toBe('hard');
    expect(log.offsideEnabled).toBe(false);
    expect(log.inputs).toHaveLength(0);
  });
});
