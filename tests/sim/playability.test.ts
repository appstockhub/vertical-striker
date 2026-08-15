import { describe, expect, it } from 'vitest';
import { distSqFixed, toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { Direction8, emptyButtonState, type ButtonState } from '../../src/input/types';
import { createInitialState, TeamId, type GameState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { findTouchPriorityPlayer } from '../../src/sim/ballTouch';
import { STRONG_KICK_SPEED_FIXED, WEAK_KICK_SPEED_FIXED } from '../../src/sim/ballConstants';

/**
 * ★プレイアビリティ・ゲート★
 *
 * 存在理由 (重要、消さないこと): 12周目までのテストは「関数単位のユニットテスト」と
 * 「観戦シミュレーターの統計指標(団子度・振動・支配率等)」の2種類しかなかった。
 * どちらも全部greenのまま、実プレイでは
 *   「キックが反応しない」「スライディングもチャージもない」「キーパーがキャッチしない」
 *   「ゴールキックがアホな動きをする」
 * という致命的な状態だった。統計指標は「AIが破綻していないか」しか見ておらず、
 * **人間がボタンを押した時にゲームが応答するか**を一度も検証していなかったのが原因。
 *
 * このファイルはその欠落を埋める。各テストは「プレイヤーがこう操作したら、こう応答する
 * べき」を状況ごとに直接検証する。統計ではなく**因果**を見る。ここが赤いなら、
 * 他のテストが何件greenでもゲームは壊れていると判断すること。
 */

const NEUTRAL: ButtonState = emptyButtonState();
function btn(held: Partial<Record<keyof ButtonState, boolean>>): ButtonState {
  return { ...emptyButtonState(), ...held } as ButtonState;
}
function inputs(direction: Direction8, held: Partial<Record<keyof ButtonState, boolean>> = {}) {
  return { direction, buttons: btn(held) };
}

function ballSpeed(state: GameState): number {
  return Math.hypot(toFloat(state.ball.vel.x), toFloat(state.ball.vel.y));
}

/** 操作選手がボールの touch-priority を持っているか (= キック等が発動できる状態か)。 */
function humanHasBall(state: GameState): boolean {
  return findTouchPriorityPlayer(state.players, state.ball.pos, state.lastTouchPlayerIndex) === state.controlledPlayerIndex;
}

function distPx(state: GameState, index: number): number {
  const p = state.players[index]!;
  return Math.sqrt(toFloat(distSqFixed(p.pos, state.ball.pos)));
}

/**
 * 人間(Team A)が中盤でボールを足元に持っている状態を作る。
 * half=1 では Team A は南(y=PITCH_HEIGHT)を守り、北(y=0)へ攻める。
 */
function humanCarrying(carrierIndex = TeamId.A * 11 + 9, x = 240, y = 1000): GameState {
  const base = createInitialState(1, { difficulty: 'easy', offsideEnabled: false });
  const pos = { x: toFixed(x), y: toFixed(y) };
  return {
    ...base,
    controlledPlayerIndex: carrierIndex,
    ball: { ...base.ball, pos, vel: { x: ZERO_FIXED, y: ZERO_FIXED }, height: ZERO_FIXED, zVel: ZERO_FIXED },
    players: base.players.map((p, i) => {
      if (i === carrierIndex) return { ...p, pos, facing: Direction8.Up };
      // 他の選手は全員遠くへ退避させ、この検証を「人間の操作 vs ゲームの応答」だけに絞る。
      const far = { x: toFixed(20 + (i % 5) * 30), y: toFixed(i < 11 ? 1700 : 120) };
      return { ...p, pos: far };
    }),
    lastTouchTeam: TeamId.A,
    lastTouchPlayerIndex: carrierIndex,
  };
}

describe('プレイアビリティ 0: キックが「押した時に必ず出る」', () => {
  /**
   * ★実プレイ報告「まだキックの反応が弱い」の計測結果に対応するゲート★
   * 計測で判明した2つの原因:
   *   1. キックは touch-priority 保持中しか出ず、ボールが少し離れると完全に無反応
   *      (実戦相当の計測で、ドリブル中の22%のtickがキック不能だった)
   *   2. 方向入力なしのBが球速3.94 (方向ありは8.86) と落差が大きく「蹴った気がしない」
   */

  /** 人間からボールを dist px 離した状態を作る (足元 → 少し先 → 射程外)。 */
  function ballAtDistance(dist: number): GameState {
    const base = humanCarrying();
    const human = base.players[base.controlledPlayerIndex]!;
    return {
      ...base,
      ball: { ...base.ball, pos: { x: human.pos.x, y: toFixed(toFloat(human.pos.y) - dist) } },
    };
  }

  for (const dist of [8, 16, 24, 29]) {
    it(`ボールが${dist}px離れていてもBで蹴れる (射程30px以内)`, () => {
      let state = ballAtDistance(dist);
      state = simulate(state, inputs(Direction8.Up, { B: true }));
      state = simulate(state, inputs(Direction8.Up));
      expect(ballSpeed(state), `${dist}pxでBが無反応`).toBeGreaterThan(5);
    });
  }

  it('★入力バッファ★ 射程外でBを押しても、ボールが射程に入った瞬間に蹴られる', () => {
    // ボールを前方に転がしておき、選手が追いつく前にBを押す (実プレイで最も多い操作)。
    const base = humanCarrying();
    const human = base.players[base.controlledPlayerIndex]!;
    let state: GameState = {
      ...base,
      ball: { ...base.ball, pos: { x: human.pos.x, y: toFixed(toFloat(human.pos.y) - 60) } },
    };
    // 射程外(60px)でB押下→離す。この時点では蹴れない。
    state = simulate(state, inputs(Direction8.Up, { B: true }));
    state = simulate(state, inputs(Direction8.Up));
    expect(ballSpeed(state), '射程外なのに蹴れてしまった').toBeLessThan(1);

    // 走って追いつく間に、バッファが消化されてキックが出るはず。
    let fired = false;
    for (let i = 0; i < 12 && !fired; i++) {
      state = simulate(state, inputs(Direction8.Up));
      if (ballSpeed(state) > 5) fired = true;
    }
    expect(fired, '射程に入ってもバッファされたキックが出ない').toBe(true);
  });

  /**
   * ★実ブラウザで発見した最重要バグの回帰テスト★
   *
   * 症状: キックは出ている (キックtickの球速は8.86) のに、**次のtickでドリブルタッチが
   * ボールを掴み直して2.8まで減速させる**ため、ボールが足元から離れず「蹴っても飛ばない」。
   * 実測トレース: [kick 8.86] → [次tick 2.75] → [2.75] → [2.75] で距離17.8pxのまま。
   *
   * 見逃した理由: これまでのテストは「キックしたtickの球速」しか見ていなかった。
   * キックは**その後も飛び続けて初めてキック**なので、複数tickの軌跡で検証する。
   */
  it('★蹴ったボールは飛び続ける (次tickのドリブルタッチに殺されない)', () => {
    let state = humanCarrying();
    const human = state.controlledPlayerIndex;
    // 走りながら蹴る (実プレイで最も多い操作)。
    for (let i = 0; i < 20; i++) state = simulate(state, inputs(Direction8.Up));
    state = simulate(state, inputs(Direction8.Up, { B: true }));
    state = simulate(state, inputs(Direction8.Up)); // 離す = キック
    const kickSpeed = ballSpeed(state);
    expect(kickSpeed, 'そもそもキックが出ていない').toBeGreaterThan(5);

    // 蹴った後も方向キーは押しっぱなし (実プレイどおり)。
    for (let i = 0; i < 5; i++) state = simulate(state, inputs(Direction8.Up));
    expect(ballSpeed(state), 'キックしたボールがドリブルタッチで減速させられている').toBeGreaterThan(
      kickSpeed * 0.6,
    );
    expect(distPx(state, human), 'キックしたのにボールが足元から離れていない').toBeGreaterThan(30);
  });

  it('★A(前方パス)も飛び続ける', () => {
    let state = humanCarrying();
    const human = state.controlledPlayerIndex;
    for (let i = 0; i < 20; i++) state = simulate(state, inputs(Direction8.Up));
    state = simulate(state, inputs(Direction8.Up, { A: true }));
    for (let i = 0; i < 5; i++) state = simulate(state, inputs(Direction8.Up));
    expect(distPx(state, human), 'Aのパスがドリブルタッチに殺されている').toBeGreaterThan(30);
  });

  it('方向入力なしのBでも「蹴った」と分かる速度が出る', () => {
    let state = humanCarrying();
    state = simulate(state, inputs(Direction8.None, { B: true }));
    state = simulate(state, inputs(Direction8.None));
    // 旧実装は3.94で「転がっただけ」に見えていた。方向ありの強キックより弱いのは仕様。
    expect(ballSpeed(state)).toBeGreaterThan(5.5);
    expect(ballSpeed(state)).toBeLessThan(toFloat(STRONG_KICK_SPEED_FIXED));
  });

  it('相手が保持しているボールは、近くてもBで蹴れない (それはタックルの領分)', () => {
    const base = humanCarrying();
    const human = base.controlledPlayerIndex;
    const opponent = TeamId.B * 11 + 5;
    const oppPos = { x: toFixed(240), y: toFixed(985) };
    const state: GameState = {
      ...base,
      ball: { ...base.ball, pos: oppPos },
      players: base.players.map((p, i) => (i === opponent ? { ...p, pos: oppPos } : p)),
      lastTouchTeam: TeamId.B,
      lastTouchPlayerIndex: opponent,
      setPieceLock: null,
    };
    const next = simulate(simulate(state, inputs(Direction8.Up, { B: true })), inputs(Direction8.Up));
    // タックル/チャージでボールが動くのは正当なので、「キックの速度で飛ぶ」ことだけを禁じる。
    expect(ballSpeed(next), '相手の保持球をキックで奪えてしまった').toBeLessThan(
      toFloat(STRONG_KICK_SPEED_FIXED) - 1,
    );
    expect(next.players[human]!.pos).toBeDefined();
  });
});

describe('プレイアビリティ 1: ドリブルでボールが足元から逃げない', () => {
  it('前進ドリブルを2秒続けても、ボールは触れる間合いに留まる', () => {
    let state = humanCarrying();
    const human = state.controlledPlayerIndex;
    let lostTicks = 0;
    for (let i = 0; i < 120; i++) {
      state = simulate(state, inputs(Direction8.Up));
      if (!humanHasBall(state)) lostTicks++;
    }
    // ボールが選手より速いと永久に離れていく。実プレイの「操作不能感」の主因だったため、
    // 「2秒間ずっと触れる」を強い保証としてゲート化する。
    expect(lostTicks, `ボールを見失ったtick数 (最終距離=${distPx(state, human).toFixed(1)}px)`).toBe(0);
  });

  /**
   * ★ユーザー指示「基本的にドリブルしているときは足から離れないようにして。LR同時押以外」★
   *
   * 旧実装の実測: 直進では最大15pxだが、**方向転換を繰り返すと最大95.6px** 置き去りになった
   * (速度を上書きするだけで、進行方向が変わってもボールは古い方向へ転がり続けたため)。
   * 追従モデル (足元の少し前を目標点にして引き寄せる) へ変更後は最大5.0px。
   */
  it('★方向転換を繰り返してもボールが足元から離れない', () => {
    let state = humanCarrying();
    const human = state.controlledPlayerIndex;
    const dirs = [
      Direction8.Up,
      Direction8.UpRight,
      Direction8.Right,
      Direction8.DownRight,
      Direction8.Down,
      Direction8.Left,
    ];
    let maxDist = 0;
    for (let i = 0; i < 240; i++) {
      state = simulate(state, inputs(dirs[Math.floor(i / 20) % dirs.length]!));
      maxDist = Math.max(maxDist, distPx(state, human));
    }
    expect(maxDist, '方向転換でボールが置き去りになっている').toBeLessThan(10);
  });

  it('L+R (蹴り出しドリブル) だけは足元から離れる — ただし制御は失わない', () => {
    let state = humanCarrying();
    const human = state.controlledPlayerIndex;
    let maxDist = 0;
    let sum = 0;
    for (let i = 0; i < 120; i++) {
      state = simulate(state, inputs(Direction8.Up, { L: true, R: true }));
      const d = distPx(state, human);
      maxDist = Math.max(maxDist, d);
      sum += d;
    }
    // 通常ドリブル (最大5px) より明確に前へ出る。
    expect(sum / 120, '蹴り出しドリブルなのに通常ドリブルと変わらない').toBeGreaterThan(6);
    // ただしプレー可能な間合い(20px)の中に留まり、ボールを見失わない
    // (旧実装は毎tick速度6.0を与え続けた結果、平均810px離れて事実上ボールを捨てていた)。
    expect(maxDist, '蹴り出しドリブルでボールを見失っている').toBeLessThan(20);
  });

  it('ドリブル中、ボールが選手から極端に離れない (20px = 触れる限界を超えない)', () => {
    let state = humanCarrying();
    const human = state.controlledPlayerIndex;
    let maxDist = 0;
    for (let i = 0; i < 120; i++) {
      state = simulate(state, inputs(Direction8.Up));
      maxDist = Math.max(maxDist, distPx(state, human));
    }
    expect(maxDist).toBeLessThan(20);
  });
});

describe('プレイアビリティ 2: キックが必ず反応する', () => {
  it('静止状態からBを短く押して離すと、ボールが強く飛ぶ', () => {
    let state = humanCarrying();
    state = simulate(state, inputs(Direction8.Up, { B: true }));
    state = simulate(state, inputs(Direction8.Up, { B: true }));
    const before = ballSpeed(state);
    state = simulate(state, inputs(Direction8.Up)); // 離す = キック実行
    expect(ballSpeed(state), `キック前=${before.toFixed(2)}`).toBeGreaterThan(toFloat(STRONG_KICK_SPEED_FIXED) * 0.5);
  });

  it('★実プレイ報告の中核★ 走りながら(ドリブル継続中に)Bを押して離してもキックが出る', () => {
    let state = humanCarrying();
    // まず十分に走り込む (ここでボールが逃げていると、この後のキックが不発になる)
    for (let i = 0; i < 60; i++) state = simulate(state, inputs(Direction8.Up));
    expect(humanHasBall(state), 'ドリブル60tick後にボールを見失っている').toBe(true);

    state = simulate(state, inputs(Direction8.Up, { B: true }));
    state = simulate(state, inputs(Direction8.Up, { B: true }));
    state = simulate(state, inputs(Direction8.Up)); // 離す
    expect(ballSpeed(state)).toBeGreaterThan(toFloat(STRONG_KICK_SPEED_FIXED) * 0.5);
  });

  it('Bの1tickタップ(押した次のtickで離す)でもキックが出る', () => {
    let state = humanCarrying();
    state = simulate(state, inputs(Direction8.Up, { B: true }));
    state = simulate(state, inputs(Direction8.Up));
    expect(ballSpeed(state)).toBeGreaterThan(toFloat(WEAK_KICK_SPEED_FIXED) * 0.5);
  });

  it('溜め時間が長いほどボールが速く/高く飛ぶ (押下時間で強さが変わる、続編仕様)', () => {
    const kickWithCharge = (ticks: number) => {
      let s = humanCarrying();
      for (let i = 0; i < ticks; i++) s = simulate(s, inputs(Direction8.Up, { B: true }));
      s = simulate(s, inputs(Direction8.Up));
      return s;
    };
    const short = kickWithCharge(2);
    const long = kickWithCharge(25);
    expect(toFloat(long.ball.zVel)).toBeGreaterThan(toFloat(short.ball.zVel));
  });
});

describe('プレイアビリティ 3: 守備アクション (スライディング / ショルダーチャージ)', () => {
  /** 相手(Team B)がドリブル中、人間がその背後至近に立っている状況。 */
  function humanChasingOpponent(gapPx: number): GameState {
    const base = createInitialState(1, { difficulty: 'easy', offsideEnabled: false });
    const opponent = TeamId.B * 11 + 9;
    const human = TeamId.A * 11 + 5;
    const oppPos = { x: toFixed(240), y: toFixed(1000) };
    // Team B は half=1 で南(y増)へ攻める。人間は「背後」= y の小さい側に立つ。
    const humanPos = { x: toFixed(240), y: toFixed(1000 - gapPx) };
    return {
      ...base,
      controlledPlayerIndex: human,
      ball: { ...base.ball, pos: oppPos, vel: { x: ZERO_FIXED, y: ZERO_FIXED }, height: ZERO_FIXED, zVel: ZERO_FIXED },
      players: base.players.map((p, i) => {
        if (i === opponent) return { ...p, pos: oppPos, facing: Direction8.Down };
        if (i === human) return { ...p, pos: humanPos, facing: Direction8.Down };
        const far = { x: toFixed(20 + (i % 5) * 30), y: toFixed(i < 11 ? 1750 : 100) };
        return { ...p, pos: far };
      }),
      lastTouchTeam: TeamId.B,
      lastTouchPlayerIndex: opponent,
      // これは流れの中のプレー(相手がドリブル中)の再現なので、createInitialState が張る
      // キックオフの再開ロックは外す (ロック中は touch-priority が Team A に制限され、
      // 相手がボールを保持できないため状況が成立しない)。
      setPieceLock: null,
    };
  }

  it('★実プレイ報告★ 相手の背後・選手2人ぶんの間合いからAでスライディングが発動する', () => {
    // 選手半径10px同士なので、24px = ほぼ密着〜1人ぶん。ここで出ないなら実プレイでは絶対に出ない。
    // 17周目: ボタン表に合わせてスライディングは B -> A/Y (tests/sim/buttonLayout.test.ts)。
    let state = humanChasingOpponent(24);
    const human = state.controlledPlayerIndex;
    state = simulate(state, inputs(Direction8.Down, { A: true }));
    expect(state.players[human]!.tacklePhase, 'Aを押してもタックルが始まらない').not.toBe(0);
  });

  it('スライディングは現実的な追走距離 (32px) からも発動する', () => {
    let state = humanChasingOpponent(32);
    const human = state.controlledPlayerIndex;
    state = simulate(state, inputs(Direction8.Down, { A: true }));
    expect(state.players[human]!.tacklePhase).not.toBe(0);
  });

  it('発動したスライディングは実際にボールを奪える', () => {
    let state = humanChasingOpponent(28);
    state = simulate(state, inputs(Direction8.Down, { A: true }));
    let won = false;
    for (let i = 0; i < 30 && !won; i++) {
      state = simulate(state, inputs(Direction8.Down));
      if (state.lastTouchTeam === TeamId.A) won = true;
    }
    expect(won, 'スライディングしてもボールを奪えない').toBe(true);
  });

  it('★未実装だった★ 相手保持中にBでショルダーチャージが発動する (続編仕様)', () => {
    // 17周目: ボタン表に合わせてチャージは Y/X -> B/X (tests/sim/buttonLayout.test.ts)。
    let state = humanChasingOpponent(26);
    const before = state.lastTouchTeam;
    let changed = false;
    for (let i = 0; i < 20 && !changed; i++) {
      state = simulate(state, inputs(Direction8.Down, { B: true }));
      if (state.lastTouchTeam !== before) changed = true;
    }
    expect(changed, 'Bを押してもショルダーチャージが起きない (ボール保持が変わらない)').toBe(true);
  });
});

describe('プレイアビリティ 4: キーパーがちゃんと止める', () => {
  /** Team B ゴール(y=0)へ向かう実際のシュートを作る。speed は px/tick。 */
  function shotAtGoal(speed: number, startY = 200): GameState {
    const base = createInitialState(1, { difficulty: 'easy', offsideEnabled: false });
    return {
      ...base,
      ball: {
        pos: { x: toFixed(240), y: toFixed(startY) },
        vel: { x: ZERO_FIXED, y: toFixed(-speed) },
        height: ZERO_FIXED,
        zVel: ZERO_FIXED,
      },
      lastTouchTeam: TeamId.A,
      lastTouchPlayerIndex: TeamId.A * 11 + 9,
      players: base.players.map((p, i) => {
        if (i === TeamId.B * 11) return p; // Team B GK はホーム位置のまま
        const far = { x: toFixed(20 + (i % 5) * 30), y: toFixed(i < 11 ? 1700 : 900) };
        return { ...p, pos: far };
      }),
    };
  }

  it('★実プレイ報告★ 正面への強シュートをキーパーが止める (通り抜けて失点しない)', () => {
    let state = shotAtGoal(toFloat(STRONG_KICK_SPEED_FIXED));
    for (let i = 0; i < 60; i++) state = simulate(state, inputs(Direction8.None));
    expect(state.score[0], 'GK正面の強シュートが素通りして失点している').toBe(0);
  });

  it('遅めのボールはキーパーが「キャッチ」して確保する (弾くだけで終わらない)', () => {
    let state = shotAtGoal(5.5);
    let secured = false;
    for (let i = 0; i < 80 && !secured; i++) {
      state = simulate(state, inputs(Direction8.None));
      const gk = state.players[TeamId.B * 11]!;
      const nearGk = Math.sqrt(toFloat(distSqFixed(gk.pos, state.ball.pos))) < 20;
      if (nearGk && ballSpeed(state) < 0.5) secured = true;
    }
    expect(secured, 'キーパーがボールを確保できていない').toBe(true);
  });

  it('★実プレイ報告★ 強シュートでもキーパーがキャッチできる場面が存在する (常に弾くだけではない)', () => {
    // CATCH_MAX_SPEED < STRONG_KICK_SPEED だと、まともなシュートは構造的に絶対キャッチ不能になる。
    // 「速いボールはキャッチ不能」はCLAUDE.mdの意図的な設計だが、その閾値が強キック速度より
    // 下だと"全シュートが弾かれる"ことになり、キャッチという操作自体が死ぬ。
    let state = shotAtGoal(toFloat(STRONG_KICK_SPEED_FIXED) * 0.85);
    let secured = false;
    for (let i = 0; i < 80 && !secured; i++) {
      state = simulate(state, inputs(Direction8.None));
      const gk = state.players[TeamId.B * 11]!;
      const nearGk = Math.sqrt(toFloat(distSqFixed(gk.pos, state.ball.pos))) < 20;
      if (nearGk && ballSpeed(state) < 0.5) secured = true;
    }
    expect(secured, '強めのシュートを一度もキャッチできない (キャッチ操作が実質死んでいる)').toBe(true);
  });
});

describe('プレイアビリティ 5: セットプレーが停滞しない', () => {
  /** Team A のゴールキック (自陣=南側) を発生させる。 */
  function goalKickForTeamA(): GameState {
    const base = createInitialState(1, { difficulty: 'easy', offsideEnabled: false });
    const state: GameState = {
      ...base,
      // 南(y=PITCH_HEIGHT)は half=1 で Team A の自陣ゴールライン。Team B が最後に触って割る。
      ball: {
        pos: { x: toFixed(100), y: toFixed(1795) },
        vel: { x: ZERO_FIXED, y: toFixed(8) },
        height: ZERO_FIXED,
        zVel: ZERO_FIXED,
      },
      lastTouchTeam: TeamId.B,
    };
    return simulate(state, inputs(Direction8.None));
  }

  it('ゴールキックが自軍(Team A)に与えられ、再開ロックがかかる', () => {
    const state = goalKickForTeamA();
    expect(state.setPieceLock?.kind).toBe('goalKick');
    expect(state.setPieceLock?.restartTeam).toBe(TeamId.A);
  });

  it('★実プレイ報告「アホな動き」★ ゴールキックは無操作でも妥当な時間内に再開される', () => {
    let state = goalKickForTeamA();
    let releasedAt: number | null = null;
    for (let i = 0; i < 300 && releasedAt === null; i++) {
      state = simulate(state, inputs(Direction8.None));
      if (state.setPieceLock === null) releasedAt = i;
    }
    // 5秒(300tick)経ってもボールが動かない = 誰も蹴りに行かない「詰み」。
    expect(releasedAt, 'ゴールキックが300tick経っても再開されない(選手が誰も蹴りに行かない)').not.toBeNull();
  });

  it('ゴールキックのキッカーは攻撃方向(北)を向いて始まる', () => {
    const state = goalKickForTeamA();
    const spot = state.setPieceLock!.pos;
    let nearest = -1;
    let bestDist = Infinity;
    state.players.forEach((p, i) => {
      if (p.team !== TeamId.A) return;
      const d = toFloat(distSqFixed(p.pos, spot));
      if (d < bestDist) {
        bestDist = d;
        nearest = i;
      }
    });
    // Team A は half=1 で北へ攻める。
    expect(state.players[nearest]!.facing).toBe(Direction8.Up);
  });
});

describe('プレイアビリティ 6: フルマッチで各アクションが実際に発生している', () => {
  /**
   * 「押したら反応する」を統計としても担保する。個別シナリオが通っていても、実試合の
   * 文脈(カーソル切替・AIの妨害・セットプレー)で死んでいたら意味がないため。
   */
  it('能動的にプレーする人間の入力に対し、キック・守備アクションが試合中に十分発生する', () => {
    let state = createInitialState(7, { difficulty: 'easy', offsideEnabled: true });
    let kicks = 0;
    let kickReleases = 0;
    let tackles = 0;
    let charges = 0;
    let carryTicks = 0;
    let possessionChunks = 0;
    let longestPossession = 0;
    let prevPhase = 0;

    /** ボールへ向かう8方向 (sqrt/trig不要の素朴な象限判定で十分)。 */
    const towardBall = (s: GameState): Direction8 => {
      const p = s.players[s.controlledPlayerIndex]!;
      const dx = (s.ball.pos.x as number) - (p.pos.x as number);
      const dy = (s.ball.pos.y as number) - (p.pos.y as number);
      const t = 256 * 8; // 8px 以上ずれている軸だけを方向成分として扱う
      const h = dx > t ? 1 : dx < -t ? -1 : 0;
      const v = dy > t ? 1 : dy < -t ? -1 : 0;
      if (v < 0 && h === 0) return Direction8.Up;
      if (v < 0 && h > 0) return Direction8.UpRight;
      if (v === 0 && h > 0) return Direction8.Right;
      if (v > 0 && h > 0) return Direction8.DownRight;
      if (v > 0 && h === 0) return Direction8.Down;
      if (v > 0 && h < 0) return Direction8.DownLeft;
      if (v === 0 && h < 0) return Direction8.Left;
      if (v < 0 && h < 0) return Direction8.UpLeft;
      return Direction8.Up;
    };

    // 現実的な擬似人間: ボールを持ったら数タッチ運んでからシュート/パス、
    // 持っていなければボールへ寄せて、近づいたら守備アクションを出す。
    let possessionTicks = 0; // 今の保持で何tick運んだか (キックのタイミング決定に使う)
    for (let i = 0; i < 3600; i++) {
      const carrying = humanHasBall(state);
      if (carrying) {
        carryTicks++;
        possessionTicks++;
        longestPossession = Math.max(longestPossession, possessionTicks);
      } else {
        if (possessionTicks > 0) possessionChunks++;
        possessionTicks = 0;
      }
      const dist = distPx(state, state.controlledPlayerIndex);

      let dir: Direction8;
      let held: Partial<Record<keyof ButtonState, boolean>> = {};
      if (carrying) {
        dir = Direction8.Up; // ゴールへ運ぶ
        // 数タッチ運んでは蹴る、を繰り返す実際のプレイのリズム (0.5秒ごとにパス/シュート)。
        const beat = possessionTicks % 30;
        if (beat >= 12 && beat < 14) held = { B: true };
      } else {
        dir = towardBall(state);
        // 守備アクションは連打しない (人間は毎tickボタンを叩かない)。間合いに入った時だけ、
        // 一定間隔でスライディング(B)とショルダーチャージ(Y)を試みる。
        if (dist < 34) {
          if (i % 24 === 0) held = { B: true };
          else if (i % 24 === 12) held = { Y: true };
        }
      }

      const chargeBefore = state.players[state.controlledPlayerIndex]!.kickChargeFrames;
      const next = simulate(state, inputs(dir, held));
      const chargeAfter = next.players[next.controlledPlayerIndex]!.kickChargeFrames;

      // 溜めが >0 から 0 に落ちた = このtickでキックが解放された、という機構そのものを数える
      // (ボール速度の推測は、ドリブルタッチ速度と閾値が近くて誤検出するため使わない)。
      if (chargeBefore > 0 && chargeAfter === 0) {
        kickReleases++;
        const speed = Math.hypot(toFloat(next.ball.vel.x), toFloat(next.ball.vel.y));
        if (speed > toFloat(WEAK_KICK_SPEED_FIXED) * 0.9) kicks++;
      }
      const humanPhase = next.players[next.controlledPlayerIndex]!.tacklePhase as unknown as number;
      if (humanPhase !== 0 && prevPhase === 0) tackles++;
      if (!carrying && next.lastTouchTeam === TeamId.A && state.lastTouchTeam === TeamId.B && dist < 34) charges++;

      prevPhase = humanPhase;
      state = next;
    }

    const summary = `carry=${carryTicks}t chunks=${possessionChunks} longest=${longestPossession} releases=${kickReleases} kicks=${kicks} tackles=${tackles} steals=${charges}`;
    expect(carryTicks, `人間が一度もボールを保持できていない (${summary})`).toBeGreaterThan(60);
    // 溜めを離したのにボールが飛ばない = 「ボタンを押しても反応しない」そのもの。
    // 解放回数に対してキック成立回数が極端に少ないなら、どこかで握り潰されている。
    expect(kicks, `キックがほとんど成立していない (${summary})`).toBeGreaterThan(5);
    expect(kicks / Math.max(1, kickReleases), `溜めを離してもボールが飛ばない割合が高い (${summary})`).toBeGreaterThan(0.7);
    expect(tackles, `守備アクションが一度も発動していない (${summary})`).toBeGreaterThan(0);
    expect(charges, `一度もボールを奪い返せていない (${summary})`).toBeGreaterThan(0);
  }, 30000);
});
