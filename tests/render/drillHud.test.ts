import { describe, expect, it } from 'vitest';
import { createInitialState, type GameState } from '../../src/sim/state';
import { classifyDrillEvent, classifyLineShift } from '../../src/render/drillHud';
import { emptyInputFrame, LogicalButton, type InputFrame } from '../../src/input/types';
import { toFixed } from '../../src/core/fixed';

/**
 * 操作確認モードの「いま何が発動したか」表示の回帰ゲート (23周目)。
 *
 * この表示は段階2の手触り評価でユーザーが唯一頼る判定材料なので、**誤表示は
 * 「操作が効いていない」という誤った結論に直結する**。実際、実機確認で
 * 「B長押しでふかした球」が「リフティング」と表示される誤りが見つかった。
 */

const base = createInitialState(1);

function withBall(state: GameState, vx: number, vy: number, zVel = 0, height = 0): GameState {
  return {
    ...state,
    ball: { ...state.ball, vel: { x: toFixed(vx), y: toFixed(vy) }, zVel: toFixed(zVel), height: toFixed(height) },
  };
}

function withCharge(state: GameState, charge: number): GameState {
  const players = state.players.map((p, i) =>
    i === state.controlledPlayerIndex ? { ...p, kickChargeFrames: charge } : p,
  );
  return { ...state, players };
}

function heldInput(...buttons: LogicalButton[]): InputFrame {
  const frame = emptyInputFrame();
  const held = { ...frame.buttons } as Record<LogicalButton, boolean>;
  for (const b of buttons) held[b] = true;
  return { ...frame, buttons: held };
}

/** 自分が最後に触った状態にする (リフティング判定の前提)。 */
function mine(state: GameState): GameState {
  return { ...state, lastTouchPlayerIndex: state.controlledPlayerIndex };
}

describe('操作確認モードの発動判定', () => {
  it('溜め無しで浮かせたら「リフティング」', () => {
    const prev = mine(withCharge(base, 0));
    const next = mine(withBall(withCharge(base, 0), 3.6, 0, 2.65, 1));
    expect(classifyDrillEvent(prev, next, heldInput(LogicalButton.B))?.name).toBe('リフティング');
  });

  it('B長押しでふかした球はリフティングではなく「長押しシュート(ふかし)」', () => {
    // 実機の実測値: 溜め30 → 初速4.33 / 弾道5.65。速度が5未満まで落ちるため、
    // 溜めを見ないとリフティングと区別できない (この取り違えが実際に起きた)。
    const prev = mine(withCharge(base, 30));
    const next = mine(withBall(withCharge(base, 0), 4.33, 0, 5.65, 1));
    const name = classifyDrillEvent(prev, next, heldInput())?.name ?? '';
    expect(name).toContain('B 長押しシュート');
    expect(name).toContain('ふかし');
    expect(name).not.toContain('リフティング');
  });

  it('溜めが浅ければ「短押し」', () => {
    const prev = withCharge(base, 3);
    const next = withBall(withCharge(base, 0), 8.82, 0);
    expect(classifyDrillEvent(prev, next, heldInput())?.name).toContain('B 短押しシュート');
  });

  it.each([
    [LogicalButton.L, '+Lシフト'],
    [LogicalButton.R, '+Rシフト'],
  ])('L/R を押しながらのキックは「シフトキック」と分かる (%s)', (button, expected) => {
    const prev = withCharge(base, 3);
    const next = withBall(withCharge(base, 0), 8.82, 0);
    expect(classifyDrillEvent(prev, next, heldInput(button))?.name).toContain(expected);
  });

  it('シフト表示は A/X/Y にも付く (Bだけだと効いているか切り分けられない)', () => {
    const prev = base;
    const next = withBall(base, 8.86, 0);
    for (const button of [LogicalButton.A, LogicalButton.X, LogicalButton.Y]) {
      const name = classifyDrillEvent(prev, next, heldInput(button, LogicalButton.R))?.name ?? '';
      expect(name).toContain('+Rシフト');
    }
  });

  it('ボールが動いていなければ何も発動していないと判定する', () => {
    expect(classifyDrillEvent(base, base, heldInput(LogicalButton.B))).toBeNull();
  });

  describe('ライン操作 (START)', () => {
    const at = (offset: number): GameState => ({ ...base, manualLineOffset: toFixed(offset) });

    it('0から動き出した瞬間だけ記録する', () => {
      expect(classifyLineShift(at(0), at(-3))?.name).toContain('後ろへ');
      expect(classifyLineShift(at(0), at(3))?.name).toContain('前へ');
    });

    it('押し続けている間の増加は記録しない (ログが埋まって他の操作が流れるため)', () => {
      expect(classifyLineShift(at(-3), at(-6))).toBeNull();
      expect(classifyLineShift(at(-21), at(-24))).toBeNull();
    });

    it('0へ戻る途中も記録しない', () => {
      expect(classifyLineShift(at(-8), at(-6))).toBeNull();
      expect(classifyLineShift(at(-2), at(0))).toBeNull();
    });
  });
});
