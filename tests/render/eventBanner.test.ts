import { describe, expect, it } from 'vitest';
import { createInitialState, TeamId, type GameState } from '../../src/sim/state';
import { EVENT_BANNER_DURATION_TICKS, formatEventBannerText } from '../../src/render/eventBanner';

function base(): GameState {
  return createInitialState(1);
}

describe('formatEventBannerText', () => {
  it('returns null when lastEvent is null', () => {
    expect(formatEventBannerText(base())).toBeNull();
  });

  it('returns team + kind label text within the display window', () => {
    const prev = base();
    const state: GameState = { ...prev, lastEvent: { kind: 'throwIn', team: TeamId.A, atFrame: prev.frame } };
    expect(formatEventBannerText(state)).toBe('チームA スローイン');
  });

  it('formats each NotableEventKind with the correct Japanese label', () => {
    const prev = base();
    const cases: Array<[GameState['lastEvent'] extends null ? never : NonNullable<GameState['lastEvent']>['kind'], string]> = [
      ['throwIn', 'スローイン'],
      ['goalKick', 'ゴールキック'],
      ['corner', 'コーナーキック'],
      ['gkCatch', 'キャッチ！'],
    ];
    for (const [kind, label] of cases) {
      const state: GameState = { ...prev, lastEvent: { kind, team: TeamId.B, atFrame: prev.frame } };
      expect(formatEventBannerText(state)).toBe(`チームB ${label}`);
    }
  });

  it('returns null once the display window (EVENT_BANNER_DURATION_TICKS) has elapsed', () => {
    const prev = base();
    const stillShowing: GameState = {
      ...prev,
      frame: prev.frame + EVENT_BANNER_DURATION_TICKS - 1,
      lastEvent: { kind: 'gkCatch', team: TeamId.A, atFrame: prev.frame },
    };
    expect(formatEventBannerText(stillShowing)).not.toBeNull();

    const expired: GameState = {
      ...prev,
      frame: prev.frame + EVENT_BANNER_DURATION_TICKS,
      lastEvent: { kind: 'gkCatch', team: TeamId.A, atFrame: prev.frame },
    };
    expect(formatEventBannerText(expired)).toBeNull();
  });
});
