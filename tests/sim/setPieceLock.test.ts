import { describe, expect, it } from 'vitest';
import { toFixed, ZERO_FIXED } from '../../src/core/fixed';
import { Direction8, emptyButtonState } from '../../src/input/types';
import { createInitialState, TeamId, type GameState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { attackingIsUpward } from '../../src/sim/formations';
import { GOAL_KICK_EXCLUSION_DEPTH_FIXED, SET_PIECE_EXCLUSION_RADIUS_FIXED } from '../../src/sim/boundsConstants';

/**
 * セットプレー再開ロック (GameState.setPieceLock) の回帰テスト。
 *
 * 任天堂公式取扱説明書での仕様確定を受け、ユーザーから2件の実プレイ不具合が報告された:
 * 「キックする前に敵に取られる」「ゴールキックの向きが最初から自陣ゴールを向いている」。
 * 原因調査の結果、B-5(b)時点の goalKickExclusion は (1) ゴールキックにしか無く
 * スローイン/コーナーは相手が即座に触れられる、(2) 固定RESTART_GRACE_TICKS(63tick)で
 * 時間切れになるため人間の反応が遅いと結局間に合わない、という2つの構造的な不足が
 * あったと判明。本テストは「キッカーが実際に蹴るまで解除されない」新方式を検証する。
 *
 * 監視対象のindexは players[] の固定index規約 (0=Team A GK, 1-10=Team A outfield,
 * 11=Team B GK, 12-21=Team B outfield) に沿って直接指定する。
 */
const TEAM_A_OUTFIELD_INDEX = 1;
const TEAM_B_OUTFIELD_INDEX = 12;

function withPlayerAt(state: GameState, index: number, x: number, y: number): GameState {
  return {
    ...state,
    players: state.players.map((p, i) => (i === index ? { ...p, pos: { x: toFixed(x), y: toFixed(y) } } : p)),
  };
}

function triggerGoalKickState(): GameState {
  // half1: teamDefendsNorth(B,1)===true なので北端(y小さい)はTeam Bのゴール。攻撃側Team Aが
  // ゴール幅の外(x=100)で北端のゴールラインを割らせると、守備側Team Bにgoalkickが与えられる。
  const base = createInitialState(1, { difficulty: 'hard' });
  const state: GameState = {
    ...base,
    ball: {
      pos: { x: toFixed(100), y: toFixed(8) },
      vel: { x: toFixed(0), y: toFixed(-8) },
      height: ZERO_FIXED,
      zVel: ZERO_FIXED,
    },
    lastTouchTeam: TeamId.A,
  };
  return simulate(state, { direction: Direction8.None, buttons: emptyButtonState() });
}

function triggerThrowInState(): GameState {
  // サイドライン(x<=半径)を、lastTouchTeam=Bのボールが割る -> restartTeam=A。
  const base = createInitialState(1, { difficulty: 'hard' });
  const state: GameState = {
    ...base,
    ball: {
      pos: { x: toFixed(8), y: toFixed(900) },
      vel: { x: toFixed(-8), y: ZERO_FIXED },
      height: ZERO_FIXED,
      zVel: ZERO_FIXED,
    },
    lastTouchTeam: TeamId.B,
  };
  return simulate(state, { direction: Direction8.None, buttons: emptyButtonState() });
}

function triggerCornerState(): GameState {
  // ゴール幅の外(x=100)を、守備側(B、北を守る)自身が最後に触れて北端を割る -> コーナー、
  // restartTeam=攻撃側A。
  const base = createInitialState(1, { difficulty: 'hard' });
  const state: GameState = {
    ...base,
    ball: {
      pos: { x: toFixed(100), y: toFixed(8) },
      vel: { x: toFixed(0), y: toFixed(-8) },
      height: ZERO_FIXED,
      zVel: ZERO_FIXED,
    },
    lastTouchTeam: TeamId.B,
  };
  return simulate(state, { direction: Direction8.None, buttons: emptyButtonState() });
}

describe('setPieceLock: goal kick (Y軸ライン除外、B-5(b)からの踏襲)', () => {
  it('a fresh goal kick sets a lock (解除は「キッカーが蹴る」= ボールが動くこと)', () => {
    const next = triggerGoalKickState();
    expect(next.setPieceLock).toEqual({
      kind: 'goalKick',
      restartTeam: TeamId.B,
      pos: { x: toFixed(240), y: toFixed(60) },
      northEnd: true,
      // 経過tick: 試合停止バグの安全網 (SET_PIECE_LOCK_MAX_TICKS) 用のカウンタ。
      elapsedTicks: 0,
      // 24周目サイクル②: 再開キッカー (ロック中は待機し、CPUなら90tick後に自分で蹴る)。
      kickerIndex: 11,
    });
  });

  it('an opposing outfield player standing inside the zone is pushed out on the very tick the lock is created', () => {
    // ★ロック生成と同じtickで判定する★ 以前は「次のtick」で見ていたが、キッカー(GK)を
    // ボール脇へ置く修正が入ったことで、CPUは次のtickにはもうゴールキックを蹴っており
    // (=ロックが正常に解除される)、押し出しを観測できなくなったため。
    const base = createInitialState(1, { difficulty: 'hard' });
    const state: GameState = withPlayerAt(
      {
        ...base,
        ball: {
          pos: { x: toFixed(100), y: toFixed(8) },
          vel: { x: toFixed(0), y: toFixed(-8) },
          height: ZERO_FIXED,
          zVel: ZERO_FIXED,
        },
        lastTouchTeam: TeamId.A,
      },
      TEAM_A_OUTFIELD_INDEX,
      240,
      20,
    );
    const next = simulate(state, { direction: Direction8.Up, buttons: emptyButtonState() });
    const limitY = GOAL_KICK_EXCLUSION_DEPTH_FIXED as number;
    expect(next.players[TEAM_A_OUTFIELD_INDEX]!.pos.y as number).toBe(limitY);
  });

  it('the restartTeam itself is never pushed, even standing deep inside the zone', () => {
    const state = withPlayerAt(triggerGoalKickState(), TEAM_B_OUTFIELD_INDEX, 240, 20);
    const next = simulate(state, { direction: Direction8.None, buttons: emptyButtonState() });
    const limitY = GOAL_KICK_EXCLUSION_DEPTH_FIXED as number;
    const y = next.players[TEAM_B_OUTFIELD_INDEX]!.pos.y as number;
    expect(y).not.toBe(limitY);
  });

  it('the push keeps re-applying far beyond the old fixed RESTART_GRACE_TICKS window (time-unlimited)', () => {
    // 旧実装は63tickで時間切れになっていた。restartTeam(B)側の選手も含め全員をボールから
    // 十分離しておき(=誰も実際には触れられず解除条件が発生しない)、テスト対象のTeam A選手
    // だけを人間操作にして北(除外ゾーンの中心)へ押し続けさせる。300tick(旧の約5倍)経っても
    // 押し出され続ける(=時間切れで解除されない)ことを確認する。
    const base = createInitialState(1, { difficulty: 'hard' });
    const spot = { x: toFixed(240), y: toFixed(60) };
    let state: GameState = {
      ...base,
      ball: { pos: spot, vel: { x: ZERO_FIXED, y: ZERO_FIXED }, height: ZERO_FIXED, zVel: ZERO_FIXED },
      lastTouchTeam: TeamId.B,
      setPieceLock: { kind: 'goalKick', restartTeam: TeamId.B, pos: spot, northEnd: true },
      controlledPlayerIndex: TEAM_A_OUTFIELD_INDEX,
      players: base.players.map((p, i) =>
        i === TEAM_A_OUTFIELD_INDEX ? { ...p, pos: { x: toFixed(240), y: toFixed(20) } } : { ...p, pos: { x: toFixed(240), y: toFixed(1000) } },
      ),
    };
    const limitY = GOAL_KICK_EXCLUSION_DEPTH_FIXED as number;
    for (let i = 0; i < 300; i++) {
      state = simulate(state, { direction: Direction8.Up, buttons: emptyButtonState() });
      expect(state.players[TEAM_A_OUTFIELD_INDEX]!.pos.y as number).toBeGreaterThanOrEqual(limitY);
    }
    expect(state.setPieceLock).not.toBeNull();
  });
});

describe('setPieceLock: throw-in / corner (円形近似の除外ゾーン、新規)', () => {
  it('a throw-in sets a lock with the restart spot as center', () => {
    const next = triggerThrowInState();
    expect(next.setPieceLock?.kind).toBe('throwIn');
    expect(next.setPieceLock?.restartTeam).toBe(TeamId.A);
  });

  it('a corner sets a lock with the restart spot as center', () => {
    const next = triggerCornerState();
    expect(next.setPieceLock?.kind).toBe('corner');
    expect(next.setPieceLock?.restartTeam).toBe(TeamId.A);
  });

  it('an opposing player standing inside the exclusion square is pushed to its edge', () => {
    const base = triggerThrowInState();
    const spot = base.setPieceLock!.pos;
    // restartTeam=A なので Team B (index12) が押し出し対象。復帰スポットのすぐ内側に置く。
    let state = withPlayerAt(base, TEAM_B_OUTFIELD_INDEX, (spot.x as number) / 256, (spot.y as number) / 256 + 5);
    const next = simulate(state, { direction: Direction8.None, buttons: emptyButtonState() });
    const p = next.players[TEAM_B_OUTFIELD_INDEX]!;
    const dx = Math.abs((p.pos.x as number) - (spot.x as number));
    const dy = Math.abs((p.pos.y as number) - (spot.y as number));
    const r = SET_PIECE_EXCLUSION_RADIUS_FIXED as number;
    // 正方形除外ゾーンの外側 (どちらかの軸で半径以上離れている)。
    expect(dx >= r || dy >= r).toBe(true);
  });

  it('the restartTeam itself is never pushed near a throw-in/corner spot', () => {
    const base = triggerThrowInState();
    const spot = base.setPieceLock!.pos;
    const startY = (spot.y as number) / 256 + 5;
    const state = withPlayerAt(base, TEAM_A_OUTFIELD_INDEX, (spot.x as number) / 256, startY);
    const next = simulate(state, { direction: Direction8.None, buttons: emptyButtonState() });
    // 押し出されていれば半径ちょうどの境界に飛ぶが、restartTeamは対象外なので
    // 通常の1tick移動量(最大PLAYER_SPEED=3px)以内の変化に留まる。
    const movedY = Math.abs((next.players[TEAM_A_OUTFIELD_INDEX]!.pos.y as number) - toFixed(startY));
    expect(movedY).toBeLessThanOrEqual(toFixed(3) as number);
  });

  it('an opponent placed exactly at the resting ball cannot gain touch priority (structural guarantee)', () => {
    // 押し出しのタイミング(このtickの移動処理後にしか効かない)に依存せず、
    // touch-priorityのteam制限だけでも相手が触れないことを確認する。
    const base = triggerThrowInState();
    const spot = base.setPieceLock!.pos;
    const state = withPlayerAt(base, TEAM_B_OUTFIELD_INDEX, (spot.x as number) / 256, (spot.y as number) / 256);
    const next = simulate(state, { direction: Direction8.None, buttons: emptyButtonState() });
    // 相手が触れていれば lastTouchTeam が B に変わる/ボールが動くはずだが、そうならない。
    expect(next.lastTouchTeam).toBe(TeamId.A);
    expect(next.ball.vel.x as number).toBe(ZERO_FIXED as number);
    expect(next.ball.vel.y as number).toBe(ZERO_FIXED as number);
  });
});

describe('setPieceLock: release when the kicker actually plays the ball (time-unlimited otherwise)', () => {
  it('the lock clears once the restartTeam kicker kicks the ball away', () => {
    const base = triggerGoalKickState();
    const spot = base.setPieceLock!.pos;
    expect(base.setPieceLock).not.toBeNull();
    // restartTeam=B の選手をボールの真上に置き、Bボタンでキックさせる。
    let state = withPlayerAt(base, TEAM_B_OUTFIELD_INDEX, (spot.x as number) / 256, (spot.y as number) / 256);
    state = { ...state, controlledPlayerIndex: TEAM_B_OUTFIELD_INDEX };
    const next = simulate(state, { direction: Direction8.Down, buttons: { ...emptyButtonState(), B: true } });
    expect(next.setPieceLock).toBeNull();
    expect(next.ball.vel.y as number).not.toBe(ZERO_FIXED as number);
  });
});

describe('setPieceLock: kicker faces the attacking direction (実プレイ報告への対応)', () => {
  it('goal kick: the nearest restartTeam player is turned to face upfield on the very restart tick', () => {
    // ゴールキック発生「前」の状態でキッカー候補(Team BのGK)を復帰スポット直近に置き、
    // わざと自陣を向かせておく (「ボールを追って戻る途中で自陣を向いたまま止まる」の再現)。
    // boundaryEventが発生するこのtickでfacingが攻撃方向へ矯正されることを確認する。
    const base = createInitialState(1, { difficulty: 'hard' });
    const spot = { x: toFixed(240), y: toFixed(60) }; // GOAL_KICK_DEPTH=60, ゴール中央
    const expectedFacing = attackingIsUpward(TeamId.B, 1) ? Direction8.Up : Direction8.Down;
    const wrongFacing = expectedFacing === Direction8.Up ? Direction8.Down : Direction8.Up;
    const state: GameState = {
      ...base,
      ball: {
        pos: { x: toFixed(100), y: toFixed(8) },
        vel: { x: toFixed(0), y: toFixed(-8) },
        height: ZERO_FIXED,
        zVel: ZERO_FIXED,
      },
      lastTouchTeam: TeamId.A,
      players: base.players.map((p, i) => (i === 11 ? { ...p, pos: spot, facing: wrongFacing } : p)),
    };
    const next = simulate(state, { direction: Direction8.None, buttons: emptyButtonState() });
    expect(next.setPieceLock?.kind).toBe('goalKick');
    expect(next.players[11]!.facing).toBe(expectedFacing);
  });
});
