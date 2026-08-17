import { describe, expect, it } from 'vitest';
import { distSqFixed, toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { Direction8, emptyButtonState } from '../../src/input/types';
import { createInitialState, TeamId, type GameState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../../src/config/pitch';
import { depthFromOwnGoal } from '../../src/sim/formations';
import { KICKOFF_CIRCLE_RADIUS_FIXED } from '../../src/sim/boundsConstants';
import { KICK_WINDUP_TICKS, STRONG_KICK_SPEED_FIXED } from '../../src/sim/ballConstants';

/**
 * ★キックオフのルール (サッカー競技規則 第8条) の実装テスト★
 *
 * ユーザーの実プレイ報告: 「点を決められてこちらのキックオフなのに敵が奪取できる。
 * 破綻しているでしょ、サッカーのルールに」。
 *
 * 調査の結果、キックオフのルールは一つも実装されていなかった:
 *   - キッカーがボールの位置に立たない (自陣FWがボールから135px離れて配置される)
 *   - 相手がセンターサークルの外に出る規定が無い
 *   - 「ボールが蹴られるまで相手は触れない」が無く、0.25秒(15tick)だけAIの追跡を
 *     止めるだけだった。その後は両チームが同距離135pxからの徒競走になる
 *   - 全員が自陣ハーフ内にいる規定が無い
 *
 * 競技規則 第8条 (キックオフ) の要点:
 *   - ボールはセンターマークに静止して置かれる
 *   - すべての競技者は自分のハーフ内にいなければならない
 *   - キックオフを行うチームの相手competitorは、ボールがインプレーになるまで
 *     センターサークル(半径9.15m)の外にいなければならない
 *   - ボールは蹴られて明らかに動いたときインプレーになる
 *   - 得点されたチームがキックオフを行う
 */

const NO_INPUT = { direction: Direction8.None, buttons: emptyButtonState() };

/** Team B に得点させ、その次のtick (= Team A のキックオフ) の状態を返す。 */
function stateAfterConcedingGoal(): GameState {
  const base = createInitialState(1, { difficulty: 'hard', offsideEnabled: false });
  // 南(y=1800)は half=1 で Team A の自陣ゴール。Team B が最後に触れたボールを押し込む。
  let state: GameState = {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      pos: { x: toFixed(20 + (p.slotIndex % 4) * 25), y: toFixed(p.team === TeamId.A ? 300 : 200) },
    })),
    ball: {
      ...base.ball,
      pos: { x: toFixed(PITCH_WIDTH / 2), y: toFixed(PITCH_HEIGHT - 10) },
      vel: { x: ZERO_FIXED, y: toFixed(6) },
    },
    lastTouchTeam: TeamId.B,
  };
  for (let i = 0; i < 40; i++) {
    state = simulate(state, NO_INPUT);
    if (state.score[1] > 0) return state;
  }
  throw new Error('テストの前提が崩れている: Team B が得点できなかった');
}

function distToBall(state: GameState, index: number): number {
  return Math.sqrt(toFloat(distSqFixed(state.players[index]!.pos, state.ball.pos)));
}

/** ボールに最も近い、指定チームの選手までの距離。 */
function nearestDistOfTeam(state: GameState, team: TeamId): number {
  let best = Infinity;
  state.players.forEach((p, i) => {
    if (p.team !== team) return;
    best = Math.min(best, distToBall(state, i));
  });
  return best;
}

describe('キックオフ: 得点されたチームがボールを持って再開する (第8条)', () => {
  it('得点直後、ボールはセンターマークに静止して置かれる', () => {
    const state = stateAfterConcedingGoal();
    expect(toFloat(state.ball.pos.x)).toBeCloseTo(PITCH_WIDTH / 2, 0);
    expect(toFloat(state.ball.pos.y)).toBeCloseTo(PITCH_HEIGHT / 2, 0);
    expect(state.ball.vel.x).toBe(ZERO_FIXED);
    expect(state.ball.vel.y).toBe(ZERO_FIXED);
  });

  it('★実プレイ報告の中核★ キックオフするチーム(得点された側)の選手がボールの位置にいる', () => {
    const state = stateAfterConcedingGoal();
    const kicker = nearestDistOfTeam(state, TeamId.A);
    // 旧実装では両チームとも135px離れており「早い者勝ちの徒競走」になっていた。
    // 実際のキックオフはキッカーがボールに足を添えて立っている。
    expect(kicker, 'キックオフするチームの選手がボールから離れている').toBeLessThan(20);
  });

  it('★実プレイ報告の中核★ 相手チームはセンターサークルの外にいる', () => {
    const state = stateAfterConcedingGoal();
    const opponent = nearestDistOfTeam(state, TeamId.B);
    const circle = toFloat(KICKOFF_CIRCLE_RADIUS_FIXED);
    expect(opponent, '相手がセンターサークル内にいる').toBeGreaterThanOrEqual(circle - 1);
  });

  it('★実プレイ報告の中核★ 蹴る前に相手がボールを奪えない (無操作で放置しても)', () => {
    let state = stateAfterConcedingGoal();
    // 人間が何も操作しない = まだ蹴っていない。この間ずっと相手は触れないはず。
    for (let i = 0; i < 120; i++) {
      state = simulate(state, NO_INPUT);
      expect(state.lastTouchTeam, `t${i}: 蹴る前に相手にボールを触られた`).not.toBe(TeamId.B);
      const opponent = nearestDistOfTeam(state, TeamId.B);
      expect(opponent, `t${i}: 相手がセンターサークル内へ侵入した`).toBeGreaterThanOrEqual(
        toFloat(KICKOFF_CIRCLE_RADIUS_FIXED) - 2,
      );
    }
  });

  it('全員が自分のハーフ内にいる', () => {
    const state = stateAfterConcedingGoal();
    const half = getHalfOf(state);
    state.players.forEach((p, i) => {
      const depth = toFloat(depthFromOwnGoal(p.team, half, p.pos.y));
      // 自陣ハーフ = 自ゴールからの深さが PITCH_HEIGHT/2 以内。
      // キッカーはセンターマークのすぐ手前に立つのでちょうど境界付近になる (許容2px)。
      expect(depth, `players[${i}] が相手ハーフにいる`).toBeLessThanOrEqual(PITCH_HEIGHT / 2 + 2);
    });
  });

  it('キックオフしたチームが自分で蹴り出せる (ロックはボールが動いたら解除される)', () => {
    let state = stateAfterConcedingGoal();
    const kickerIndex = state.controlledPlayerIndex;
    expect(distToBall(state, kickerIndex), 'カーソルがキッカーに乗っていない').toBeLessThan(20);

    // Bを溜めて離す = キックオフを蹴る。発射はワインドアップ (KICK_WINDUP_TICKS) 後 (不具合#4)。
    state = simulate(state, { direction: Direction8.Up, buttons: { ...emptyButtonState(), B: true } });
    state = simulate(state, { direction: Direction8.Up, buttons: { ...emptyButtonState(), B: true } });
    state = simulate(state, { direction: Direction8.Up, buttons: emptyButtonState() }); // 解放
    for (let i = 0; i < KICK_WINDUP_TICKS; i++) state = simulate(state, NO_INPUT); // 発射tickまで待つ

    const speed = Math.hypot(toFloat(state.ball.vel.x), toFloat(state.ball.vel.y));
    // テンポ変更追従: 強キック 9.0→2.7px/tick。裸の3ではなく定数からの相対値で判定する。
    expect(speed, 'キックオフを蹴れない').toBeGreaterThan(toFloat(STRONG_KICK_SPEED_FIXED) * 0.8);
    expect(state.setPieceLock, '蹴ったのにロックが解除されない').toBeNull();
  });
});

describe('キックオフ: 試合開始と後半開始', () => {
  it('試合開始時も同じルールが適用される (キッカーがボール位置、相手はサークル外)', () => {
    const state = createInitialState(1, { difficulty: 'easy' });
    expect(nearestDistOfTeam(state, TeamId.A), '試合開始時のキッカーがボールから離れている').toBeLessThan(20);
    expect(nearestDistOfTeam(state, TeamId.B), '試合開始時に相手がサークル内にいる').toBeGreaterThanOrEqual(
      toFloat(KICKOFF_CIRCLE_RADIUS_FIXED) - 1,
    );
  });

  it('得点したチームはキックオフしない (得点された側が蹴る)', () => {
    const state = stateAfterConcedingGoal();
    // Team B が得点 → Team A (得点された側) がキックオフ
    expect(state.setPieceLock?.restartTeam).toBe(TeamId.A);
  });
});

/** テスト用: そのstateの前後半を求める (matchClockと同じ規則)。 */
function getHalfOf(state: GameState): 1 | 2 {
  return state.frame < 10800 ? 1 : 2;
}
