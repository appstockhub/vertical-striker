import { describe, expect, it } from 'vitest';
import { toFixed, ZERO_FIXED } from '../../src/core/fixed';
import { Direction8, emptyButtonState } from '../../src/input/types';
import { createInitialState, TeamId, type GameState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { RESTART_GRACE_TICKS } from '../../src/sim/teamAIConstants';
import { GOAL_KICK_EXCLUSION_DEPTH_FIXED } from '../../src/sim/boundsConstants';

/**
 * B-5(b) の回帰テスト: ゴールキック時の相手退避ゾーンを、発生tickのみの一発ティーポート
 * 押し出しから「RESTART_GRACE_TICKS の間、毎tick再適用」へ変更したことの検証。
 * ユーザー判断: 「人間側がCPUのゴールキックを狙って奪う単調な必勝法を持つと競技性が下がる
 * ため、ルールは対称にしたい」→ 人間操作を含む相手チーム全員(GK以外)が対象。
 *
 * セットアップは tests/sim/restartGrace.test.ts の goalKick トリガーパターンを踏襲する
 * (ゴール幅の外でゴールラインを割らせ goal ではなく goalKick 判定にする)。
 * 注: restartGrace.test.ts の既存コメントは lastTouchTeam=B を「攻撃側」としているが、
 * half1 では Team B が北を守る (teamDefendsNorth) ため、実際には lastTouchTeam=defendingTeam
 * となり corner 判定になる (restartGraceTeam/TicksLeft は corner でも同じ経路で設定されるため
 * その既存テストの assert 自体は偶然通っていた)。goalKick を確実に得るには attackingTeam を
 * lastTouchTeam にする必要があるため、本テストでは Team A を lastTouchTeam にする。
 *
 * half1: teamDefendsNorth(B, 1) === true (formations.ts) なので北端(y小さい)はTeam Bのゴール。
 * 攻撃側 Team A がゴール幅の外(x=100)で北端のゴールラインを割らせると、守備側 Team B に
 * goalKick が与えられる (restartTeam = B, northEnd = true)。
 *
 * 監視対象のindexは players[] の固定index規約 (0=Team A GK, 1-10=Team A outfield,
 * 11=Team B GK, 12-21=Team B outfield) に沿って、GK以外の固定indexを直接指定する
 * (controlledPlayerIndexはカーソル自動追従で変わり得るため、対象特定には使わない)。
 */
const TEAM_A_OUTFIELD_INDEX = 1;
const TEAM_B_OUTFIELD_INDEX = 12;

function triggerGoalKickState(): GameState {
  const base = createInitialState(1, { difficulty: 'hard' });
  const state: GameState = {
    ...base,
    ball: { pos: { x: toFixed(100), y: toFixed(8) }, vel: { x: toFixed(0), y: toFixed(-8) }, height: ZERO_FIXED, zVel: ZERO_FIXED },
    lastTouchTeam: TeamId.A,
  };
  return simulate(state, { direction: Direction8.None, buttons: emptyButtonState() });
}

function withPlayerAt(state: GameState, index: number, x: number, y: number): GameState {
  return {
    ...state,
    players: state.players.map((p, i) => (i === index ? { ...p, pos: { x: toFixed(x), y: toFixed(y) } } : p)),
  };
}

describe('B-5(b): goal kick exclusion applies symmetrically to humans, continuously', () => {
  it('a fresh goal kick sets a decaying exclusion zone for RESTART_GRACE_TICKS', () => {
    const next = triggerGoalKickState();
    expect(next.goalKickExclusion).toEqual({
      restartTeam: TeamId.B,
      northEnd: true,
      ticksLeft: RESTART_GRACE_TICKS,
    });
  });

  it('an opposing outfield player standing inside the zone is pushed out on the very next tick', () => {
    // Team A は restartTeam(B)の相手なので押し出し対象。
    let state = withPlayerAt(triggerGoalKickState(), TEAM_A_OUTFIELD_INDEX, 240, 20);
    // ゴール方向(北, y減少)へ直進する入力を与えても、押し出しに阻まれてゾーン外側に留まる。
    const next = simulate(state, { direction: Direction8.Up, buttons: emptyButtonState() });
    const limitY = GOAL_KICK_EXCLUSION_DEPTH_FIXED as number;
    expect(next.players[TEAM_A_OUTFIELD_INDEX]!.pos.y as number).toBe(limitY);
  });

  it('the restartTeam itself is never pushed, even standing deep inside the zone', () => {
    // Team B は restartTeam自身なので押し出し対象外。この選手は非操作AIなので通常の
    // 1tick移動(最大PLAYER_SPEED=3px)はするが、押し出し先のlimitY(250px)には飛ばない。
    const state = withPlayerAt(triggerGoalKickState(), TEAM_B_OUTFIELD_INDEX, 240, 20);
    const next = simulate(state, { direction: Direction8.None, buttons: emptyButtonState() });
    const limitY = GOAL_KICK_EXCLUSION_DEPTH_FIXED as number;
    const y = next.players[TEAM_B_OUTFIELD_INDEX]!.pos.y as number;
    expect(y).not.toBe(limitY);
    expect(Math.abs(y - (toFixed(20) as number))).toBeLessThanOrEqual(toFixed(3) as number);
  });

  it('the push keeps re-applying every tick for the full grace window, not just once', () => {
    let state = withPlayerAt(triggerGoalKickState(), TEAM_A_OUTFIELD_INDEX, 240, 20);
    const limitY = GOAL_KICK_EXCLUSION_DEPTH_FIXED as number;
    // 北へ入力し続けても、猶予が有効な間はライン上に留まり続ける (発生tickのみの一発
    // 押し出しだった旧実装ならこの入力ですぐゾーン内へ戻れてしまっていた)。
    for (let i = 0; i < RESTART_GRACE_TICKS - 2; i++) {
      state = simulate(state, { direction: Direction8.Up, buttons: emptyButtonState() });
      expect(state.players[TEAM_A_OUTFIELD_INDEX]!.pos.y as number).toBeGreaterThanOrEqual(limitY);
    }
    expect(state.goalKickExclusion).not.toBeNull();
  });

  it('the exclusion expires after RESTART_GRACE_TICKS and the zone is cleared', () => {
    let state = triggerGoalKickState();
    for (let i = 0; i < RESTART_GRACE_TICKS + 5; i++) {
      state = simulate(state, { direction: Direction8.None, buttons: emptyButtonState() });
    }
    expect(state.goalKickExclusion).toBeNull();
  });
});
