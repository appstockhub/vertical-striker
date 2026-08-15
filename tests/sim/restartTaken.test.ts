import { describe, expect, it } from 'vitest';
import { distSqFixed, toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { Direction8, emptyButtonState } from '../../src/input/types';
import { createInitialState, TeamId, type GameState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../../src/config/pitch';
import { SET_PIECE_LOCK_MAX_TICKS } from '../../src/sim/boundsConstants';

/**
 * ★セットプレーが「実際に再開されるか」のテスト (試合停止バグの再現)★
 *
 * 観戦シミュレーターの計測で発覚した重大バグ:
 *   defensive/seed3 の1試合(10800tick)のうち **8045tick(74%)** がセットプレー再開ロック中で、
 *   うち1件のスローインは **7466tick(約2分)** ボールが1pxも動かないまま試合が終わった。
 *
 * 原因: setPieceLock は「ボールが動くまで無期限」かつ touch-priority を再開チームに
 * 制限する設計なのに、**キッカーを誰もボールの位置に置いていなかった**
 * (resolveSetPieceKicker は facing を上書きするだけで、位置は AI 任せ)。
 * 再開チームの最寄り選手はホーム復元力と釣り合う 90〜120px の位置で振動し続け、
 * 永久にボールへ到達しない = 試合が死ぬ。
 *
 * 実サッカーでは、スローイン/ゴールキック/コーナーは必ず再開チームの選手がボールの
 * ところへ行って蹴る。ボール自体を即座にテレポートさせている設計(試合を止めない方針)と
 * 一貫させ、キッカーも同じtickでボール脇へ置く。
 */

const NO_INPUT = { direction: Direction8.None, buttons: emptyButtonState() };

function distToBall(state: GameState, index: number): number {
  return Math.sqrt(toFloat(distSqFixed(state.players[index]!.pos, state.ball.pos)));
}

function nearestOfTeam(state: GameState, team: TeamId): { index: number; dist: number } {
  let index = -1;
  let dist = Infinity;
  state.players.forEach((p, i) => {
    if (p.team !== team) return;
    const d = distToBall(state, i);
    if (d < dist) {
      dist = d;
      index = i;
    }
  });
  return { index, dist };
}

/**
 * 全員をピッチ中央付近へ寄せた状態から、ボールを指定位置へ指定速度で送り出して
 * 境界越え(スローイン/ゴールキック/コーナー)を起こす。「再開チームの誰もボールの近くに
 * 居ない」という、デッドロックが起きる実際の状況を再現する。
 */
function forceBoundaryEvent(ballPos: { x: number; y: number }, ballVel: { x: number; y: number }, lastTouch: TeamId): GameState {
  const base = createInitialState(7, { difficulty: 'medium', offsideEnabled: false });
  let state: GameState = {
    ...base,
    // 全員をピッチ中央の狭い塊へ移動させる (再開スポットから確実に遠い)。
    players: base.players.map((p, i) => ({
      ...p,
      pos: { x: toFixed(200 + (i % 5) * 20), y: toFixed(PITCH_HEIGHT / 2 + (i % 7) * 15) },
    })),
    ball: { ...base.ball, pos: { x: toFixed(ballPos.x), y: toFixed(ballPos.y) }, vel: { x: toFixed(ballVel.x), y: toFixed(ballVel.y) } },
    lastTouchTeam: lastTouch,
    setPieceLock: null,
  };
  for (let i = 0; i < 20; i++) {
    state = simulate(state, NO_INPUT);
    if (state.setPieceLock) return state;
  }
  throw new Error('テストの前提が崩れている: 境界越えが発生しなかった');
}

/** ロックが解除される(=誰かが実際に蹴った)までのtick数。届かなければ null。 */
function ticksUntilRestartTaken(start: GameState, maxTicks: number): number | null {
  let state = start;
  for (let i = 0; i < maxTicks; i++) {
    state = simulate(state, NO_INPUT);
    if (!state.setPieceLock) return i;
  }
  return null;
}

describe('セットプレー: 再開チームのキッカーが必ずボールのところに居る', () => {
  const cases = [
    {
      name: 'スローイン (Team B の再開)',
      ball: { x: PITCH_WIDTH - 4, y: 900 },
      vel: { x: 6, y: 0 },
      lastTouch: TeamId.A,
      restartTeam: TeamId.B,
    },
    {
      name: 'ゴールキック (Team A の自陣ゴールライン、Team A の再開)',
      ball: { x: 120, y: PITCH_HEIGHT - 4 },
      vel: { x: 0, y: 6 },
      lastTouch: TeamId.B,
      restartTeam: TeamId.A,
    },
    {
      name: 'コーナーキック (Team A が守備側で最後に触れた → Team B の再開)',
      ball: { x: 120, y: PITCH_HEIGHT - 4 },
      vel: { x: 0, y: 6 },
      lastTouch: TeamId.A,
      restartTeam: TeamId.B,
    },
  ] as const;

  for (const c of cases) {
    it(`${c.name}: 発生した瞬間、再開チームの選手がボール脇に立っている`, () => {
      const state = forceBoundaryEvent(c.ball, c.vel, c.lastTouch);
      expect(state.setPieceLock?.restartTeam, '再開チームが想定と違う').toBe(c.restartTeam);
      const nearest = nearestOfTeam(state, c.restartTeam);
      // ドリブル接触半径(12px)の内側 = そのまま蹴り出せる距離。
      expect(nearest.dist, 'キッカーがボールから離れている(誰も蹴りに来ない=試合が止まる)').toBeLessThan(12);
    });

    it(`${c.name}: 放置しても試合が止まらない (CPU側は自分で蹴り、人間側は上限で解除される)`, () => {
      const state = forceBoundaryEvent(c.ball, c.vel, c.lastTouch);
      if (c.restartTeam === TeamId.B) {
        // CPU側: 実際に蹴って再開する (時間切れ解除に頼らない)。
        const taken = ticksUntilRestartTaken(state, SET_PIECE_LOCK_MAX_TICKS);
        expect(taken, 'CPUがセットプレーを蹴らない (ボールが再開スポットから動かない)').not.toBeNull();
      } else {
        // 人間側: 無操作なら蹴られないが、上限tickで必ずロックが解除され試合は続く
        // (7466tick静止した旧実装の再発防止)。
        const taken = ticksUntilRestartTaken(state, SET_PIECE_LOCK_MAX_TICKS + 10);
        expect(taken, '人間が無操作だと試合が永久停止する').not.toBeNull();
      }
    });
  }

  it('Team A (人間側) の再開ではカーソルがキッカーへ移り、そのまま蹴り出せる', () => {
    let state = forceBoundaryEvent({ x: 120, y: PITCH_HEIGHT - 4 }, { x: 0, y: 6 }, TeamId.B);
    expect(state.setPieceLock?.restartTeam).toBe(TeamId.A);
    expect(distToBall(state, state.controlledPlayerIndex), 'カーソルがキッカーに乗っていない').toBeLessThan(12);

    // Bを溜めて離す = 再開のキック。人間が待たされずに再開できることまで確認する。
    const B = { direction: Direction8.Up, buttons: { ...emptyButtonState(), B: true } };
    state = simulate(state, B);
    state = simulate(state, B);
    state = simulate(state, { direction: Direction8.Up, buttons: emptyButtonState() });
    const speed = Math.hypot(toFloat(state.ball.vel.x), toFloat(state.ball.vel.y));
    expect(speed, '人間がセットプレーを蹴れない').toBeGreaterThan(3);
    expect(state.setPieceLock, '蹴ったのにロックが解除されない').toBeNull();
  });

  it('キッカーを置いてもボールは再開スポットに静止したまま (勝手に動き出さない)', () => {
    const state = forceBoundaryEvent({ x: PITCH_WIDTH - 4, y: 900 }, { x: 6, y: 0 }, TeamId.A);
    expect(state.ball.vel.x).toBe(ZERO_FIXED);
    expect(state.ball.vel.y).toBe(ZERO_FIXED);
  });
});
