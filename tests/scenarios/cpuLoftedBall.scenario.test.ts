import { describe, expect, it } from 'vitest';
import { toFixed, ZERO_FIXED } from '../../src/core/fixed';
import { Direction8, emptyButtonState } from '../../src/input/types';
import { createInitialState, TeamId, type GameState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../../src/config/pitch';
import { SET_PIECE_LOCK_MAX_TICKS } from '../../src/sim/boundsConstants';

/**
 * ★台帳L-08 (24周目-6) の恒久ゲート★ CPUのゴールキックは高い弾道の浮き球で再開される。
 *
 * 原作の正解挙動 (docs/visual-behavior-audit.md 2-4節): ゴールキックは高く上がり
 * ハーフウェー付近まで飛ぶ (vf672-702)。旧実装は最小溜めのグラウンダー配球だった。
 *
 * 補記 (プローブで判明した事実): 無操作のCPU試合ではボールがピッチ外に出ることが
 * 一度も無く (9000tickでセットプレーはキックオフ3回のみ)、ゴールキック自体が
 * 発生しない。そのためこのゲートは境界越えを強制して発生させて検証する
 * (setPieceRestart.scenario.test.ts と同じハーネス)。
 */

const NO_INPUT = { direction: Direction8.None, buttons: emptyButtonState() };

function forceGoalKick(): GameState {
  const base = createInitialState(7, { difficulty: 'medium', offsideEnabled: false });
  let state: GameState = {
    ...base,
    players: base.players.map((p, i) => ({
      ...p,
      pos: {
        x: toFixed(Math.min(PITCH_WIDTH - 20, Math.max(20, 100 + 100 + (i % 5) * 30))),
        y: toFixed(Math.min(PITCH_HEIGHT - 20, Math.max(20, 4 + 100 + (i % 7) * 15))),
      },
    })),
    // Team A が北側 (y小) のゴールラインへ蹴り出した → Team B (CPU) のゴールキック。
    // Team A 側にすると、カーソルがキッカー(GK)へ乗り「人間の入力に委ねる」仕様で
    // CPU代行キックが発動しない (この検証はCPUの配球弾道が対象)。
    ball: {
      ...base.ball,
      pos: { x: toFixed(100), y: toFixed(4) },
      vel: { x: toFixed(0), y: toFixed(-7) },
    },
    lastTouchTeam: TeamId.A,
    setPieceLock: null,
  };
  for (let i = 0; i < 20; i++) {
    state = simulate(state, NO_INPUT);
    if (state.setPieceLock?.kind === 'goalKick') return state;
  }
  throw new Error('テストの前提が崩れている: ゴールキックが発生しなかった');
}

describe('シナリオ: CPUの浮き球 (台帳L-08)', () => {
  it('S-L1: CPUのゴールキックは浮き球 (zVel > 0) で再開される', () => {
    let state = forceGoalKick();
    const maxWait = SET_PIECE_LOCK_MAX_TICKS + 240;
    let released: GameState | null = null;
    for (let i = 0; i < maxWait; i++) {
      state = simulate(state, NO_INPUT);
      if (!state.setPieceLock) {
        released = state;
        break;
      }
    }
    expect(released, 'ゴールキックが再開されない (試合凍結)').not.toBeNull();
    expect(
      (released!.ball.zVel as number) > (ZERO_FIXED as number),
      'ゴールキックがグラウンダーのまま (浮き球になっていない)',
    ).toBe(true);
    // 弾道になっていること (瞬間だけ浮く偽実装を弾く): 以後60tickの滞空を数える
    let airTicks = 0;
    for (let i = 0; i < 120; i++) {
      state = simulate(state, NO_INPUT);
      if ((state.ball.height as number) > 0) airTicks++;
    }
    expect(airTicks, '滞空が短すぎる (高い弾道ではない)').toBeGreaterThanOrEqual(30);
  });
});
