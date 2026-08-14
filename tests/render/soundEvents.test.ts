import { describe, expect, it } from 'vitest';
import { createInitialState, TeamId, type GameState } from '../../src/sim/state';
import { HALF_DURATION_FRAMES, FULL_MATCH_DURATION_FRAMES } from '../../src/sim/matchClock';
import { toFixed, toFloat } from '../../src/core/fixed';
import { detectSoundEvents, SoundEventId } from '../../src/render/soundEvents';

function base(): GameState {
  return createInitialState(1);
}

describe('detectSoundEvents', () => {
  it('returns no events when nothing changed', () => {
    const state = base();
    expect(detectSoundEvents(state, state)).toEqual([]);
  });

  it('fires Goal when the score increases', () => {
    const prev = base();
    const next: GameState = { ...prev, score: [1, 0] };
    expect(detectSoundEvents(prev, next)).toContain(SoundEventId.Goal);
  });

  it('fires HalfTimeWhistle when the half changes', () => {
    const prev: GameState = { ...base(), frame: HALF_DURATION_FRAMES - 1 };
    const next: GameState = { ...prev, frame: HALF_DURATION_FRAMES };
    expect(detectSoundEvents(prev, next)).toContain(SoundEventId.HalfTimeWhistle);
  });

  it('fires FullTimeWhistle exactly when fulltime is first reached', () => {
    const prev: GameState = { ...base(), frame: FULL_MATCH_DURATION_FRAMES - 1 };
    const next: GameState = { ...prev, frame: FULL_MATCH_DURATION_FRAMES };
    expect(detectSoundEvents(prev, next)).toContain(SoundEventId.FullTimeWhistle);
  });

  it('does not re-fire FullTimeWhistle on subsequent frozen frames', () => {
    const prev: GameState = { ...base(), frame: FULL_MATCH_DURATION_FRAMES + 10 };
    const next: GameState = { ...prev, frame: FULL_MATCH_DURATION_FRAMES + 11 };
    expect(detectSoundEvents(prev, next)).not.toContain(SoundEventId.FullTimeWhistle);
  });

  it('fires Kick when lastTouchTeam changes to a non-null value', () => {
    const prev: GameState = { ...base(), lastTouchTeam: null };
    const next: GameState = { ...prev, lastTouchTeam: TeamId.A };
    expect(detectSoundEvents(prev, next)).toContain(SoundEventId.Kick);
  });

  it('does not fire Kick when lastTouchTeam stays the same', () => {
    const prev: GameState = { ...base(), lastTouchTeam: TeamId.A };
    const next: GameState = { ...prev, lastTouchTeam: TeamId.A };
    expect(detectSoundEvents(prev, next)).not.toContain(SoundEventId.Kick);
  });

  it('fires RestartWhistle when the ball teleports a large distance in one tick', () => {
    const prev = base();
    const next: GameState = {
      ...prev,
      ball: { ...prev.ball, pos: { x: prev.ball.pos.x, y: toFixed(500) } }, // 通常物理では絶対出ない移動量
    };
    expect(detectSoundEvents(prev, next)).toContain(SoundEventId.RestartWhistle);
  });

  it('does not fire RestartWhistle for an ordinary small per-tick ball movement (e.g. a strong kick)', () => {
    const prev = base();
    // STRONG_KICK_SPEED_FIXED(9px/tick)程度のありふれた移動量。テレポート閾値(20px)未満。
    const smallMove: GameState = {
      ...prev,
      ball: { ...prev.ball, pos: { x: prev.ball.pos.x, y: toFixed(toFloat(prev.ball.pos.y) + 9) } },
    };
    expect(detectSoundEvents(prev, smallMove)).not.toContain(SoundEventId.RestartWhistle);
  });

  it('suppresses RestartWhistle when the same tick also scores a goal (no double-firing)', () => {
    const prev = base();
    const next: GameState = {
      ...prev,
      score: [1, 0],
      ball: { ...prev.ball, pos: { x: prev.ball.pos.x, y: toFixed(500) } },
    };
    const events = detectSoundEvents(prev, next);
    expect(events).toContain(SoundEventId.Goal);
    expect(events).not.toContain(SoundEventId.RestartWhistle);
  });

  it('suppresses RestartWhistle when the same tick also crosses the half boundary (kickoff reset teleport)', () => {
    const prev: GameState = { ...base(), frame: HALF_DURATION_FRAMES - 1 };
    const next: GameState = {
      ...prev,
      frame: HALF_DURATION_FRAMES,
      ball: { ...prev.ball, pos: { x: prev.ball.pos.x, y: toFixed(500) } },
    };
    const events = detectSoundEvents(prev, next);
    expect(events).toContain(SoundEventId.HalfTimeWhistle);
    expect(events).not.toContain(SoundEventId.RestartWhistle);
  });
});
