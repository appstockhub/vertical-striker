import { describe, expect, it } from 'vitest';
import { toFixed, toFloat } from '../../src/core/fixed';
import { detectBoundaryEvent } from '../../src/sim/bounds';
import { TeamId } from '../../src/sim/formations';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../../src/config/pitch';
import { CROSSBAR_HEIGHT_FIXED } from '../../src/sim/boundsConstants';

// half=1: formations.ts の規約どおり、前半は Team A が南(y大きい)側、Team B が北(y=0)側を守る。
const HALF1 = 1 as const;

describe('detectBoundaryEvent — pitch interior', () => {
  it('returns null when the tentative position stays within the pitch', () => {
    const event = detectBoundaryEvent({ x: toFixed(240), y: toFixed(900) }, toFixed(0), HALF1, TeamId.A);
    expect(event).toBeNull();
  });
});

describe('detectBoundaryEvent — goal line (north edge, y<=0, defended by Team B in half 1)', () => {
  it('is a goal for the attacking team (A) when within goal width and under the crossbar', () => {
    const event = detectBoundaryEvent({ x: toFixed(240), y: toFixed(-5) }, toFixed(2), HALF1, TeamId.A);
    expect(event).toEqual({ type: 'goal', scoringTeam: TeamId.A });
  });

  it('is NOT a goal when the ball is over the crossbar height, even within goal width', () => {
    const overCrossbar = toFloat(CROSSBAR_HEIGHT_FIXED) + 3;
    const event = detectBoundaryEvent({ x: toFixed(240), y: toFixed(-5) }, toFixed(overCrossbar), HALF1, TeamId.A);
    expect(event?.type).not.toBe('goal');
  });

  it('is a goal kick (to the defending team B) when wide of the goal and the attacker (A) touched last', () => {
    const event = detectBoundaryEvent({ x: toFixed(10), y: toFixed(-1) }, toFixed(0), HALF1, TeamId.A);
    expect(event?.type).toBe('goalKick');
    if (event?.type === 'goalKick') {
      expect(event.restartTeam).toBe(TeamId.B);
      expect(toFloat(event.pos.x)).toBeCloseTo(240, 1); // ゴール中央
    }
  });

  it('is a corner (to the attacking team A) when wide of the goal and the defender (B) touched last', () => {
    const event = detectBoundaryEvent({ x: toFixed(10), y: toFixed(-1) }, toFixed(0), HALF1, TeamId.B);
    expect(event?.type).toBe('corner');
    if (event?.type === 'corner') {
      expect(event.restartTeam).toBe(TeamId.A);
      // x=10 は中央(240)より左なので、左隅に復帰する。
      expect(toFloat(event.pos.x)).toBeLessThan(240);
    }
  });

  it('picks the right-side corner flag when the ball went out on the right', () => {
    const event = detectBoundaryEvent(
      { x: toFixed(PITCH_WIDTH - 10), y: toFixed(-1) },
      toFixed(0),
      HALF1,
      TeamId.B,
    );
    expect(event?.type).toBe('corner');
    if (event?.type === 'corner') {
      expect(toFloat(event.pos.x)).toBeGreaterThan(240);
    }
  });

  it('defaults to a goal kick when lastTouchTeam is null (safe fallback)', () => {
    const event = detectBoundaryEvent({ x: toFixed(10), y: toFixed(-1) }, toFixed(0), HALF1, null);
    expect(event?.type).toBe('goalKick');
  });
});

describe('detectBoundaryEvent — goal line (south edge, y>=PITCH_HEIGHT, defended by Team A in half 1)', () => {
  it('is a goal for the attacking team (B) when within goal width and under the crossbar', () => {
    const event = detectBoundaryEvent(
      { x: toFixed(240), y: toFixed(PITCH_HEIGHT + 5) },
      toFixed(2),
      HALF1,
      TeamId.B,
    );
    expect(event).toEqual({ type: 'goal', scoringTeam: TeamId.B });
  });
});

describe('detectBoundaryEvent — sideline (throw-in)', () => {
  it('awards the throw-in to the team that did not touch it last, on the left side', () => {
    const event = detectBoundaryEvent({ x: toFixed(-1), y: toFixed(900) }, toFixed(0), HALF1, TeamId.A);
    expect(event?.type).toBe('throwIn');
    if (event?.type === 'throwIn') {
      expect(event.restartTeam).toBe(TeamId.B);
      expect(toFloat(event.pos.x)).toBeGreaterThan(0);
      expect(toFloat(event.pos.x)).toBeLessThan(50);
    }
  });

  it('awards the throw-in to the team that did not touch it last, on the right side', () => {
    const event = detectBoundaryEvent(
      { x: toFixed(PITCH_WIDTH + 1), y: toFixed(900) },
      toFixed(0),
      HALF1,
      TeamId.B,
    );
    expect(event?.type).toBe('throwIn');
    if (event?.type === 'throwIn') {
      expect(event.restartTeam).toBe(TeamId.A);
      expect(toFloat(event.pos.x)).toBeLessThan(PITCH_WIDTH);
    }
  });

  it('clamps the restart y away from the goal line even if the ball went out near a corner', () => {
    // y=20はゴールライン判定のしきい値(ボール半径7px)より確実に内側 (=ゴールラインは跨がない)。
    const event = detectBoundaryEvent({ x: toFixed(-1), y: toFixed(20) }, toFixed(0), HALF1, TeamId.A);
    expect(event?.type).toBe('throwIn');
    if (event?.type === 'throwIn') {
      expect(toFloat(event.pos.y)).toBeGreaterThanOrEqual(40);
    }
  });

  it('goal-line detection takes priority over the sideline when both are crossed in the same tick', () => {
    // 左上コーナー付近: x<0 かつ y<0 の両方を跨いでいる。ゴールライン判定が優先されるはず。
    const event = detectBoundaryEvent({ x: toFixed(-5), y: toFixed(-5) }, toFixed(0), HALF1, TeamId.A);
    expect(event?.type).not.toBe('throwIn');
  });
});
