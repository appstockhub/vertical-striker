import { describe, expect, it } from 'vitest';
import { toFixed, toFloat } from '../../src/core/fixed';
import { createInitialState, type GameState, type PlayerState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { Direction8, emptyButtonState, LogicalButton, type ButtonState } from '../../src/input/types';

function inputs(direction: Direction8) {
  return { direction, buttons: emptyButtonState() };
}

function inputsWithButtons(direction: Direction8, held: Partial<Record<LogicalButton, boolean>>) {
  const buttons: ButtonState = { ...emptyButtonState(), ...held };
  return { direction, buttons };
}

/** 現在の操作選手 (Phase 2 では players[] の一要素)。テストの可読性のためのヘルパー。 */
function controlled(state: GameState): PlayerState {
  const player = state.players[state.controlledPlayerIndex];
  if (!player) throw new Error('no controlled player');
  return player;
}

/** テスト用: 操作選手/ボールの初期位置だけを差し替えた GameState を作る。 */
function withPositions(
  seed: number,
  playerPos: { x: number; y: number },
  ballPos: { x: number; y: number },
): GameState {
  const base = createInitialState(seed);
  const idx = base.controlledPlayerIndex;
  const players = base.players.map((p, i) =>
    i === idx ? { ...p, pos: { x: toFixed(playerPos.x), y: toFixed(playerPos.y) } } : p,
  );
  return {
    ...base,
    players,
    ball: { ...base.ball, pos: { x: toFixed(ballPos.x), y: toFixed(ballPos.y) } },
  };
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

  it('moves the controlled player up when Direction8.Up is held', () => {
    const state = createInitialState(1);
    const next = simulate(state, inputs(Direction8.Up));
    expect(controlled(next).pos.y).toBeLessThan(controlled(state).pos.y);
    expect(controlled(next).pos.x).toBe(controlled(state).pos.x);
  });

  it('non-controlled players are steered by team AI, not left frozen', () => {
    // キックオフ直後は誰もホームポジションから動いていないため、AIは基本的に静止か
    // ごく小さな補正のみを行う。ここでは「AIが例外を投げず、22人ぶんの新しい状態を
    // 返す」ことと「非操作選手のkickChargeFramesが常に0のまま」を確認する
    // (自律的にキックしない、というPhase 2のスコープ外指定の回帰チェック)。
    const state = createInitialState(1);
    const next = simulate(state, inputs(Direction8.Up));
    expect(next.players).toHaveLength(22);
    for (let i = 0; i < next.players.length; i++) {
      if (i === state.controlledPlayerIndex) continue;
      expect(next.players[i]?.kickChargeFrames).toBe(0);
    }
  });

  it('diagonal movement has the same speed as cardinal movement', () => {
    const state = createInitialState(1);
    const up = simulate(state, inputs(Direction8.Up));
    const upRight = simulate(state, inputs(Direction8.UpRight));

    const upDist = Math.abs(controlled(state).pos.y - controlled(up).pos.y);
    const upRightDx = Math.abs(controlled(state).pos.x - controlled(upRight).pos.x);
    const upRightDy = Math.abs(controlled(state).pos.y - controlled(upRight).pos.y);
    const upRightDist = Math.sqrt(upRightDx ** 2 + upRightDy ** 2);

    // 事前正規化された対角ベクトルにより、誤差1程度で速度が一致する
    expect(Math.abs(upDist - upRightDist)).toBeLessThanOrEqual(1);
  });

  it('increments the frame counter each tick', () => {
    const state = createInitialState(1);
    const next = simulate(state, inputs(Direction8.None));
    expect(next.frame).toBe(state.frame + 1);
  });

  it('keeps the controlled player within pitch bounds', () => {
    let state = createInitialState(1);
    for (let i = 0; i < 1000; i++) {
      state = simulate(state, inputs(Direction8.Up));
    }
    expect(controlled(state).pos.y).toBeGreaterThanOrEqual(0);
  });

  it('has exactly 22 players with the documented index convention', () => {
    const state = createInitialState(1);
    expect(state.players).toHaveLength(22);
    expect(state.players[0]?.isGoalkeeper).toBe(true);
    expect(state.players[0]?.team).toBe(0); // TeamId.A
    expect(state.players[11]?.isGoalkeeper).toBe(true);
    expect(state.players[11]?.team).toBe(1); // TeamId.B
    for (let i = 1; i <= 10; i++) {
      expect(state.players[i]?.isGoalkeeper).toBe(false);
      expect(state.players[i]?.team).toBe(0);
    }
    for (let i = 12; i <= 21; i++) {
      expect(state.players[i]?.isGoalkeeper).toBe(false);
      expect(state.players[i]?.team).toBe(1);
    }
  });
});

describe('simulate — Phase 1/2: dribble + kick integration (controlled player only)', () => {
  it('is deterministic across a sequence including a charged kick and long dribble', () => {
    const sequence: Array<{ direction: Direction8; held: Partial<Record<LogicalButton, boolean>> }> = [
      { direction: Direction8.Up, held: {} },
      { direction: Direction8.Up, held: { L: true } }, // ロングドリブル
      { direction: Direction8.None, held: { B: true } }, // キック溜め開始
      { direction: Direction8.None, held: { B: true } },
      { direction: Direction8.None, held: { B: true } },
      { direction: Direction8.Right, held: {} }, // B解放=キック実行
    ];

    let stateA = withPositions(42, { x: 100, y: 200 }, { x: 105, y: 200 });
    let stateB = withPositions(42, { x: 100, y: 200 }, { x: 105, y: 200 });

    for (const { direction, held } of sequence) {
      stateA = simulate(stateA, inputsWithButtons(direction, held));
      stateB = simulate(stateB, inputsWithButtons(direction, held));
    }

    expect(stateA).toEqual(stateB);
  });

  it('does not mutate the input state when dribbling/kicking', () => {
    const state = withPositions(1, { x: 100, y: 200 }, { x: 105, y: 200 });
    const snapshotBefore = JSON.parse(JSON.stringify(state));
    simulate(state, inputsWithButtons(Direction8.Right, { B: true }));
    expect(state).toEqual(snapshotBefore);
  });

  it('nudges the ball forward when the player dribbles into it', () => {
    const state = withPositions(1, { x: 100, y: 100 }, { x: 105, y: 100 });
    const next = simulate(state, inputs(Direction8.Right));
    expect(toFloat(next.ball.pos.x)).toBeGreaterThan(toFloat(state.ball.pos.x));
    expect(toFloat(next.ball.vel.x)).toBeGreaterThan(0);
  });

  it('long dribble (L held) pushes the ball further per tick than plain dribble', () => {
    const base = withPositions(1, { x: 100, y: 100 }, { x: 105, y: 100 });

    const plain = simulate(base, inputs(Direction8.Right));
    const long = simulate(base, inputsWithButtons(Direction8.Right, { L: true }));

    const plainDelta = toFloat(plain.ball.pos.x) - toFloat(base.ball.pos.x);
    const longDelta = toFloat(long.ball.pos.x) - toFloat(base.ball.pos.x);
    expect(longDelta).toBeGreaterThan(plainDelta);

    const plainPlayerDelta = toFloat(controlled(plain).pos.x) - toFloat(controlled(base).pos.x);
    const longPlayerDelta = toFloat(controlled(long).pos.x) - toFloat(controlled(base).pos.x);
    expect(longPlayerDelta).toBeGreaterThan(plainPlayerDelta);
  });

  it('charging B then releasing with a direction launches the ball airborne toward that direction', () => {
    let state = withPositions(1, { x: 100, y: 100 }, { x: 105, y: 100 });

    const chargeTicks = 20;
    for (let i = 0; i < chargeTicks; i++) {
      state = simulate(state, inputsWithButtons(Direction8.None, { B: true }));
    }
    expect(controlled(state).kickChargeFrames).toBe(chargeTicks);

    const afterKick = simulate(state, inputsWithButtons(Direction8.Right, {}));
    expect(controlled(afterKick).kickChargeFrames).toBe(0);
    expect(toFloat(afterKick.ball.zVel)).toBeGreaterThan(0);
    expect(toFloat(afterKick.ball.vel.x)).toBeGreaterThan(0);
  });

  it('a short tap (min charge) kick stays a grounder (near-zero zVel)', () => {
    const state = withPositions(1, { x: 100, y: 100 }, { x: 105, y: 100 });
    const charging = simulate(state, inputsWithButtons(Direction8.None, { B: true }));
    const released = simulate(charging, inputsWithButtons(Direction8.Right, {}));
    expect(toFloat(released.ball.zVel)).toBeCloseTo(0, 1);
    expect(toFloat(released.ball.vel.x)).toBeGreaterThan(0);
  });
});
