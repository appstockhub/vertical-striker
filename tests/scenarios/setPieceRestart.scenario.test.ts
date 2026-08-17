import { describe, expect, it } from 'vitest';
import { toFixed } from '../../src/core/fixed';
import { Direction8, emptyButtonState } from '../../src/input/types';
import { createInitialState, TeamId, type GameState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../../src/config/pitch';
import { SET_PIECE_LOCK_MAX_TICKS } from '../../src/sim/boundsConstants';

/**
 * シナリオ: 各セットプレーが「奪われずに再開できる」。
 * parity-targets.md S1 に対応。原作動画での観察: 再開ロック中に相手は寄らず、
 * 再開チームが必ず最初にボールへ触れる (GK配球は約1.5秒の「間」を持つ)。
 *
 * 16周目の「74%ロック凍結」バグの再発防止 (restartTaken.test.ts) に加えて、ここでは
 * 「再開の最初のタッチが必ず再開チームであること」= 奪われないことをシナリオとして固定する。
 */

const NO_INPUT = { direction: Direction8.None, buttons: emptyButtonState() };

/** 相手選手をボール再開地点の近くに置いた状態で境界越えを起こす (奪われやすい最悪条件)。 */
function forceBoundaryEvent(
  ballPos: { x: number; y: number },
  ballVel: { x: number; y: number },
  lastTouch: TeamId,
): GameState {
  const base = createInitialState(7, { difficulty: 'medium', offsideEnabled: false });
  let state: GameState = {
    ...base,
    players: base.players.map((p, i) => ({
      ...p,
      // 両チームともボールが出る地点の「近く」(100〜220px) に置く: 再開後すぐ寄れる距離だが、
      // ボールがピッチを出る前に触ってしまう距離ではない (触ると lastTouchTeam が変わり、
      // 再開チームの判定そのものが変わってテストの前提が壊れる)。
      pos: {
        x: toFixed(Math.min(PITCH_WIDTH - 20, Math.max(20, ballPos.x + 100 + (i % 5) * 30))),
        y: toFixed(Math.min(PITCH_HEIGHT - 20, Math.max(20, ballPos.y + (i % 2 === 0 ? -1 : 1) * (100 + (i % 7) * 15)))),
      },
    })),
    ball: {
      ...base.ball,
      pos: { x: toFixed(ballPos.x), y: toFixed(ballPos.y) },
      vel: { x: toFixed(ballVel.x), y: toFixed(ballVel.y) },
    },
    lastTouchTeam: lastTouch,
    setPieceLock: null,
  };
  for (let i = 0; i < 20; i++) {
    state = simulate(state, NO_INPUT);
    if (state.setPieceLock) return state;
  }
  throw new Error('テストの前提が崩れている: 境界越えが発生しなかった');
}

/** ロックが解除されるまで進め、解除tickの状態を返す。 */
function runUntilRestart(start: GameState, maxTicks: number): { state: GameState; ticks: number } | null {
  let state = start;
  for (let i = 0; i < maxTicks; i++) {
    state = simulate(state, NO_INPUT);
    if (!state.setPieceLock) return { state, ticks: i };
  }
  return null;
}

describe('シナリオ: セットプレーの再開', () => {
  const MAX_WAIT = SET_PIECE_LOCK_MAX_TICKS + 240;

  const cases: Array<{ name: string; ball: { x: number; y: number }; vel: { x: number; y: number }; lastTouch: TeamId; restartTeam: TeamId }> = [
    // Team B が最後に触って左タッチラインを割った → Team A のスローイン
    { name: 'スローイン', ball: { x: 4, y: PITCH_HEIGHT / 2 }, vel: { x: -6, y: 0 }, lastTouch: TeamId.B, restartTeam: TeamId.A },
    // Team B が触って Team A 側 (南=y大) のゴールラインを割った(枠外) → Team A のゴールキック
    { name: 'ゴールキック', ball: { x: 100, y: PITCH_HEIGHT - 4 }, vel: { x: 0, y: 7 }, lastTouch: TeamId.B, restartTeam: TeamId.A },
    // Team A が触って自陣側 (南) のゴールラインを割った → Team B のコーナー
    { name: 'コーナー', ball: { x: 100, y: PITCH_HEIGHT - 4 }, vel: { x: 0, y: 7 }, lastTouch: TeamId.A, restartTeam: TeamId.B },
  ];

  for (const c of cases) {
    it(`S-S: ${c.name}が奪われずに再開される (最初のタッチ=再開チーム)`, () => {
      const locked = forceBoundaryEvent(c.ball, c.vel, c.lastTouch);
      expect(locked.setPieceLock?.restartTeam, `${c.name}の再開チームが違う`).toBe(c.restartTeam);

      const result = runUntilRestart(locked, MAX_WAIT);
      expect(result, `${c.name}が${MAX_WAIT}tick経っても再開されない (試合凍結)`).not.toBeNull();
      // ロック解除 = 再開チームがボールを動かした、が設計。最初のタッチが再開チームであること
      expect(result!.state.lastTouchTeam, `${c.name}で相手に奪われた`).toBe(c.restartTeam);
    });
  }
});
