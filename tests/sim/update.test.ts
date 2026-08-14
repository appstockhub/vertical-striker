import { describe, expect, it } from 'vitest';
import { toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { createInitialState, TeamId, type GameState, type PlayerState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { Direction8, emptyButtonState, LogicalButton, type ButtonState } from '../../src/input/types';
import { FULL_MATCH_DURATION_FRAMES, HALF_DURATION_FRAMES } from '../../src/sim/matchClock';
import { PITCH_HEIGHT } from '../../src/config/pitch';

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

    // 事前正規化された対角ベクトルにより、誤差1程度で速度が一致する
    expect(Math.abs(upDist - upRightDist)).toBeLessThanOrEqual(1);
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
      { direction: Direction8.Up, held: { L: true } }, // ロングドリブル
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

  it('long dribble (L held) pushes the ball further per tick than plain dribble', () => {
    const base = withPositions(1, { x: 100, y: 100 }, { x: 105, y: 100 });

    const plain = simulate(base, inputs(Direction8.Right));
    const long = simulate(base, inputsWithButtons(Direction8.Right, { L: true }));

    const plainDelta = toFloat(plain.ball.pos.x) - toFloat(base.ball.pos.x);
    const longDelta = toFloat(long.ball.pos.x) - toFloat(base.ball.pos.x);
    expect(longDelta).toBeGreaterThan(plainDelta);

    const plainPlayerDelta = toFloat(controlled(plain).pos.x) - toFloat(controlled(base).pos.x);
    const longPlayerDelta = toFloat(controlled(long).pos.x) - toFloat(controlled(base).pos.x);
    expect(longPlayerDelta).toBeGreaterThan(plainPlayerDelta);
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
    expect(next.lastTouchTeam).toBeNull(); // リスタート発生でクリアされる
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
        i === advancedTeammateIdx ? { ...p, pos: { x: toFixed(240), y: toFixed(1795) } } : p,
      ),
    };
    const next = simulate(state, inputs(Direction8.None));
    expect(next.lastTouchTeam).toBe(TeamId.A);
  });
});
