import { describe, expect, it } from 'vitest';
import { toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { Direction8, emptyButtonState, type ButtonState } from '../../src/input/types';
import { createInitialState, TacklePhase, TeamId, type GameState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { STRONG_KICK_SPEED_FIXED, WEAK_KICK_SPEED_FIXED } from '../../src/sim/ballConstants';

// テンポ変更 (24周目サイクル①) 追従: 「キック/パスが出た」のしきい値を定数からの相対値に。
// 強キック基準 (B) と、それより弱くてよいパス/フィード基準 (Y/A/X) の2段。
const KICK_FIRED = toFloat(STRONG_KICK_SPEED_FIXED) * 0.8;
const PASS_FIRED = toFloat(WEAK_KICK_SPEED_FIXED) * 0.85;

/**
 * ★ボタン表そのものを固定するゲート (CLAUDE.md「続編仕様: ボタン配置」)★
 *
 * 存在理由 (絶対に消さないこと): ユーザーから
 * 「チャージとかしないしスライディングしないしAボタン(〇ボタン)反応しない」
 * という報告が繰り返された。原因は**実装がボタン表と食い違っていた**こと:
 *   - 表: 相手ボール時 スライディング = Y または A / ショルダーチャージ = B または X
 *   - 実装: スライディング = B / チャージ = Y または X / **A はどこにも繋がっていない**
 * つまり仕様どおりに押しても何も起きない状態だった。単体テストも統計ゲートも
 * 「実装した通りの動き」しか見ておらず、**表と実装の一致を誰も検証していなかった**。
 *
 * 以後、ボタン割り当てを変更したら必ずこの表を先に直し、ここを赤くしてから実装すること。
 *
 * | ボタン | ルーズボール時 | ボールキープ時 | 相手ボール時 |
 * |---|---|---|---|
 * | B | シュート、クリア | シュート | ショルダーチャージ |
 * | Y | パスカーソル先へのパス | パスカーソル先へのパス | スライディングタックル |
 * | A | スライディング | 進行方向へのパス | スライディングタックル |
 * | X | ロビングのパス | ロングフィード、センタリング | ショルダーチャージ |
 */

const btn = (held: Partial<Record<keyof ButtonState, boolean>>): ButtonState =>
  ({ ...emptyButtonState(), ...held }) as ButtonState;
const inp = (direction: Direction8, held: Partial<Record<keyof ButtonState, boolean>> = {}) => ({
  direction,
  buttons: btn(held),
});
const NO_INPUT = inp(Direction8.None);

const ballSpeed = (s: GameState) => Math.hypot(toFloat(s.ball.vel.x), toFloat(s.ball.vel.y));

/** 人間がボールを足元に持ち、味方が前方に、相手が遠方にいる状態 (ボールキープ時)。 */
function keeping(): GameState {
  const base = createInitialState(1, { difficulty: 'easy', offsideEnabled: false });
  const human = TeamId.A * 11 + 9;
  const mate = TeamId.A * 11 + 8;
  const pos = { x: toFixed(240), y: toFixed(1000) };
  return {
    ...base,
    controlledPlayerIndex: human,
    ball: { pos, vel: { x: ZERO_FIXED, y: ZERO_FIXED }, height: ZERO_FIXED, zVel: ZERO_FIXED },
    players: base.players.map((p, i) => {
      if (i === human) return { ...p, pos, facing: Direction8.Up };
      // 味方1人を前方(パスカーソルの届く範囲)に置く
      if (i === mate) return { ...p, pos: { x: toFixed(260), y: toFixed(880) }, facing: Direction8.Up };
      return { ...p, pos: { x: toFixed(20 + (i % 4) * 20), y: toFixed(p.team === TeamId.A ? 1750 : 100) } };
    }),
    lastTouchTeam: TeamId.A,
    lastTouchPlayerIndex: human,
    setPieceLock: null,
  };
}

/** 相手(Team B)がボールを保持し、人間がその背後至近にいる状態 (相手ボール時)。 */
function defending(): GameState {
  const base = createInitialState(1, { difficulty: 'easy', offsideEnabled: false });
  const human = TeamId.A * 11 + 5;
  const carrier = TeamId.B * 11 + 9;
  const carrierPos = { x: toFixed(240), y: toFixed(1000) };
  return {
    ...base,
    controlledPlayerIndex: human,
    ball: { pos: { x: toFixed(240), y: toFixed(1006) }, vel: { x: ZERO_FIXED, y: ZERO_FIXED }, height: ZERO_FIXED, zVel: ZERO_FIXED },
    players: base.players.map((p, i) => {
      if (i === human) return { ...p, pos: { x: toFixed(240), y: toFixed(978) }, facing: Direction8.Down };
      if (i === carrier) return { ...p, pos: carrierPos, facing: Direction8.Down };
      return { ...p, pos: { x: toFixed(20 + (i % 4) * 20), y: toFixed(p.team === TeamId.A ? 1750 : 100) } };
    }),
    lastTouchTeam: TeamId.B,
    lastTouchPlayerIndex: carrier,
    setPieceLock: null,
  };
}

/** 誰も保持していないボールが人間の目の前にある状態 (ルーズボール時)。 */
function loose(): GameState {
  const base = keeping();
  return { ...base, lastTouchTeam: null, lastTouchPlayerIndex: null };
}

/** ボタンを1tick押して離し、その後の状態を返す。 */
function press(state: GameState, button: keyof ButtonState, direction = Direction8.Up): GameState {
  const held = simulate(state, inp(direction, { [button]: true }));
  return simulate(held, inp(direction));
}

/**
 * スライディングが始まったか。スライディングは Windup から始まるので、
 * ショルダーチャージ (押した瞬間に Recovery へ入る) と明確に区別できる。
 */
function slidingStarted(before: GameState, button: keyof ButtonState): boolean {
  let state = simulate(before, inp(Direction8.Down, { [button]: true }));
  for (let i = 0; i < 4; i++) {
    const phase = state.players[state.controlledPlayerIndex]!.tacklePhase;
    if (phase === TacklePhase.Windup || phase === TacklePhase.Active) return true;
    state = simulate(state, inp(Direction8.Down));
  }
  return false;
}

/** ショルダーチャージが起きたか (ボールが動き、かつスライディングのWindupを経ていない)。 */
function chargeHappened(before: GameState, button: keyof ButtonState): boolean {
  let state = before;
  for (let i = 0; i < 12; i++) {
    state = simulate(state, inp(Direction8.Down, { [button]: true }));
    const phase = state.players[state.controlledPlayerIndex]!.tacklePhase;
    if (phase === TacklePhase.Windup) return false; // これはスライディング
    if (state.lastTouchTeam === TeamId.A || ballSpeed(state) > 1) return true;
    state = simulate(state, inp(Direction8.Down));
  }
  return false;
}

describe('ボタン表: 相手ボール時', () => {
  it('★A (〇ボタン) でスライディングが出る', () => {
    expect(slidingStarted(defending(), 'A'), 'Aを押してもスライディングが始まらない').toBe(true);
  });

  it('★Y でもスライディングが出る (表では A/Y の両方)', () => {
    expect(slidingStarted(defending(), 'Y'), 'Yを押してもスライディングが始まらない').toBe(true);
  });

  it('★B でショルダーチャージが出る (スライディングではない)', () => {
    expect(chargeHappened(defending(), 'B'), 'Bを押してもチャージが起きない').toBe(true);
  });

  it('★X でもショルダーチャージが出る (表では B/X の両方)', () => {
    expect(chargeHappened(defending(), 'X'), 'Xを押してもチャージが起きない').toBe(true);
  });

  it('B/X はスライディングではない (表の割り当てが入れ替わっていない)', () => {
    expect(slidingStarted(defending(), 'B'), 'Bでスライディングが出ている (表と逆)').toBe(false);
    expect(slidingStarted(defending(), 'X'), 'Xでスライディングが出ている (表と逆)').toBe(false);
  });
});

describe('ボタン表: ボールキープ時', () => {
  it('B でシュート (+字方向へ鋭いキック)', () => {
    const next = press(keeping(), 'B');
    expect(ballSpeed(next), 'Bでシュートが出ない').toBeGreaterThan(KICK_FIRED);
  });

  it('Y でパスカーソル先へパス', () => {
    const next = press(keeping(), 'Y');
    expect(ballSpeed(next), 'Yでパスが出ない').toBeGreaterThan(PASS_FIRED);
  });

  it('★A で進行方向へのパスが出る', () => {
    const next = press(keeping(), 'A', Direction8.Right);
    expect(ballSpeed(next), 'Aでパスが出ない').toBeGreaterThan(PASS_FIRED);
    // 進行方向 = 入力した方向 (右) へ飛ぶ
    expect(toFloat(next.ball.vel.x), 'Aのパスが入力方向へ飛んでいない').toBeGreaterThan(PASS_FIRED);
  });

  it('★X でロングフィード (高い弾道) が出る', () => {
    const next = press(keeping(), 'X');
    expect(ballSpeed(next), 'Xでロングフィードが出ない').toBeGreaterThan(PASS_FIRED);
    // 垂直初速もテンポ (BALL_TEMPO) でスケールするため、弱キック基準の相対値で見る。
    expect(toFloat(next.ball.zVel), 'Xのフィードが高い弾道になっていない').toBeGreaterThan(PASS_FIRED * 0.5);
  });
});

describe('ボタン表: ルーズボール時', () => {
  it('B でクリア (鋭いキック)', () => {
    const next = press(loose(), 'B');
    expect(ballSpeed(next), 'Bでクリアが出ない').toBeGreaterThan(KICK_FIRED);
  });

  it('★X でロビング (高い弾道) が出る', () => {
    const next = press(loose(), 'X');
    expect(toFloat(next.ball.zVel), 'Xでロビングにならない').toBeGreaterThan(1);
  });

  it('★A でスライディング (ボールへ飛び込む) が出る', () => {
    // ボールを少し離して「飛び込む」状況にする。
    const base = loose();
    const human = base.players[base.controlledPlayerIndex]!;
    const state: GameState = {
      ...base,
      ball: { ...base.ball, pos: { x: human.pos.x, y: toFixed(toFloat(human.pos.y) - 34) } },
    };
    let next = simulate(state, inp(Direction8.Up, { A: true }));
    let started = next.players[next.controlledPlayerIndex]!.tacklePhase !== TacklePhase.None;
    for (let i = 0; i < 4 && !started; i++) {
      next = simulate(next, inp(Direction8.Up));
      started = next.players[next.controlledPlayerIndex]!.tacklePhase !== TacklePhase.None;
    }
    expect(started, 'Aでボールへのスライディングが始まらない').toBe(true);
  });
});

describe('ボタン表: 全ボタンが「何かに」割り当たっている (無反応ボタンを作らない)', () => {
  const buttons: Array<keyof ButtonState> = ['B', 'Y', 'A', 'X'];
  for (const b of buttons) {
    it(`${b} はボールキープ時に必ず何らかの反応を返す`, () => {
      const before = keeping();
      const after = press(before, b);
      const moved = ballSpeed(after) > 0.5;
      const tackling = after.players[after.controlledPlayerIndex]!.tacklePhase !== TacklePhase.None;
      expect(moved || tackling, `${b} を押しても何も起きない (無反応ボタン)`).toBe(true);
    });
  }
});
