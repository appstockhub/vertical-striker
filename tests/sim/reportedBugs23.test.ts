import { describe, expect, it } from 'vitest';
import { toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { Direction8, emptyButtonState, type ButtonState } from '../../src/input/types';
import { createInitialState, TeamId, type GameState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';

/**
 * ★23周目: ユーザーが実機(操作確認モード/練習モード)で報告した不具合の再現テスト★
 *
 * CLAUDE.md「検証の絶対原則」3:
 *   「ユーザーから実プレイの不具合報告が来たら、まず再現するテストを書いて赤くする。推測で直さない。」
 *
 * ここは**意図的に「味方が普通の位置にいる」状態**で組む。既存の
 * `tests/sim/possessionOps.test.ts` は22人を遠方へ退避させた無菌室で組まれており、
 * だからこそ20周目のプローブでは全操作が「発動する」と判定されていた。
 * 実プレイで壊れているのに緑だった原因がそこにあるので、同じ組み方をしてはいけない。
 */

function btn(held: Partial<Record<keyof ButtonState, boolean>>): ButtonState {
  return { ...emptyButtonState(), ...held } as ButtonState;
}
function inp(direction: Direction8, held: Partial<Record<keyof ButtonState, boolean>> = {}) {
  return { direction, buttons: btn(held) };
}
function ballSpeed(s: GameState): number {
  return Math.hypot(toFloat(s.ball.vel.x), toFloat(s.ball.vel.y));
}

/** Team A のフィールドプレイヤー。GK(index 0)ではないことが重要。 */
const CARRIER = TeamId.A * 11 + 9;

/**
 * 通常の陣形のまま、操作選手だけがボールを足元に持っている状態。
 * 味方も相手も**動かさず消さず**、初期フォーメーションのまま置いておく。
 */
function carryingInFormation(facing: Direction8 = Direction8.Up, offsideEnabled = false): GameState {
  const base = createInitialState(1, { difficulty: 'easy', offsideEnabled });
  const carrier = base.players[CARRIER]!;
  const pos = { x: carrier.pos.x, y: carrier.pos.y };
  return {
    ...base,
    controlledPlayerIndex: CARRIER,
    ball: { ...base.ball, pos, vel: { x: ZERO_FIXED, y: ZERO_FIXED }, height: ZERO_FIXED, zVel: ZERO_FIXED },
    players: base.players.map((p, i) => (i === CARRIER ? { ...p, facing } : p)),
    lastTouchTeam: TeamId.A,
    lastTouchPlayerIndex: CARRIER,
  };
}

/** B を hold tick 押し続けてから離す。離した「次の」tick の状態を返す。 */
function chargeAndRelease(start: GameState, hold: number, aim: Direction8): GameState {
  let s = start;
  for (let i = 0; i < hold; i++) s = simulate(s, inp(aim, { B: true }));
  return simulate(s, inp(aim));
}

describe('23周目 実機報告の再現', () => {
  describe('【報告3】B長押しのシュートが飛ばない / 浮かない', () => {
    it('溜め無しのBは前方へ飛ぶ（対照。ここが緑でないと以降の比較が成立しない）', () => {
      const after = chargeAndRelease(carryingInFormation(), 1, Direction8.Up);
      expect(ballSpeed(after)).toBeGreaterThan(4);
    });

    it('Bを長押ししたら、離した時にボールが強く飛ぶこと', () => {
      const after = chargeAndRelease(carryingInFormation(), 30, Direction8.Up);
      expect(ballSpeed(after)).toBeGreaterThan(4);
    });

    it('Bの長押しは弾道が立ち、実際に高さが出ること（続編仕様「強く蹴るとふかす」）', () => {
      let s = chargeAndRelease(carryingInFormation(), 30, Direction8.Up);
      expect(toFloat(s.ball.zVel)).toBeGreaterThan(2);
      let maxHeight = 0;
      for (let i = 0; i < 40; i++) {
        s = simulate(s, inp(Direction8.None));
        maxHeight = Math.max(maxHeight, toFloat(s.ball.height));
      }
      // 画面上の持ち上がりは height * 3.2 * スケール。10px あれば 32px 以上動くので視認できる。
      expect(maxHeight).toBeGreaterThan(10);
    });

    /**
     * ★実機で壊れたのはこの順序★ 「止まった状態から溜める」のではなく
     * 「ドリブルで走りながら溜めて離す」。実プレイでこれ以外の撃ち方はしない。
     */
    it('ドリブルで走りながらBを長押しして離しても、ボールが飛ぶこと', () => {
      let s = carryingInFormation();
      // まず30tick 素でドリブルして、ボールが転がっている状態を作る
      for (let i = 0; i < 30; i++) s = simulate(s, inp(Direction8.Up));
      const dribbling = ballSpeed(s);
      expect(dribbling).toBeGreaterThan(0.5); // 前提: 実際に転がっている

      // 走ったまま B を30tick溜めて離す
      for (let i = 0; i < 30; i++) s = simulate(s, inp(Direction8.Up, { B: true }));
      const chargeAtRelease = s.players[s.controlledPlayerIndex]!.kickChargeFrames;
      s = simulate(s, inp(Direction8.Up));

      expect(chargeAtRelease).toBeGreaterThan(20);
      expect(ballSpeed(s)).toBeGreaterThan(4);
    });

    it('ドリブルで走りながら撃ったBの長押しも、弾道が立って高さが出ること', () => {
      let s = carryingInFormation();
      for (let i = 0; i < 30; i++) s = simulate(s, inp(Direction8.Up));
      for (let i = 0; i < 30; i++) s = simulate(s, inp(Direction8.Up, { B: true }));
      s = simulate(s, inp(Direction8.Up));
      let maxHeight = 0;
      for (let i = 0; i < 40; i++) {
        s = simulate(s, inp(Direction8.None));
        maxHeight = Math.max(maxHeight, toFloat(s.ball.height));
      }
      expect(maxHeight).toBeGreaterThan(10);
    });

    it('★オフサイドON（実機の既定）でも、ドリブルからのB長押しが飛ぶこと', () => {
      let s = carryingInFormation(Direction8.Up, true);
      for (let i = 0; i < 30; i++) s = simulate(s, inp(Direction8.Up));
      for (let i = 0; i < 30; i++) s = simulate(s, inp(Direction8.Up, { B: true }));
      s = simulate(s, inp(Direction8.Up));
      expect(s.setPieceLock?.kind ?? null).toBeNull();
      expect(ballSpeed(s)).toBeGreaterThan(4);
    });

    it('溜めている間、溜めフレームが実際に積み上がること', () => {
      let s = carryingInFormation();
      const charges: number[] = [];
      for (let i = 0; i < 30; i++) {
        s = simulate(s, inp(Direction8.Up, { B: true }));
        charges.push(s.players[s.controlledPlayerIndex]!.kickChargeFrames);
      }
      expect(Math.max(...charges)).toBeGreaterThan(20);
    });
  });
});
