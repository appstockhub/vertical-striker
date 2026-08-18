import { describe, expect, it } from 'vitest';
import { toFixed, ZERO_FIXED } from '../../src/core/fixed';
import { Direction8, emptyButtonState } from '../../src/input/types';
import { createInitialState, TeamId, type GameState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../../src/config/pitch';
import { SET_PIECE_LOCK_MAX_TICKS } from '../../src/sim/boundsConstants';
import { THROW_IN_SPEED_MAX_FIXED } from '../../src/sim/ballConstants';

/**
 * ★台帳L-04 (24周目-6) の恒久ゲート★ スローインは「投げ入れ」であって「キックイン」ではない。
 *
 * 原作の正解挙動 (docs/visual-behavior-audit.md 2-3節):
 *   - 投げ手はボールを頭上に掲げ (vf2070-2082)、放物線で投げ入れる (vf2085-2088)
 *   - 出たボールは浮き球 (滞空約0.6〜1.0秒) で、地上を転がるキックとは別物
 *
 * ここでは sim の挙動 (再開ロック解除の瞬間に弾道へ変換される) を機械判定する。
 * 描画側 (頭上保持) は PitchScene.renderBall の throwIn 分岐 (目視確認)。
 */

const NO_INPUT = { direction: Direction8.None, buttons: emptyButtonState() };

function forceThrowIn(): GameState {
  const base = createInitialState(7, { difficulty: 'medium', offsideEnabled: false });
  let state: GameState = {
    ...base,
    players: base.players.map((p, i) => ({
      ...p,
      pos: {
        x: toFixed(Math.min(PITCH_WIDTH - 20, Math.max(20, 4 + 100 + (i % 5) * 30))),
        y: toFixed(Math.min(PITCH_HEIGHT - 20, Math.max(20, PITCH_HEIGHT / 2 + (i % 2 === 0 ? -1 : 1) * (100 + (i % 7) * 15)))),
      },
    })),
    ball: {
      ...base.ball,
      pos: { x: toFixed(4), y: toFixed(PITCH_HEIGHT / 2) },
      vel: { x: toFixed(-6), y: toFixed(0) },
    },
    lastTouchTeam: TeamId.B,
    setPieceLock: null,
  };
  for (let i = 0; i < 20; i++) {
    state = simulate(state, NO_INPUT);
    if (state.setPieceLock?.kind === 'throwIn') return state;
  }
  throw new Error('テストの前提が崩れている: スローインが発生しなかった');
}

describe('シナリオ: スローインは投げ入れ (台帳L-04)', () => {
  it('S-T1: 再開の瞬間、ボールが放物線 (zVel>0) で出る = キックインではない', () => {
    let state = forceThrowIn();
    const maxWait = SET_PIECE_LOCK_MAX_TICKS + 240;
    let released: GameState | null = null;
    for (let i = 0; i < maxWait; i++) {
      state = simulate(state, NO_INPUT);
      if (!state.setPieceLock) {
        released = state;
        break;
      }
    }
    expect(released, 'スローインが再開されない (試合凍結)').not.toBeNull();
    // 再開直後のボールは上向きの垂直速度を持つ浮き球であること
    expect((released!.ball.zVel as number) > (ZERO_FIXED as number), '再開のボールが浮いていない (キックインのまま)').toBe(true);
    // 水平速度は投げの上限以下 (キックの強さで飛んでいない)
    const speedSq = (released!.ball.vel.x as number) ** 2 + (released!.ball.vel.y as number) ** 2;
    const maxSq = (THROW_IN_SPEED_MAX_FIXED as number) ** 2;
    expect(speedSq).toBeLessThanOrEqual(maxSq * 1.01);
  });

  it('S-T2: 投げ入れ後のボールは滞空して着地する (放物線の成立)', () => {
    let state = forceThrowIn();
    const maxWait = SET_PIECE_LOCK_MAX_TICKS + 240;
    for (let i = 0; i < maxWait && state.setPieceLock; i++) {
      state = simulate(state, NO_INPUT);
    }
    expect(state.setPieceLock).toBeNull();
    // 滞空: 数tick後もまだ空中にあること (瞬間だけzVelが付く偽実装を弾く)
    let airTicks = 0;
    for (let i = 0; i < 180; i++) {
      state = simulate(state, NO_INPUT);
      if ((state.ball.height as number) > 0) airTicks++;
    }
    // 期待滞空 ≈ 68tick (ballConstants の導出コメント)。誰かがトラップして短くなる場合も
    // あるため下限は緩めに置く (20tick = 0.33秒以上浮いていれば「投げ」と判定)
    expect(airTicks).toBeGreaterThanOrEqual(20);
  });
});
