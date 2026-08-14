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
});
