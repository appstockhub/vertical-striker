import { describe, expect, it } from 'vitest';
import { distSqFixed, toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { createInitialState, TeamId, type GameState, type PlayerState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { Direction8, emptyButtonState, LogicalButton, type ButtonState } from '../../src/input/types';
import { FULL_MATCH_DURATION_FRAMES, HALF_DURATION_FRAMES } from '../../src/sim/matchClock';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../../src/config/pitch';
import { CURVE_DURATION_TICKS, CURVE_INPUT_WINDOW_TICKS, STRONG_KICK_SPEED_FIXED } from '../../src/sim/ballConstants';
import { SET_PIECE_LOCK_MAX_TICKS } from '../../src/sim/boundsConstants';
import { MANUAL_LINE_OFFSET_MAX_FIXED, MANUAL_LINE_OFFSET_STEP_FIXED } from '../../src/sim/teamAIConstants';
import { runTicks } from '../../src/sim/tempo';

function inputs(direction: Direction8) {
  return { direction, buttons: emptyButtonState() };
}

function inputsWithButtons(direction: Direction8, held: Partial<Record<LogicalButton, boolean>>) {
  const buttons: ButtonState = { ...emptyButtonState(), ...held };
  return { direction, buttons };
}

/** 現在の操作選手 (Phase 2 では players[] の一要素)。テストの可読性のためのヘルパー。 */
function controlled(state: GameState): PlayerState {
  const player = state.players[state.controlledPlayerIndex];
  if (!player) throw new Error('no controlled player');
  return player;
}

/** テスト用: 操作選手/ボールの初期位置だけを差し替えた GameState を作る。 */
function withPositions(
  seed: number,
  playerPos: { x: number; y: number },
  ballPos: { x: number; y: number },
): GameState {
  const base = createInitialState(seed);
  const idx = base.controlledPlayerIndex;
  const players = base.players.map((p, i) =>
    i === idx ? { ...p, pos: { x: toFixed(playerPos.x), y: toFixed(playerPos.y) } } : p,
  );
  return {
    ...base,
    players,
    ball: { ...base.ball, pos: { x: toFixed(ballPos.x), y: toFixed(ballPos.y) } },
  };
}

describe('simulate (pure state transition)', () => {
  it('is deterministic: same seed + same input sequence -> identical states', () => {
    const sequence = [
      Direction8.Up,
      Direction8.Up,
      Direction8.UpRight,
      Direction8.Right,
      Direction8.None,
      Direction8.DownLeft,
    ];

    let stateA = createInitialState(123);
    let stateB = createInitialState(123);

    for (const dir of sequence) {
      stateA = simulate(stateA, inputs(dir));
      stateB = simulate(stateB, inputs(dir));
    }

    expect(stateA).toEqual(stateB);
  });

  it('does not mutate the input state object', () => {
    const state = createInitialState(1);
    const snapshotBefore = JSON.parse(JSON.stringify(state));
    simulate(state, inputs(Direction8.Up));
    expect(state).toEqual(snapshotBefore);
  });

  it('moves the controlled player up when Direction8.Up is held', () => {
    const state = createInitialState(1);
    const next = simulate(state, inputs(Direction8.Up));
    expect(controlled(next).pos.y).toBeLessThan(controlled(state).pos.y);
    expect(controlled(next).pos.x).toBe(controlled(state).pos.x);
  });

  it('non-controlled players are steered by team AI, not left frozen', () => {
    // キックオフ直後は誰もホームポジションから動いていないため、AIは基本的に静止か
    // ごく小さな補正のみを行う。ここでは「AIが例外を投げず、22人ぶんの新しい状態を
    // 返す」ことと「非操作選手のkickChargeFramesが常に0のまま」を確認する
    // (自律的にキックしない、というPhase 2のスコープ外指定の回帰チェック)。
    const state = createInitialState(1);
    const next = simulate(state, inputs(Direction8.Up));
    expect(next.players).toHaveLength(22);
    for (let i = 0; i < next.players.length; i++) {
      if (i === state.controlledPlayerIndex) continue;
      expect(next.players[i]?.kickChargeFrames).toBe(0);
    }
  });

  it('diagonal movement has the same speed as cardinal movement', () => {
    const state = createInitialState(1);
    const up = simulate(state, inputs(Direction8.Up));
    const upRight = simulate(state, inputs(Direction8.UpRight));

    const upDist = Math.abs(controlled(state).pos.y - controlled(up).pos.y);
    const upRightDx = Math.abs(controlled(state).pos.x - controlled(upRight).pos.x);
    const upRightDy = Math.abs(controlled(state).pos.y - controlled(upRight).pos.y);
    const upRightDist = Math.sqrt(upRightDx ** 2 + upRightDy ** 2);

    // 事前正規化された対角ベクトルにより、微小な丸め誤差の範囲で速度が一致する。
    // テンポ変更追従: 選手速度が0.525px/tick (=134raw) になり、対角成分の丸め
    // (round(134×0.7071)=95raw) の相対誤差が旧値より大きく出るため、許容を
    // 2raw (=1/128px、サブピクセル) に緩める。速度の一致という意味は変えていない。
    expect(Math.abs(upDist - upRightDist)).toBeLessThanOrEqual(2);
  });

  it('increments the frame counter each tick', () => {
    const state = createInitialState(1);
    const next = simulate(state, inputs(Direction8.None));
    expect(next.frame).toBe(state.frame + 1);
  });

  it('keeps the controlled player within pitch bounds', () => {
    let state = createInitialState(1);
    for (let i = 0; i < 1000; i++) {
      state = simulate(state, inputs(Direction8.Up));
    }
    expect(controlled(state).pos.y).toBeGreaterThanOrEqual(0);
  });

  it('has exactly 22 players with the documented index convention', () => {
    const state = createInitialState(1);
    expect(state.players).toHaveLength(22);
    expect(state.players[0]?.isGoalkeeper).toBe(true);
    expect(state.players[0]?.team).toBe(0); // TeamId.A
    expect(state.players[11]?.isGoalkeeper).toBe(true);
    expect(state.players[11]?.team).toBe(1); // TeamId.B
    for (let i = 1; i <= 10; i++) {
      expect(state.players[i]?.isGoalkeeper).toBe(false);
      expect(state.players[i]?.team).toBe(0);
    }
    for (let i = 12; i <= 21; i++) {
      expect(state.players[i]?.isGoalkeeper).toBe(false);
      expect(state.players[i]?.team).toBe(1);
    }
  });
});

describe('simulate — Phase 1/2: dribble + kick integration (controlled player only)', () => {
  it('is deterministic across a sequence including a charged kick and long dribble', () => {
    const sequence: Array<{ direction: Direction8; held: Partial<Record<LogicalButton, boolean>> }> = [
      { direction: Direction8.Up, held: {} },
      { direction: Direction8.Up, held: { L: true } }, // L単独(蹴り出しドリブルは未トリガー、決定論確認が目的なので無関係)
      { direction: Direction8.None, held: { B: true } }, // キック溜め開始
      { direction: Direction8.None, held: { B: true } },
      { direction: Direction8.None, held: { B: true } },
      { direction: Direction8.Right, held: {} }, // B解放=キック実行
    ];

    let stateA = withPositions(42, { x: 100, y: 200 }, { x: 105, y: 200 });
    let stateB = withPositions(42, { x: 100, y: 200 }, { x: 105, y: 200 });

    for (const { direction, held } of sequence) {
      stateA = simulate(stateA, inputsWithButtons(direction, held));
      stateB = simulate(stateB, inputsWithButtons(direction, held));
    }

    expect(stateA).toEqual(stateB);
  });

  it('does not mutate the input state when dribbling/kicking', () => {
    const state = withPositions(1, { x: 100, y: 200 }, { x: 105, y: 200 });
    const snapshotBefore = JSON.parse(JSON.stringify(state));
    simulate(state, inputsWithButtons(Direction8.Right, { B: true }));
    expect(state).toEqual(snapshotBefore);
  });

  it('nudges the ball forward when the player dribbles into it', () => {
    const state = withPositions(1, { x: 100, y: 100 }, { x: 105, y: 100 });
    const next = simulate(state, inputs(Direction8.Right));
    expect(toFloat(next.ball.pos.x)).toBeGreaterThan(toFloat(state.ball.pos.x));
    expect(toFloat(next.ball.vel.x)).toBeGreaterThan(0);
  });

  it('kick-out dribble (続編仕様): L alone (never L+R) does NOT trigger it — must start with L+R together', () => {
    const base = withPositions(1, { x: 100, y: 100 }, { x: 105, y: 100 });
    const plain = simulate(base, inputs(Direction8.Right));
    const lOnly = simulate(base, inputsWithButtons(Direction8.Right, { L: true }));
    expect(toFloat(lOnly.ball.pos.x)).toBeCloseTo(toFloat(plain.ball.pos.x), 5);
  });

  it('kick-out dribble: L+R together triggers it, then holding just L sustains it across ticks', () => {
    const base = withPositions(1, { x: 100, y: 100 }, { x: 105, y: 100 });
    const plain = simulate(base, inputs(Direction8.Right));

    // 1tick目: L+Rで新規トリガー。
    const triggered = simulate(base, inputsWithButtons(Direction8.Right, { L: true, R: true }));
    const plainDelta = toFloat(plain.ball.pos.x) - toFloat(base.ball.pos.x);
    const triggeredDelta = toFloat(triggered.ball.pos.x) - toFloat(base.ball.pos.x);
    expect(triggeredDelta).toBeGreaterThan(plainDelta);
    expect(controlled(triggered).kickDribbleActive).toBe(true);

    const triggeredPlayerDelta = toFloat(controlled(triggered).pos.x) - toFloat(controlled(base).pos.x);
    const plainPlayerDelta = toFloat(controlled(plain).pos.x) - toFloat(controlled(base).pos.x);
    expect(triggeredPlayerDelta).toBeGreaterThan(plainPlayerDelta);

    // 2tick目: Lだけを押し続けても継続する(ボールに再度触れる位置まで少し離しておく必要は
    // 無い。ドリブル半径内なので毎tick触れ続ける)。
    const sustained = simulate(triggered, inputsWithButtons(Direction8.Right, { L: true }));
    expect(controlled(sustained).kickDribbleActive).toBe(true);
    const sustainedPlayerDelta = toFloat(controlled(sustained).pos.x) - toFloat(controlled(triggered).pos.x);
    expect(sustainedPlayerDelta).toBeGreaterThan(plainPlayerDelta);

    // 3tick目: L/Rどちらも離すと解除される。
    const released = simulate(sustained, inputs(Direction8.Right));
    expect(controlled(released).kickDribbleActive).toBe(false);
  });

  it('charging B then releasing with a direction launches the ball airborne toward that direction', () => {
    let state = withPositions(1, { x: 100, y: 100 }, { x: 105, y: 100 });

    const chargeTicks = 20;
    for (let i = 0; i < chargeTicks; i++) {
      state = simulate(state, inputsWithButtons(Direction8.None, { B: true }));
    }
    expect(controlled(state).kickChargeFrames).toBe(chargeTicks);

    const afterKick = simulate(state, inputsWithButtons(Direction8.Right, {}));
    expect(controlled(afterKick).kickChargeFrames).toBe(0);
    expect(toFloat(afterKick.ball.zVel)).toBeGreaterThan(0);
    expect(toFloat(afterKick.ball.vel.x)).toBeGreaterThan(0);
  });

  it('a short tap (min charge) kick stays a grounder (near-zero zVel)', () => {
    const state = withPositions(1, { x: 100, y: 100 }, { x: 105, y: 100 });
    const charging = simulate(state, inputsWithButtons(Direction8.None, { B: true }));
    const released = simulate(charging, inputsWithButtons(Direction8.Right, {}));
    expect(toFloat(released.ball.zVel)).toBeCloseTo(0, 1);
    expect(toFloat(released.ball.vel.x)).toBeGreaterThan(0);
  });

  it('カーブ(続編仕様③): a direct kick opens a curve input window, consumed by the next direction press', () => {
    let state = withPositions(1, { x: 100, y: 100 }, { x: 105, y: 100 });
    state = simulate(state, inputsWithButtons(Direction8.None, { B: true }));
    const afterKick = simulate(state, inputsWithButtons(Direction8.Right, {}));
    // キックが開いたウィンドウ(CURVE_INPUT_WINDOW_TICKS)は、同tick内でボール物理更新が
    // 1回走るぶん既に1減っている(applyKickが先に設定→stepBallPhysicsDetailedが後で減衰)。
    expect(afterKick.ball.curveWindowTicksLeft).toBe(CURVE_INPUT_WINDOW_TICKS - 1);
    expect(afterKick.ball.curveDirection).toBe(Direction8.None);

    const afterCurveInput = simulate(afterKick, inputs(Direction8.Up));
    expect(afterCurveInput.ball.curveDirection).toBe(Direction8.Up);
    // 発動tick自体でもstepBallPhysicsDetailedが1回減衰させるため -1。
    expect(afterCurveInput.ball.curveTicksLeft).toBe(CURVE_DURATION_TICKS - 1);
    expect(toFloat(afterCurveInput.ball.vel.y)).toBeLessThan(0); // Up方向へ曲がり始めている
  });

  it('カーブ: the input window expires with no curve applied if no direction is pressed in time', () => {
    let state = withPositions(1, { x: 100, y: 100 }, { x: 105, y: 100 });
    state = simulate(state, inputsWithButtons(Direction8.None, { B: true }));
    let afterKick = simulate(state, inputsWithButtons(Direction8.Right, {}));
    for (let i = 0; i < CURVE_INPUT_WINDOW_TICKS + 2; i++) {
      afterKick = simulate(afterKick, inputs(Direction8.None));
    }
    expect(afterKick.ball.curveWindowTicksLeft).toBe(0);
    expect(afterKick.ball.curveDirection).toBe(Direction8.None);
  });
});

describe('simulate — Phase 2: full 22-player determinism regression (milestone 6)', () => {
  // カーソル切替(L/Y)・キック溜め・タックル(B)・GK自動交代(L)など、Phase 2で追加した
  // 全メカニクスに触れ得る、変化に富んだ入力列。狙った通りに各メカニクスが必ず発火するとは
  // 限らないが (状況依存のため)、目的は「同一seed+同一入力列なら22人分の状態が
  // 何tick経っても完全に一致する」という決定論の維持を確認すること。
  const sequence: Array<{ direction: Direction8; held: Partial<Record<LogicalButton, boolean>> }> = [
    { direction: Direction8.Up, held: {} },
    { direction: Direction8.Up, held: {} },
    { direction: Direction8.UpRight, held: { L: true } },
    { direction: Direction8.Right, held: {} },
    { direction: Direction8.None, held: { B: true } },
    { direction: Direction8.None, held: { B: true } },
    { direction: Direction8.None, held: { B: true } },
    { direction: Direction8.Up, held: {} },
    { direction: Direction8.Up, held: {} },
    { direction: Direction8.Right, held: { Y: true } },
    { direction: Direction8.Right, held: {} },
    { direction: Direction8.Down, held: {} },
    { direction: Direction8.Down, held: {} },
    { direction: Direction8.DownLeft, held: { B: true } },
    { direction: Direction8.DownLeft, held: {} },
    { direction: Direction8.Left, held: { L: true } },
    { direction: Direction8.Left, held: { L: true } },
    { direction: Direction8.None, held: {} },
    { direction: Direction8.Up, held: { Y: true } },
    { direction: Direction8.None, held: {} },
  ];

  it('is deterministic across many ticks touching cursor/GK/tackle/kick mechanics', () => {
    let stateA = createInitialState(2026);
    let stateB = createInitialState(2026);

    for (const { direction, held } of sequence) {
      stateA = simulate(stateA, inputsWithButtons(direction, held));
      stateB = simulate(stateB, inputsWithButtons(direction, held));
    }

    expect(stateA).toEqual(stateB);
  });

  it('never mutates the previous-tick state object across the sequence', () => {
    let state = createInitialState(2026);
    for (const { direction, held } of sequence) {
      const snapshotBefore = JSON.parse(JSON.stringify(state));
      const next = simulate(state, inputsWithButtons(direction, held));
      expect(state).toEqual(snapshotBefore);
      state = next;
    }
  });

  it('keeps all 22 players within pitch bounds throughout the sequence', () => {
    let state = createInitialState(2026);
    for (const { direction, held } of sequence) {
      state = simulate(state, inputsWithButtons(direction, held));
    }
    for (const player of state.players) {
      expect(toFloat(player.pos.x)).toBeGreaterThanOrEqual(0);
      expect(toFloat(player.pos.y)).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps controlledPlayerIndex within the valid 0..21 range throughout the sequence', () => {
    let state = createInitialState(2026);
    for (const { direction, held } of sequence) {
      state = simulate(state, inputsWithButtons(direction, held));
      expect(state.controlledPlayerIndex).toBeGreaterThanOrEqual(0);
      expect(state.controlledPlayerIndex).toBeLessThan(22);
    }
  });
});

describe('simulate — Phase 3: match clock (half-swap + fulltime freeze)', () => {
  it('resets to a mirrored kickoff formation exactly at the half-1/half-2 boundary', () => {
    let state = createInitialState(1);
    for (let i = 0; i < HALF_DURATION_FRAMES; i++) {
      state = simulate(state, inputs(Direction8.None));
    }
    // このtickでちょうど半分の境界を跨いだはず
    expect(state.frame).toBe(HALF_DURATION_FRAMES);
    expect(controlled(state).facing).toBe(Direction8.Down); // Team A は後半 Down を向く
    for (const p of state.players) {
      if (p.team === 0) expect(p.facing).toBe(Direction8.Down);
      else expect(p.facing).toBe(Direction8.Up);
    }
    expect(toFloat(state.ball.pos.y)).toBeCloseTo(1800 * 0.5, 0);
    expect(state.lastTouchTeam).toBeNull();
  });

  it('does not reset before the boundary is actually reached', () => {
    let state = createInitialState(1);
    for (let i = 0; i < HALF_DURATION_FRAMES - 1; i++) {
      state = simulate(state, inputs(Direction8.None));
    }
    expect(state.frame).toBe(HALF_DURATION_FRAMES - 1);
    // 半分リセットが起きていれば全Team A選手がDownを向くはず。放置中のAI操作で個々の向きは
    // 変わり得るため、「全員が一斉にDownを向いている」状態(=リセット済み)にはなっていない
    // ことだけを頑健に確認する (個々の選手のfacingはカーソル自動追従で変わり得るため厳密比較しない)。
    const allTeamAFaceDown = state.players.filter((p) => p.team === 0).every((p) => p.facing === Direction8.Down);
    expect(allTeamAFaceDown).toBe(false);
  });

  it('freezes gameplay at fulltime (players/ball/score stop changing, frame keeps counting)', () => {
    let state = createInitialState(1);
    for (let i = 0; i < FULL_MATCH_DURATION_FRAMES; i++) {
      state = simulate(state, inputs(Direction8.Up));
    }
    expect(state.frame).toBe(FULL_MATCH_DURATION_FRAMES);
    const playersSnapshot = JSON.parse(JSON.stringify(state.players));
    const ballSnapshot = JSON.parse(JSON.stringify(state.ball));
    const next = simulate(state, inputs(Direction8.Up));
    expect(next.frame).toBe(FULL_MATCH_DURATION_FRAMES + 1);
    expect(next.players).toEqual(playersSnapshot);
    expect(next.ball).toEqual(ballSnapshot);
    expect(next.score).toEqual(state.score);
  });

  it('updates lastTouchTeam when the controlled player dribbles into the ball', () => {
    const state = createInitialState(1);
    expect(state.lastTouchTeam).toBeNull();
    // 操作選手をボールのすぐ近くに置いて移動させ、ドリブルタッチを発生させる
    const idx = state.controlledPlayerIndex;
    const near = {
      ...state,
      players: state.players.map((p, i) =>
        i === idx ? { ...p, pos: { x: state.ball.pos.x, y: toFixed(toFloat(state.ball.pos.y) + 5) } } : p,
      ),
    };
    const next = simulate(near, inputs(Direction8.Up));
    expect(next.lastTouchTeam).toBe(near.players[idx]?.team);
  });
});

/** テスト用: ボールの位置/速度/高さだけを差し替えた GameState を作る (境界越えシナリオ用)。 */
function withBall(
  seed: number,
  ballPos: { x: number; y: number },
  ballVel: { x: number; y: number },
  height = 0,
): GameState {
  const base = createInitialState(seed);
  return {
    ...base,
    ball: {
      pos: { x: toFixed(ballPos.x), y: toFixed(ballPos.y) },
      vel: { x: toFixed(ballVel.x), y: toFixed(ballVel.y) },
      height: toFixed(height),
      zVel: ZERO_FIXED,
    },
  };
}

describe('simulate — Phase 3: boundary detection (goals, throw-in/goal-kick/corner restarts, milestones 3-4)', () => {
  it('scores a goal for Team A, resets to kickoff, and clears lastTouchTeam (half 1: Team A attacks the north/y=0 line)', () => {
    // ボール中心をゴール中央、クロスバー以下の高さで、北ライン(y=0)を割る速度で置く。
    const state = withBall(1, { x: 240, y: 3 }, { x: 0, y: -10 }, 0);
    const next = simulate(state, inputs(Direction8.None));
    expect(next.score).toEqual([1, 0]);
    expect(next.lastTouchTeam).toBeNull();
    // キックオフ配置へリセットされ、ボールはピッチ中央付近に戻る
    expect(toFloat(next.ball.pos.y)).toBeCloseTo(PITCH_HEIGHT * 0.5, 0);
    expect(next.ball.vel.x).toBe(ZERO_FIXED);
    expect(next.ball.vel.y).toBe(ZERO_FIXED);
  });

  it('scores a goal for Team B when the ball crosses the south/y=PITCH_HEIGHT line (half 1: Team B attacks south)', () => {
    const state = withBall(1, { x: 240, y: PITCH_HEIGHT - 3 }, { x: 0, y: 10 }, 0);
    const next = simulate(state, inputs(Direction8.None));
    expect(next.score).toEqual([0, 1]);
  });

  it('does NOT score when the ball crosses the goal line above crossbar height', () => {
    const state = withBall(1, { x: 240, y: 3 }, { x: 0, y: -10 }, 50); // 高い弾道、クロスバーを大きく超える
    const next = simulate(state, inputs(Direction8.None));
    expect(next.score).toEqual([0, 0]);
  });

  it('awards a goal kick (no score change) when the ball goes out wide of the goal, last touched by the attacker', () => {
    // Team A (attacker for the north goal) が最後に触れた状態で、ゴール幅の外に出す。
    const base = withBall(1, { x: 20, y: 3 }, { x: 0, y: -10 }, 0);
    const state = { ...base, lastTouchTeam: TeamId.A };
    const next = simulate(state, inputs(Direction8.None));
    expect(next.score).toEqual([0, 0]);
    // リスタートのボールは再開チーム(ゴールキック=守備側B)に帰属する
    // (観戦シミュレーターで発覚したリスタート・キャンプ問題の修正で null → restartTeam に変更)
    expect(next.lastTouchTeam).toBe(TeamId.B);
    expect(toFloat(next.ball.vel.x)).toBe(0);
    expect(toFloat(next.ball.vel.y)).toBe(0);
  });

  it('teleports the ball out-of-bounds on the sideline to a throw-in position and keeps the match running (no score, no half reset)', () => {
    const base = withBall(1, { x: -2, y: 900 }, { x: -10, y: 0 }, 0);
    const state = { ...base, lastTouchTeam: TeamId.A };
    const next = simulate(state, inputs(Direction8.None));
    expect(next.score).toEqual([0, 0]);
    expect(toFloat(next.ball.pos.x)).toBeGreaterThan(0);
    expect(toFloat(next.ball.pos.x)).toBeLessThan(50);
    expect(next.ball.vel.x).toBe(ZERO_FIXED);
    // 選手移動処理はそのまま続く (試合停止の演出は無い): frameは通常通り+1される
    expect(next.frame).toBe(state.frame + 1);
  });

  it('is deterministic across a sequence that scores a goal', () => {
    let stateA = withBall(7, { x: 240, y: 3 }, { x: 0, y: -10 }, 0);
    let stateB = withBall(7, { x: 240, y: 3 }, { x: 0, y: -10 }, 0);
    for (let i = 0; i < 5; i++) {
      stateA = simulate(stateA, inputs(Direction8.Up));
      stateB = simulate(stateB, inputs(Direction8.Up));
    }
    expect(stateA).toEqual(stateB);
  });
});

/** テスト用: 操作選手/オフサイド対象選手/ボールの位置だけを差し替えた GameState を作る。 */
function withOffsideSetup(seed: number, offsideEnabled: boolean): GameState {
  const base = createInitialState(seed, { offsideEnabled });
  const kickerIdx = base.controlledPlayerIndex; // Team A
  const offsideIdx = 1; // Team A の別の選手 (DFスロット) を、この場面限りの攻撃選手に見立てる
  return {
    ...base,
    players: base.players.map((p, i) => {
      if (i === kickerIdx) return { ...p, pos: { x: toFixed(100), y: toFixed(500) } };
      if (i === offsideIdx) return { ...p, pos: { x: toFixed(200), y: toFixed(50) } }; // 相手陣内、DFラインより前
      return p;
    }),
    ball: { ...base.ball, pos: { x: toFixed(100), y: toFixed(505) } },
  };
}

describe('simulate — Phase 3: offside rule (milestone 5)', () => {
  it('blocks a charge-kick release when a teammate is offside, awarding an indirect free kick to the opponent', () => {
    let state = withOffsideSetup(1, true);
    const offsideIdx = 1;

    state = simulate(state, inputsWithButtons(Direction8.None, { B: true })); // キック溜め開始
    expect(controlled(state).kickChargeFrames).toBeGreaterThan(0);

    const offsidePlayerBeforeRelease = state.players[offsideIdx];
    const next = simulate(state, inputsWithButtons(Direction8.Right, {})); // 解放 -> オフサイド判定

    expect(controlled(next).kickChargeFrames).toBe(0);
    expect(toFloat(next.ball.vel.x)).toBe(0);
    expect(toFloat(next.ball.vel.y)).toBe(0);
    expect(toFloat(next.ball.zVel)).toBe(0);
    expect(next.ball.pos).toEqual(offsidePlayerBeforeRelease?.pos);
    expect(next.lastTouchTeam).toBe(TeamId.B);
  });

  it('does not check offside when offsideEnabled is false: the kick fires normally', () => {
    let state = withOffsideSetup(1, false);

    state = simulate(state, inputsWithButtons(Direction8.None, { B: true }));
    const next = simulate(state, inputsWithButtons(Direction8.Right, {}));

    const ballMoved =
      toFloat(next.ball.vel.x) !== 0 || toFloat(next.ball.vel.y) !== 0 || toFloat(next.ball.zVel) !== 0;
    expect(ballMoved).toBe(true);
  });
});

/** テスト用: Team B の1選手をボール保持者として、相手ゴール(y=PITCH_HEIGHT側)のすぐ手前に置く。 */
function withCpuCarrier(
  seed: number,
  difficulty: 'easy' | 'medium' | 'hard',
  offsideEnabled: boolean,
): GameState {
  const base = createInitialState(seed, { difficulty, offsideEnabled });
  const carrierIdx = TeamId.B * 11 + 9; // Team B の FW スロット
  return {
    ...base,
    players: base.players.map((p, i) =>
      i === carrierIdx ? { ...p, pos: { x: toFixed(240), y: toFixed(1750) } } : p,
    ),
    ball: { ...base.ball, pos: { x: toFixed(240), y: toFixed(1755) } },
    // 流れの中のプレー(Team Bが相手ゴール前でボール保持)の再現なので、
    // createInitialState が張るキックオフの再開ロックは外す
    // (ロック中は touch-priority が Team A に制限され、Team B は触れられない)。
    setPieceLock: null,
  };
}

describe('simulate — Phase 3: CPU (Team B) attack AI (milestone 6)', () => {
  it('shoots without any human input when the Team B carrier is close to the opponent goal', () => {
    const state = withCpuCarrier(1, 'hard', false);
    const next = simulate(state, inputs(Direction8.None));
    const ballMoved =
      toFloat(next.ball.vel.x) !== 0 || toFloat(next.ball.vel.y) !== 0 || toFloat(next.ball.zVel) !== 0;
    expect(ballMoved).toBe(true);
    expect(next.lastTouchTeam).toBe(TeamId.B);
  });

  it('is deterministic across a sequence where Team B carries and shoots (including RNG-consuming aim noise)', () => {
    let stateA = withCpuCarrier(1, 'easy', false);
    let stateB = withCpuCarrier(1, 'easy', false);
    for (let i = 0; i < 3; i++) {
      stateA = simulate(stateA, inputs(Direction8.None));
      stateB = simulate(stateB, inputs(Direction8.None));
    }
    expect(stateA).toEqual(stateB);
  });

  it('threads RNG consumption from a CPU shot aim-noise draw into the returned rngState', () => {
    const state = withCpuCarrier(1, 'easy', false);
    const next = simulate(state, inputs(Direction8.None));
    expect(next.rngState).not.toBe(state.rngState);
  });

  it('offside also blocks a CPU shot, awarding the restart to Team A', () => {
    const base = withCpuCarrier(1, 'hard', true);
    const advancedTeammateIdx = TeamId.B * 11 + 1; // 別のTeam B選手をオフサイドポジションに置く
    const state: GameState = {
      ...base,
      players: base.players.map((p, i) =>
        // ゴールライン判定のしきい値(ボール半径7px)より確実に手前に置く
        // (オフサイドリスタート位置=この選手の位置が、そのまま境界越え判定に引っかからないようにする)。
        i === advancedTeammateIdx ? { ...p, pos: { x: toFixed(240), y: toFixed(1780) } } : p,
      ),
    };
    const next = simulate(state, inputs(Direction8.None));
    expect(next.lastTouchTeam).toBe(TeamId.A);
  });
});

describe('simulate — bug regression: non-controlled AI actually chases the ball through the full pipeline (found via manual playtest, not caught by isolated unit tests)', () => {
  // ユニットテスト(teamAI.test.ts)ではcomputeNonControlledDirection単体の出力を確認できても、
  // 「実際にsimulate()を何tickも回した結果、選手が本当にボールへ近づくか」という統合的な
  // 挙動までは検証できていなかった。ホームの復元力が距離によらず常にフル強度だった旧実装は、
  // 単体のcomputeNonControlledDirectionの出力自体は「もっともらしい」方向を返すため単体テストは
  // 通過してしまうが、simulate()を連続で回すと選手がホーム位置のすぐ外側で往復するだけで
  // 実質的に凍結し、何十tick経ってもボールに近づけない、という統合レベルでのみ顕在化する
  // バグだった (実際のブラウザプレイで発見)。同じ穴を二度掘らないよう、multi-tick統合テストとして
  // 明示的に固定する。
  it('a Team B outfield player left alone near a stationary ball gets meaningfully closer to it over 300 ticks', () => {
    const seed = 1;
    let state = createInitialState(seed);
    const defenderIdx = TeamId.B * 11 + 4; // Team Bのある非操作フィールドプレイヤー
    const defender = state.players[defenderIdx]!;
    // ボールを、その選手のホーム位置から少し離れた場所に静止させる (試合中によくある配置)。
    const ballPos = { x: toFixed(toFloat(defender.pos.x) + 60), y: defender.pos.y };
    state = { ...state, ball: { ...state.ball, pos: ballPos } };

    const initialDistSq = distSqFixed(defender.pos, state.ball.pos) as number;
    let minDistSq = initialDistSq;

    for (let i = 0; i < 300; i++) {
      state = simulate(state, inputs(Direction8.None));
      const distSq = distSqFixed(state.players[defenderIdx]!.pos, state.ball.pos) as number;
      if (distSq < minDistSq) minDistSq = distSq;
    }

    // 「最終tickでの距離」ではなく「300tickの間に到達した最小距離」で判定する:
    // 一度ボールに追いつくとドリブルで運び始め、その後は選手とボールの距離が再び
    // 変動する(=近づいたり離れたりする)のは正常な挙動なので、単調減少や最終値の
    // 小ささでは判定できない。旧実装ではホームのdeadzone境界付近で凍結し、
    // 300tick経っても最小距離すら縮まらなかった(実測: 60px -> 最小54pxで頭打ち)。
    // 修正後は明確に接近(ドリブルタッチ半径20px程度まで)できるはず。
    expect(minDistSq).toBeLessThan(initialDistSq * 0.3);
  });

  it('over a long stretch of real kickoff play with no human input, Team B eventually touches the ball at least once', () => {
    let state = createInitialState(1, { difficulty: 'medium' });
    // まずキックオフを蹴る (競技規則 第8条の実装後は、蹴るまでボールはインプレーにならず
    // キッカーが足元に置いたまま。「蹴った後にAIが本当にボールを追うか」がこのテストの主題)。
    state = simulate(state, inputsWithButtons(Direction8.Up, { B: true }));
    state = simulate(state, inputsWithButtons(Direction8.Up, { B: true }));
    state = simulate(state, inputs(Direction8.Up));
    let teamBEverTouched = false;
    for (let i = 0; i < 3000; i++) {
      state = simulate(state, inputs(Direction8.None));
      if (state.lastTouchTeam === TeamId.B) {
        teamBEverTouched = true;
        break;
      }
    }
    // 旧実装ではTeam Bの誰もホームからほぼ動けず、3000tick(50秒)経ってもTeam Bが一度も
    // ボールに触れなかった (人間側も無操作なのでボールはキックオフ位置に静止したまま)。
    expect(teamBEverTouched).toBe(true);
  });
});

/**
 * テスト用: Team Bの選手1人を指定Yにボール保持者として置き、Team Aのフィールドプレイヤー
 * (GK以外)を左右のサイドライン際まで大きく退避させる。「守備の薄いオープンな状況」
 * (カウンターアタック・数的優位のブレイクアウェイ)を模した、統合テスト用の意図的な設定。
 *
 * なぜこの設定が必要か: 無改造の22人フルキックオフ+完全無操作という設定では、
 * Team A自身の非操作選手(GK以外)も同じball-attraction AIでボールに寄ってくるため、
 * いずれかがボールに触れて touch-priority を得ると resolveCursor の設計上ただちに
 * 人間の操作対象がその選手へスナップされる。そのtickの人間入力が(このテストのように)
 * 常にNoneであれば、その選手は「操作対象だが入力が無い」まま静止し続け、ボールも
 * 静止したまま止まってしまう。これは既存の(Phase 2で承認済みの)カーソル自動追従の
 * 設計と「人間側の入力が本当に一度も無い」という統合テスト特有の状況が組み合わさって
 * 起きる別種の現象であり、今回のチームライン押し上げ/引き下げ修正の対象ではないため、
 * ここでは「Team Aの守備が及ばない状況」を明示的に作ることでこの現象を回避し、
 * 修正対象そのもの(チーム全体の押し上げ+ボール保持者の自由な前進)を検証する。
 */
function withOpenCounterAttack(carrierStartY: number): GameState {
  const state = createInitialState(1, { difficulty: 'hard' });
  const carrierIdx = TeamId.B * 11 + 9; // Team B FW
  return {
    ...state,
    players: state.players.map((p, i) => {
      if (i === carrierIdx) return { ...p, pos: { x: toFixed(240), y: toFixed(carrierStartY) } };
      if (p.team === TeamId.A && !p.isGoalkeeper) {
        return { ...p, pos: { x: toFixed(p.slotIndex % 2 === 0 ? 20 : 460), y: p.pos.y } };
      }
      return p;
    }),
    ball: { ...state.ball, pos: { x: toFixed(240), y: toFixed(carrierStartY + 5) } },
    lastTouchTeam: TeamId.B,
  };
}

describe('simulate — Phase 3: team line push/retreat fixes "Team B doesn\'t attack past halfway" (bug fix, integration)', () => {
  it('Team B commits forward as a team and advances substantially into the attacking third when given room to run', () => {
    let state = withOpenCounterAttack(1300); // 自陣寄り(500px先がゴール)からスタート
    const startY = toFloat(state.ball.pos.y);
    let maxBallY = startY;
    let scored = false;
    // テンポ変更追従: 選手速度1/5.7・キック飛距離1/2.7のため、同じ150pxの前進に必要な
    // 時間を runTicks で引き伸ばす (実測: 150px前進は291tick時点)。
    for (let i = 0; i < runTicks(150); i++) {
      state = simulate(state, inputs(Direction8.None));
      const y = toFloat(state.ball.pos.y);
      if (y > maxBallY) maxBallY = y;
      if (state.score[1] > 0) {
        scored = true;
        break;
      }
    }
    // 旧実装(チームライン押し上げ無し)ではボールがハーフウェー付近で頭打ちになり、
    // ホームポジション固定のためチーム全体が追随できなかった。修正後は明確に前進する。
    // CPUのシュート射程が現実化(200px)されてからは、この150tick内に得点まで到達することも
    // あるため、「得点した」も成功として扱う (得点後はキックオフに戻りボールYが巻き戻るので
    // 最終位置ではなく最大到達点で判定する)。
    expect(scored || maxBallY - startY > 150).toBe(true);
  });

  it('Team B reaches the penalty box and scores from a realistic attacking-third position, with no human input (regression for both the team-line-push fix and the goal-line dead-zone bug)', () => {
    let state = withOpenCounterAttack(1550); // ゴールまで250px、攻撃サードからのブレイクアウェイ
    let scored = false;
    // テンポ変更追従: 実測で得点は1869tick時点 (旧テンポの約6倍遅い) のため、
    // 監視窓を runTicks(450)=2571tick に延長する。
    // サイクル②追従: 得点前にBのシュートが外れると Team A のゴールキックになるが、
    // 無入力の人間(A)は蹴らず SET_PIECE_LOCK_MAX_TICKS(1030) の安全網でしか解除されない。
    // この停滞は本テストの検証対象 (Bの攻撃能力) ではないため、停滞2回ぶんを窓に足す。
    for (let i = 0; i < runTicks(450) + SET_PIECE_LOCK_MAX_TICKS * 2; i++) {
      state = simulate(state, inputs(Direction8.None));
      if (state.score[1] > 0) {
        scored = true;
        break;
      }
    }
    expect(scored).toBe(true);
  });

  it('is deterministic across the scoring sequence', () => {
    let stateA = withOpenCounterAttack(1550);
    let stateB = withOpenCounterAttack(1550);
    for (let i = 0; i < 200; i++) {
      stateA = simulate(stateA, inputs(Direction8.None));
      stateB = simulate(stateB, inputs(Direction8.None));
    }
    expect(stateA).toEqual(stateB);
  });
});

describe('simulate — 続編仕様④: ライン操作 (STARTボタン)', () => {
  // touch-priority(ドリブル半径20px以内)が誰にも発生しないよう、ボールを全選手から
  // 離れたピッチ隅に置く。これでpossessionTeamはstate.lastTouchTeamにフォールバックし、
  // linePossessionTeamのヒステリシス(90tick)を待たずに文脈を確定できる。
  function stateWithPossession(team: TeamId): GameState {
    const base = createInitialState(1, { difficulty: 'easy' });
    return {
      ...base,
      ball: { ...base.ball, pos: { x: toFixed(10), y: toFixed(10) } },
      lastTouchTeam: team,
      linePossessionTeam: team,
      linePossessionSwitchTicks: 0,
    };
  }

  it('Team Aが攻撃中にSTARTを押し続けるとmanualLineOffsetが負方向(オフェンスラインを下げる)へ変化する', () => {
    let state = stateWithPossession(TeamId.A);
    state = simulate(state, inputsWithButtons(Direction8.None, { Start: true }));
    expect(toFloat(state.manualLineOffset)).toBeLessThan(0);
  });

  it('Team Aが守備中にSTARTを押し続けるとmanualLineOffsetが正方向(ディフェンスラインを上げる)へ変化する', () => {
    let state = stateWithPossession(TeamId.B);
    state = simulate(state, inputsWithButtons(Direction8.None, { Start: true }));
    expect(toFloat(state.manualLineOffset)).toBeGreaterThan(0);
  });

  it('STARTを離すとゆっくり中立(0)へ減衰する', () => {
    let state = stateWithPossession(TeamId.B);
    for (let i = 0; i < 10; i++) {
      state = simulate(state, inputsWithButtons(Direction8.None, { Start: true }));
    }
    const peak = state.manualLineOffset as number;
    expect(peak).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) {
      state = simulate(state, inputs(Direction8.None));
    }
    expect(state.manualLineOffset as number).toBeLessThan(peak);
  });

  it('MANUAL_LINE_OFFSET_MAX_FIXEDでクランプされる(押し続けても際限なく増えない)', () => {
    let state = stateWithPossession(TeamId.B);
    // テンポ変更追従: STEP が RUN_TEMPO 倍 (0.525px/tick) になったため、上限へ届く
    // tick数を定数から導出する (150px ÷ 0.525 ≈ 287tick)。
    const ticksToMax =
      Math.ceil((MANUAL_LINE_OFFSET_MAX_FIXED as number) / (MANUAL_LINE_OFFSET_STEP_FIXED as number)) + 10;
    for (let i = 0; i < ticksToMax; i++) {
      state = simulate(state, inputsWithButtons(Direction8.None, { Start: true }));
    }
    expect(state.manualLineOffset).toBe(MANUAL_LINE_OFFSET_MAX_FIXED);
  });

  it('possessionTeamが不明(null)な間はSTARTを押していても変化しない', () => {
    const base = createInitialState(1, { difficulty: 'easy' });
    let state: GameState = {
      ...base,
      ball: { ...base.ball, pos: { x: toFixed(10), y: toFixed(10) } },
      lastTouchTeam: null,
      linePossessionTeam: null,
      linePossessionSwitchTicks: 0,
    };
    state = simulate(state, inputsWithButtons(Direction8.None, { Start: true }));
    expect(state.manualLineOffset).toBe(ZERO_FIXED);
  });
});

describe('simulate — 続編仕様⑤: ワンツー', () => {
  const RECEIVER = TeamId.A * 11 + 1; // Team A DF1
  const TEAMMATE = TeamId.A * 11 + 2; // Team A DF2、Yのパス先候補 (真右、射程内)

  function baseReceivingState(): GameState {
    const base = createInitialState(1, { difficulty: 'easy', offsideEnabled: false });
    const ballPos = { x: toFixed(200), y: toFixed(900) };
    return {
      ...base,
      ball: { ...base.ball, pos: ballPos, vel: { x: ZERO_FIXED, y: ZERO_FIXED } },
      players: base.players.map((p, i) => {
        if (i === RECEIVER) return { ...p, pos: ballPos, facing: Direction8.Right };
        if (i === TEAMMATE) return { ...p, pos: { x: toFixed(260), y: toFixed(900) } };
        return p;
      }),
      // 直前の保持者は別人 (=このtickで新たに受け取ったことにする、ワンツー発火の前提)。
      lastTouchPlayerIndex: TEAMMATE,
      lastTouchTeam: TeamId.A,
    };
  }

  it('A held at the moment of reception passes immediately in the +字 direction, bypassing the charge/dribble step', () => {
    const state = baseReceivingState();
    const next = simulate(state, { direction: Direction8.Right, buttons: { ...emptyButtonState(), A: true } });
    expect(toFloat(next.ball.vel.x)).toBeGreaterThan(0); // +字=Right方向へ即座に蹴られている
    expect(next.lastTouchTeam).toBe(TeamId.A);
    expect(next.players[RECEIVER]!.kickChargeFrames).toBe(0); // チャージには入っていない
  });

  it('Y held at the moment of reception passes immediately toward the pass-cursor target', () => {
    const state = baseReceivingState();
    const next = simulate(state, { direction: Direction8.None, buttons: { ...emptyButtonState(), Y: true } });
    expect(toFloat(next.ball.vel.x)).toBeGreaterThan(0); // TEAMMATEは受け手から見て右方向
  });

  it('does nothing extra when neither A nor Y is held at reception (falls through to a normal dribble touch)', () => {
    const state = baseReceivingState();
    const next = simulate(state, { direction: Direction8.Right, buttons: emptyButtonState() });
    // 通常のドリブルタッチ速度であり、ワンツーのキック速度(STRONG_KICK_SPEED)ではない。
    expect(toFloat(next.ball.vel.x)).toBeLessThan(toFloat(STRONG_KICK_SPEED_FIXED));
  });

  it('does not re-fire on a later tick: holding A while already carrying (not freshly received) behaves normally', () => {
    let state = baseReceivingState();
    // 1tick目: 入力なしで受け取る (ワンツー不発、通常のドリブルタッチで保持継続)。
    state = simulate(state, inputs(Direction8.None));
    expect(state.lastTouchPlayerIndex).toBe(RECEIVER);
    // 2tick目: 同じ選手がAを押すが、「受けた瞬間」ではないので既存のA挙動(未実装、無視)になる
    // だけで、ワンツーのパス速度(STRONG_KICK_SPEED)では飛ばない。
    const next = simulate(state, { direction: Direction8.Right, buttons: { ...emptyButtonState(), A: true } });
    expect(toFloat(next.ball.vel.x)).toBeLessThan(toFloat(STRONG_KICK_SPEED_FIXED));
  });
});

describe('simulate — 続編仕様⑥: リフティング', () => {
  const CARRIER = TeamId.A * 11 + 9;

  function baseCarryingState(facing: Direction8, ballHeight = 0): GameState {
    const base = createInitialState(1, { difficulty: 'easy', offsideEnabled: false });
    const pos = { x: toFixed(240), y: toFixed(900) };
    return {
      ...base,
      controlledPlayerIndex: CARRIER,
      ball: { ...base.ball, pos, vel: { x: ZERO_FIXED, y: ZERO_FIXED }, height: toFixed(ballHeight), zVel: ZERO_FIXED },
      players: base.players.map((p, i) => (i === CARRIER ? { ...p, pos, facing } : p)),
    };
  }

  it('reversing direction + a fresh B press while carrying pops the ball up, without starting a charge', () => {
    const state = baseCarryingState(Direction8.Up);
    const next = simulate(state, { direction: Direction8.Down, buttons: { ...emptyButtonState(), B: true } });
    expect(toFloat(next.ball.zVel)).toBeGreaterThan(0);
    expect(next.players[CARRIER]!.kickChargeFrames).toBe(0);
  });

  it('does not fire without a direction reversal (same direction as facing + B starts a normal charge instead)', () => {
    const state = baseCarryingState(Direction8.Up);
    const next = simulate(state, { direction: Direction8.Up, buttons: { ...emptyButtonState(), B: true } });
    expect(next.ball.zVel).toBe(ZERO_FIXED);
    expect(next.players[CARRIER]!.kickChargeFrames).toBeGreaterThan(0);
  });

  it('does not fire on a held B (not a fresh edge), even with a reversal — normal charge continues', () => {
    let state = baseCarryingState(Direction8.Up);
    state = simulate(state, { direction: Direction8.Up, buttons: { ...emptyButtonState(), B: true } });
    const chargedFrames = state.players[CARRIER]!.kickChargeFrames;
    expect(chargedFrames).toBeGreaterThan(0);

    const next = simulate(state, { direction: Direction8.Down, buttons: { ...emptyButtonState(), B: true } });
    expect(next.ball.zVel).toBe(ZERO_FIXED);
    expect(next.players[CARRIER]!.kickChargeFrames).toBeGreaterThan(chargedFrames);
  });

  it('does not fire while the ball is already well above the ground (a normal charge proceeds instead)', () => {
    const state = baseCarryingState(Direction8.Up, 20);
    const next = simulate(state, { direction: Direction8.Down, buttons: { ...emptyButtonState(), B: true } });
    expect(next.players[CARRIER]!.kickChargeFrames).toBeGreaterThan(0);
  });
});

describe('simulate — bug regression: a decelerating rolling shot must still be able to cross the goal line (goal-line dead-zone bug)', () => {
  // 発見の経緯: ボールが減速しながらゴールラインに近づく実際の物理挙動で、
  // clampToPitchBounds のクランプ境界(ライン手前ボール半径ぶん)と
  // detectBoundaryEvent の判定しきい値(旧実装ではライン ちょうど)がズレていたため、
  // 残り速度がボール半径未満まで減速した時点でクランプに押し戻され続け、
  // 二度とラインちょうどまで到達できずゴール判定が永久に発火しない「詰み」状態があった。
  it('a shot that decelerates to a near-stop right at the goal line still registers as a goal', () => {
    // このテストの主題は「クランプ境界と判定しきい値のズレでゴール判定が永久に発火しない」
    // 詰みバグの回帰。CPUの照準や物理定数に左右されないよう、狙った状況
    // (ほぼ止まりかけのボールがゴールライン直前にある) を直接組み立てる。
    // 全選手をゴールから遠ざけ、GKのセーブや味方の接触が混ざらないようにする。
    const base = createInitialState(1, { difficulty: 'hard' });
    let state: GameState = {
      ...base,
      players: base.players.map((p) => ({
        ...p,
        pos: { x: toFixed(20 + (p.slotIndex % 4) * 25), y: toFixed(p.team === TeamId.A ? 300 : 200) },
      })),
      ball: {
        ...base.ball,
        pos: { x: toFixed(240), y: toFixed(1790) }, // 南=Team Aの自陣ゴールライン(1800)直前
        vel: { x: ZERO_FIXED, y: toFixed(0.6) }, // 減速しきる寸前の遅さ
      },
      lastTouchTeam: TeamId.B,
    };
    let scored = false;
    for (let i = 0; i < 40 && !scored; i++) {
      state = simulate(state, inputs(Direction8.None));
      if (state.score[1] > 0) scored = true;
    }
    expect(scored, '減速したボールがゴールライン手前で止まり、ゴール判定が発火しない (詰みバグの再発)').toBe(true);
  });
});

describe('simulate — Phase 3: full-match smoke test (milestone 9, determinism/perf hardening)', () => {
  // 前後半切替(HALF_DURATION_FRAMES境界)を1回跨ぐぶんの長さを、様々な方向/ボタンの組み合わせを
  // 周期的に繰り返す入力列で回す。ゴール・境界越え・オフサイド・CPU攻撃AIのどれかが自然に
  // 発生してもおかしくない状況を作り、個々のマイルストーンのテストでは踏まない「複数の
  // マイルストーンが同一tickで絡み合う」パターンを実際に踏んで確認する狙い。
  const CYCLE: Array<{ direction: Direction8; held: Partial<Record<LogicalButton, boolean>> }> = [
    { direction: Direction8.Up, held: {} },
    { direction: Direction8.UpRight, held: { L: true } },
    { direction: Direction8.Right, held: {} },
    { direction: Direction8.None, held: { B: true } },
    { direction: Direction8.None, held: { B: true } },
    { direction: Direction8.DownRight, held: {} },
    { direction: Direction8.Down, held: { Y: true } },
    { direction: Direction8.DownLeft, held: {} },
    { direction: Direction8.Left, held: { L: true } },
    { direction: Direction8.UpLeft, held: {} },
    { direction: Direction8.None, held: {} },
    { direction: Direction8.Up, held: { B: true } },
  ];
  const TICKS = HALF_DURATION_FRAMES + 500; // 前後半切替を1回確実に跨ぐ

  function runMatch(seed: number): GameState {
    let state = createInitialState(seed, { difficulty: 'easy', offsideEnabled: true });
    for (let i = 0; i < TICKS; i++) {
      const step = CYCLE[i % CYCLE.length];
      if (!step) continue;
      state = simulate(state, inputsWithButtons(step.direction, step.held));
    }
    return state;
  }

  it(
    'never throws and keeps all invariants over a match spanning a half-swap',
    () => {
      let state = createInitialState(1, { difficulty: 'easy', offsideEnabled: true });
      for (let i = 0; i < TICKS; i++) {
        const step = CYCLE[i % CYCLE.length];
        if (!step) continue;
        state = simulate(state, inputsWithButtons(step.direction, step.held));

        expect(state.players).toHaveLength(22);
        expect(state.controlledPlayerIndex).toBeGreaterThanOrEqual(0);
        expect(state.controlledPlayerIndex).toBeLessThan(11); // 常にTeam A
        expect(state.score[0]).toBeGreaterThanOrEqual(0);
        expect(state.score[1]).toBeGreaterThanOrEqual(0);
        expect(toFloat(state.ball.pos.x)).toBeGreaterThanOrEqual(0);
        expect(toFloat(state.ball.pos.x)).toBeLessThanOrEqual(PITCH_WIDTH);
        expect(toFloat(state.ball.pos.y)).toBeGreaterThanOrEqual(0);
        expect(toFloat(state.ball.pos.y)).toBeLessThanOrEqual(PITCH_HEIGHT);
        for (const player of state.players) {
          expect(toFloat(player.pos.x)).toBeGreaterThanOrEqual(0);
          expect(toFloat(player.pos.y)).toBeGreaterThanOrEqual(0);
        }
      }
    },
    // 毎tick複数のexpectを11300tickぶん行う重いテスト。カーソル固定バグの修正で
    // 切替判定が以前より活発になり、既定の5000msに対して余裕が無くなったため明示的に延長する。
    15000,
  );

  it('is fully deterministic end-to-end across a match spanning a half-swap (same seed -> identical final state)', () => {
    const stateA = runMatch(2026);
    const stateB = runMatch(2026);
    expect(stateA).toEqual(stateB);
  });

  it('completes within a reasonable time budget (perf sanity, not a strict benchmark)', () => {
    const startedAt = performance.now();
    runMatch(1);
    const elapsedMs = performance.now() - startedAt;
    // simulate()は整数演算のみの軽量な純関数のはず。1万tick強が数百msを大幅に超えるようなら
    // どこかに意図しない重い処理(配列の毎tick再生成の多重化等)が紛れ込んだ可能性が高い。
    expect(elapsedMs).toBeLessThan(5000);
  });
});
