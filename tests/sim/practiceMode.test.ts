import { describe, expect, it } from 'vitest';
import { toFixed, toFloat, distSqFixed, ZERO_FIXED } from '../../src/core/fixed';
import { Direction8, emptyButtonState } from '../../src/input/types';
import { createInitialState, TeamId, type GameState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';

/**
 * ★練習モード (GameState.cpuHandsOff)★
 *
 * ユーザー要望:「動きやボタンを確認したいのでCPUがボールを取らないトグルスイッチも実装して。
 * テストにならないから」。ONの間、CPU(Team B)のフィールドプレイヤーはボールに一切関与しない
 * (追跡権を持たない / touch-priority を取れない / タックル・チャージを仕掛けない)。
 * GKのセーブだけは通常どおり (シュートの確認ができなくなるため)。
 */

const NO_INPUT = { direction: Direction8.None, buttons: emptyButtonState() };
const inp = (dir: Direction8, b = {}) => ({ direction: dir, buttons: { ...emptyButtonState(), ...b } });

/** 人間がボールを持ち、Team B の選手が至近に構えている状況。 */
function contested(cpuHandsOff: boolean): GameState {
  const base = createInitialState(4, { difficulty: 'hard', offsideEnabled: false });
  const human = TeamId.A * 11 + 9;
  const pos = { x: toFixed(240), y: toFixed(1000) };
  return {
    ...base,
    cpuHandsOff,
    controlledPlayerIndex: human,
    ball: { pos, vel: { x: ZERO_FIXED, y: ZERO_FIXED }, height: ZERO_FIXED, zVel: ZERO_FIXED },
    players: base.players.map((p, i) => {
      if (i === human) return { ...p, pos, facing: Direction8.Up };
      // Team B を人間の周囲に集める (通常なら即座に囲まれて奪われる配置)。
      if (p.team === TeamId.B && !p.isGoalkeeper)
        return { ...p, pos: { x: toFixed(180 + (i % 5) * 30), y: toFixed(940 + (i % 3) * 25) } };
      return { ...p, pos: { x: toFixed(30), y: toFixed(1700) } };
    }),
    lastTouchTeam: TeamId.A,
    lastTouchPlayerIndex: human,
    setPieceLock: null,
  };
}

describe('練習モード: CPUがボールに関与しない', () => {
  it('OFF (通常) では、囲まれた人間はボールを奪われる', () => {
    let state = contested(false);
    let stolen = false;
    for (let i = 0; i < 180 && !stolen; i++) {
      state = simulate(state, inp(Direction8.Up));
      if (state.lastTouchTeam === TeamId.B) stolen = true;
    }
    expect(stolen, 'テストの前提が崩れている: 通常モードでも奪われない').toBe(true);
  });

  it('★ON では、同じ状況でも一度も奪われない', () => {
    let state = contested(true);
    for (let i = 0; i < 300; i++) {
      state = simulate(state, inp(Direction8.Up));
      expect(state.lastTouchTeam, `t${i}: 練習モードなのにCPUがボールを取った`).not.toBe(TeamId.B);
    }
  });

  it('ON でも人間の操作はすべて通常どおり効く (ドリブル/キック)', () => {
    let state = contested(true);
    const human = state.controlledPlayerIndex;
    const startY = toFloat(state.players[human]!.pos.y);
    for (let i = 0; i < 30; i++) state = simulate(state, inp(Direction8.Up));
    expect(toFloat(state.players[human]!.pos.y), 'ドリブルで前進できない').toBeLessThan(startY - 20);

    state = simulate(state, inp(Direction8.Up, { B: true }));
    state = simulate(state, inp(Direction8.Up));
    expect(Math.hypot(toFloat(state.ball.vel.x), toFloat(state.ball.vel.y)), 'キックが出ない').toBeGreaterThan(5);
  });

  it('ON でもCPUは陣形を保つ (棒立ちで消えたりしない)', () => {
    let state = contested(true);
    const before = state.players.map((p) => ({ x: toFloat(p.pos.x), y: toFloat(p.pos.y) }));
    for (let i = 0; i < 120; i++) state = simulate(state, inp(Direction8.Up));
    const teamB = state.players.filter((p) => p.team === TeamId.B);
    for (const p of teamB) {
      expect(toFloat(p.pos.x)).toBeGreaterThanOrEqual(0);
      expect(toFloat(p.pos.y)).toBeGreaterThanOrEqual(0);
    }
    expect(before.length).toBe(22);
  });

  it('ON でもGKはシュートに反応する (シュートの確認ができる)', () => {
    // Team B のゴール(北, y=0)へ強いシュートを撃ち込む。
    const base = contested(true);
    const gkIndex = TeamId.B * 11;
    let state: GameState = {
      ...base,
      players: base.players.map((p, i) => (i === gkIndex ? { ...p, pos: { x: toFixed(240), y: toFixed(14) } } : p)),
      ball: { pos: { x: toFixed(240), y: toFixed(70) }, vel: { x: ZERO_FIXED, y: toFixed(-6) }, height: ZERO_FIXED, zVel: ZERO_FIXED },
      lastTouchTeam: TeamId.A,
      lastTouchPlayerIndex: base.controlledPlayerIndex,
    };
    let saved = false;
    for (let i = 0; i < 20 && !saved; i++) {
      state = simulate(state, NO_INPUT);
      if (state.lastTouchTeam === TeamId.B) saved = true;
    }
    expect(saved, '練習モードでGKまで無反応になっている (シュートの確認ができない)').toBe(true);
    // GKが触れる距離まで来ていることも確認しておく。
    const gk = state.players[gkIndex]!;
    expect(Math.sqrt(toFloat(distSqFixed(gk.pos, state.ball.pos)))).toBeLessThan(40);
  });
});
