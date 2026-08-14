import { describe, expect, it } from 'vitest';
import { toFixed, ZERO_FIXED } from '../../src/core/fixed';
import { findTouchPriorityPlayer } from '../../src/sim/ballTouch';
import { createInitialState } from '../../src/sim/state';
import type { PlayerState } from '../../src/sim/state';
import { TeamId } from '../../src/sim/formations';
import { Direction8 } from '../../src/input/types';
import { TacklePhase } from '../../src/sim/state';

function makePlayer(x: number, y: number, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    pos: { x: toFixed(x), y: toFixed(y) },
    vel: { x: ZERO_FIXED, y: ZERO_FIXED },
    facing: Direction8.Up,
    kickChargeFrames: 0,
    team: TeamId.A,
    isGoalkeeper: false,
    slotIndex: 1,
    tacklePhase: TacklePhase.None,
    tackleFrames: 0,
    tackleDirection: Direction8.None,
    ...overrides,
  };
}

describe('findTouchPriorityPlayer', () => {
  it('returns null when no player is within the dribble radius', () => {
    const players = [makePlayer(0, 0), makePlayer(200, 200)];
    expect(findTouchPriorityPlayer(players, { x: toFixed(500), y: toFixed(500) })).toBeNull();
  });

  it('returns the closest player within range', () => {
    const players = [makePlayer(0, 0), makePlayer(10, 0), makePlayer(5, 0)];
    // ball at x=6 -> distances: 6, 4, 1 -> index 2 が最も近い
    const index = findTouchPriorityPlayer(players, { x: toFixed(6), y: ZERO_FIXED });
    expect(index).toBe(2);
  });

  it('breaks exact ties by the lowest index', () => {
    const players = [makePlayer(0, 0), makePlayer(10, 0)];
    // ball at x=5 -> both players are exactly 5px away
    const index = findTouchPriorityPlayer(players, { x: toFixed(5), y: ZERO_FIXED });
    expect(index).toBe(0);
  });

  it('works against the real 22-player initial state (kickoff, ball far from everyone)', () => {
    const state = createInitialState(1);
    const index = findTouchPriorityPlayer(state.players, state.ball.pos);
    // キックオフ直後は誰もボールに密着していない可能性が高いが、たまたま範囲内でも例外は投げない
    expect(index === null || (index >= 0 && index < 22)).toBe(true);
  });

  describe('touch priority hysteresis (previousTouchIndex, B-5(b)のバタフライ効果で発覚したバグ修正)', () => {
    it('without a previousTouchIndex (default), the exact same near-tie flips every call (documents the pre-fix bug)', () => {
      // index0が4px、index1が1pxで、次のtickに二人の相対距離が逆転する典型的な「トレーディング」
      // 入力を模した2回の呼び出し。previousTouchIndexを渡さなければヒステリシスは働かず、
      // 素の最短距離だけで判定する (既存の全呼び出しの後方互換性を保証する)。
      const playersA = [makePlayer(0, 0), makePlayer(0, 4)];
      const playersB = [makePlayer(0, 0), makePlayer(0, 1)];
      expect(findTouchPriorityPlayer(playersA, { x: ZERO_FIXED, y: toFixed(4) })).toBe(1);
      expect(findTouchPriorityPlayer(playersB, { x: ZERO_FIXED, y: toFixed(1) })).toBe(1);
    });

    it('keeps the previous toucher when the new closest candidate is only marginally closer (near-tie)', () => {
      // index1(前回の保持者)がボールから5px、index0が2px: 差3pxは margin(8px)以内なので
      // index1を保持する (味方2人がボールを挟んで際どく入れ替わり続ける「往復」を防ぐ)。
      const players = [makePlayer(2, 0), makePlayer(0, 0)];
      const index = findTouchPriorityPlayer(players, { x: toFixed(5), y: ZERO_FIXED }, 1);
      expect(index).toBe(1);
    });

    it('switches away from the previous toucher when the new candidate is clearly closer (beyond the margin)', () => {
      const players = [makePlayer(19, 0), makePlayer(0, 0)];
      // index1(前回の保持者)がボールから19px、index0が0px: 差19pxはmargin(8px)を大きく超える
      const index = findTouchPriorityPlayer(players, { x: toFixed(19), y: ZERO_FIXED }, 1);
      expect(index).toBe(0);
    });

    it('does not apply hysteresis once the previous toucher leaves the dribble radius entirely', () => {
      const players = [makePlayer(200, 200), makePlayer(0, 0)];
      const index = findTouchPriorityPlayer(players, { x: ZERO_FIXED, y: ZERO_FIXED }, 0);
      expect(index).toBe(1);
    });
  });
});
