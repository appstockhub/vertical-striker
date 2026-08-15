import { describe, expect, it } from 'vitest';
import { toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { Direction8, emptyButtonState } from '../../src/input/types';
import { createInitialState, TeamId, type GameState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';

/**
 * ★CPUの守備アプローチ (ボールへの寄せ = チャレンジ) のテスト★
 *
 * 観戦シミュレーターの計測で発覚した挙動:
 *   人間が何も操作しない試合 (idle) では、Team A の選手がボールを足元に置いて立っている
 *   だけで、**Team B の選手が9.6pxの至近距離に立ったまま2800tick何もしない**。
 *   結果、Team B のシュートは1本しか生まれず、試合が事実上停止する。
 *
 * 原因: CPUには攻撃AI (cpuAttackAI.ts) しか無く、守備側は「ボールへ寄る」引力しか
 * 持っていなかった。ボールを奪う手段 (タックル/ショルダーチャージ) は人間の操作選手専用で、
 * CPUは相手保持者に密着しても永久に何もしない。実サッカーでは、密着した守備者は必ず
 * ボールにチャレンジする。
 *
 * 実装方針: 相手保持者に密着したCPU守備者が、毎tick一定確率でショルダーチャージを
 * 仕掛ける (決定論を守るため確率は seed 付き PRNG から引く)。難易度で頻度を変える。
 */

const NO_INPUT = { direction: Direction8.None, buttons: emptyButtonState() };

/** 人間(Team A)の選手がボールを足元に持って静止し、Team B の守備者が至近に立つ状況。 */
function humanCarrierUnderPressure(seed: number, difficulty: 'easy' | 'medium' | 'hard'): GameState {
  const base = createInitialState(seed, { difficulty, offsideEnabled: false });
  const human = TeamId.A * 11 + 9;
  const defender = TeamId.B * 11 + 5;
  const carrierPos = { x: toFixed(240), y: toFixed(900) };
  return {
    ...base,
    controlledPlayerIndex: human,
    ball: { pos: carrierPos, vel: { x: ZERO_FIXED, y: ZERO_FIXED }, height: ZERO_FIXED, zVel: ZERO_FIXED },
    players: base.players.map((p, i) => {
      if (i === human) return { ...p, pos: carrierPos, facing: Direction8.Up };
      // 守備者はボールの目の前 (密着) に置く。
      if (i === defender) return { ...p, pos: { x: toFixed(240), y: toFixed(880) }, facing: Direction8.Down };
      return { ...p, pos: { x: toFixed(30 + (i % 4) * 40), y: toFixed(i < 11 ? 1700 : 200) } };
    }),
    lastTouchTeam: TeamId.A,
    lastTouchPlayerIndex: human,
    setPieceLock: null,
  };
}

/** 人間が完全放置した時に、ボールが動き出す (=CPUがチャレンジした) までのtick数。 */
function ticksUntilBallContested(start: GameState, maxTicks: number): number | null {
  let state = start;
  for (let i = 0; i < maxTicks; i++) {
    state = simulate(state, NO_INPUT);
    const speed = Math.hypot(toFloat(state.ball.vel.x), toFloat(state.ball.vel.y));
    if (speed > 0.5) return i;
  }
  return null;
}

describe('CPU守備: 密着した守備者は必ずボールにチャレンジする', () => {
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    it(`${difficulty}: 人間が静止したままでも3秒以内にCPUがボールに触る`, () => {
      const state = humanCarrierUnderPressure(1, difficulty);
      const ticks = ticksUntilBallContested(state, 180);
      expect(ticks, 'CPUが至近距離で何もしない (試合が止まる)').not.toBeNull();
    });
  }

  it('チャレンジ成功時はボールの保持がCPU側に移る', () => {
    let state = humanCarrierUnderPressure(1, 'medium');
    let contested = false;
    for (let i = 0; i < 180 && !contested; i++) {
      state = simulate(state, NO_INPUT);
      if (state.lastTouchTeam === TeamId.B) contested = true;
    }
    expect(contested, 'CPUがチャレンジしてもボールを奪えない').toBe(true);
  });

  it('決定論: 同じseed/同じ入力なら結果が完全一致する', () => {
    let a = humanCarrierUnderPressure(3, 'hard');
    let b = humanCarrierUnderPressure(3, 'hard');
    for (let i = 0; i < 120; i++) {
      a = simulate(a, NO_INPUT);
      b = simulate(b, NO_INPUT);
    }
    expect(a).toEqual(b);
  });

  it('離れた守備者はチャレンジしない (至近距離だけの挙動)', () => {
    const base = humanCarrierUnderPressure(1, 'hard');
    // 守備者を100px離す = チャージ間合い(30px)の外。
    const state: GameState = {
      ...base,
      players: base.players.map((p, i) =>
        i === TeamId.B * 11 + 5 ? { ...p, pos: { x: toFixed(240), y: toFixed(800) } } : p,
      ),
    };
    // 1tickだけ進めた時点でボールが飛ぶことはない (寄せる時間が要る)。
    const next = simulate(state, NO_INPUT);
    const speed = Math.hypot(toFloat(next.ball.vel.x), toFloat(next.ball.vel.y));
    expect(speed, '間合いの外からいきなりボールが飛んだ').toBeLessThanOrEqual(0.5);
  });
});
