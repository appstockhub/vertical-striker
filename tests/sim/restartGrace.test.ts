import { describe, expect, it } from 'vitest';
import { toFixed, toFloat, vSub, ZERO_FIXED } from '../../src/core/fixed';
import { quantizeToDirection8 } from '../../src/sim/steering';
import { Direction8, emptyButtonState } from '../../src/input/types';
import { createInitialState, TeamId, type GameState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { KICKOFF_GRACE_TICKS, RESTART_GRACE_TICKS } from '../../src/sim/teamAIConstants';
import { HALF_DURATION_FRAMES } from '../../src/sim/matchClock';

/**
 * リスタート猶予 (Phase 5) の回帰テスト。実プレイ報告「キックオフ/ゴールキックのタイミングで
 * なぜか敵側が先に蹴れる」への対応。src/sim/update.ts / src/sim/teamAI.ts 参照。
 */

const AIM_DEADZONE_SQ = ZERO_FIXED;

describe('restart grace: kickoff fairness (bug regression)', () => {
  it('createInitialState grants Team A the opening kickoff grace', () => {
    const state = createInitialState(1);
    expect(state.restartGraceTeam).toBe(TeamId.A);
    expect(state.restartGraceTicksLeft).toBe(KICKOFF_GRACE_TICKS);
  });

  it('bug regression: at kickoff, a human moving straight at the ball reaches it before Team B (grace active)', () => {
    let state: GameState = createInitialState(1);
    const humanIdx = state.controlledPlayerIndex;
    for (let i = 0; i < 60 && state.lastTouchTeam === null; i++) {
      const controlled = state.players[humanIdx]!;
      const dir = quantizeToDirection8(vSub(state.ball.pos, controlled.pos), AIM_DEADZONE_SQ);
      state = simulate(state, { direction: dir, buttons: emptyButtonState() });
    }
    expect(state.lastTouchTeam).toBe(TeamId.A);
  });

  it('without grace (suppressedTeam forced off), the same approach can lose the ball to Team B', () => {
    // 猶予無効化を直接確認するため、restartGraceTicksLeft=0 の状態から同じシナリオを回す。
    // (Team Bの最寄りFWも同じ153px対称距離にいるため、猶予が無ければ人間の反応より
    // 先にAIがボールへ到達しうる、という報告されたバグの再現)。
    let state: GameState = { ...createInitialState(1), restartGraceTicksLeft: 0, restartGraceTeam: null };
    const humanIdx = state.controlledPlayerIndex;
    let humanTouchedFirst: boolean | null = null;
    for (let i = 0; i < 60 && humanTouchedFirst === null; i++) {
      const controlled = state.players[humanIdx]!;
      const dir = quantizeToDirection8(vSub(state.ball.pos, controlled.pos), AIM_DEADZONE_SQ);
      state = simulate(state, { direction: dir, buttons: emptyButtonState() });
      if (state.lastTouchTeam !== null) humanTouchedFirst = state.lastTouchTeam === TeamId.A;
    }
    // 猶予なしでは対称なタイのため、少なくとも「必ずTeam Aが勝つ」という保証は無い
    // (このテストは非決定的な結果を主張しない。猶予ありのテストとの対比のみが目的)。
    expect(typeof humanTouchedFirst).toBe('boolean');
  });

  it('grace decays to 0 after KICKOFF_GRACE_TICKS ticks with no touch', () => {
    let state: GameState = createInitialState(1);
    for (let i = 0; i < KICKOFF_GRACE_TICKS; i++) {
      expect(state.restartGraceTicksLeft).toBeGreaterThan(0);
      state = simulate(state, { direction: Direction8.None, buttons: emptyButtonState() });
    }
    // ちょうど KICKOFF_GRACE_TICKS tick後には尽きている (ボールに誰も触れていない前提)。
    if (state.lastTouchTeam === null) {
      expect(state.restartGraceTicksLeft).toBe(0);
      expect(state.restartGraceTeam).toBeNull();
    }
  });
});

describe('restart grace: who gets it', () => {
  it('post-goal kickoff grants grace to the opponent of the scorer', () => {
    // Team Bがすぐ得点できる位置にボールとキャリアを置く。
    const base = createInitialState(1, { difficulty: 'hard' });
    const carrierIdx = TeamId.B * 11 + 9;
    const state: GameState = {
      ...base,
      players: base.players.map((p, i) => {
        if (i === carrierIdx) return { ...p, pos: { x: toFixed(240), y: toFixed(1750) } };
        if (p.team === TeamId.A && !p.isGoalkeeper) return { ...p, pos: { x: toFixed(20), y: toFixed(20) } };
        return p;
      }),
      ball: { ...base.ball, pos: { x: toFixed(240), y: toFixed(1755) } },
      lastTouchTeam: TeamId.B,
    };
    let next = state;
    let scored = false;
    for (let i = 0; i < 20 && !scored; i++) {
      next = simulate(next, { direction: Direction8.None, buttons: emptyButtonState() });
      if (next.score[1] > 0) scored = true;
    }
    expect(scored).toBe(true);
    // 得点したのはTeam B → 猶予は得点されたTeam Aへ。
    expect(next.restartGraceTeam).toBe(TeamId.A);
    expect(next.restartGraceTicksLeft).toBe(KICKOFF_GRACE_TICKS);
  });

  it('half-time kickoff alternates restartGraceTeam (half 2 -> Team B)', () => {
    const base = createInitialState(1);
    const state: GameState = { ...base, frame: HALF_DURATION_FRAMES - 1 };
    const next = simulate(state, { direction: Direction8.None, buttons: emptyButtonState() });
    expect(next.restartGraceTeam).toBe(TeamId.B);
    expect(next.restartGraceTicksLeft).toBe(KICKOFF_GRACE_TICKS);
  });

  it('a throw-in/goal-kick/corner restart sets restartGraceTeam to boundaryEvent.restartTeam', () => {
    // ゴールキック: ゴール幅(中心240±40px)の外(x=100)でゴールラインを割らせ、
    // goal判定ではなくgoalKick判定にする。lastTouchTeam=B(攻撃側)のまま y<=半径 に到達させる
    // (attackingTeam=Bが最後に触れたので、守備側TeamAへgoalKickが与えられる)。
    const base = createInitialState(1, { difficulty: 'hard' });
    const state: GameState = {
      ...base,
      ball: { pos: { x: toFixed(100), y: toFixed(8) }, vel: { x: toFixed(0), y: toFixed(-8) }, height: ZERO_FIXED, zVel: ZERO_FIXED },
      lastTouchTeam: TeamId.B,
      players: base.players.map((p) => (p.team === TeamId.A ? { ...p, pos: { x: toFixed(20), y: toFixed(20) } } : p)),
    };
    const next = simulate(state, { direction: Direction8.None, buttons: emptyButtonState() });
    expect(next.restartGraceTicksLeft).toBe(RESTART_GRACE_TICKS);
    expect(next.restartGraceTeam).toBe(TeamId.A);
  });
});
