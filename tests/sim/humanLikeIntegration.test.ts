import { describe, expect, it } from 'vitest';
import { distSqFixed, toFloat } from '../../src/core/fixed';
import { createRng, nextRangeInt, type RngState } from '../../src/core/rng';
import { createInitialState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { Direction8, emptyButtonState, type ButtonState } from '../../src/input/types';
import { PITCH_HEIGHT } from '../../src/config/pitch';

/**
 * 「無人フルマッチ」の統合テストだけでは実プレイの再現度が不十分だった、というユーザー指摘への
 * 対応 (Phase 3、実プレイでの2度目のバグ報告)。過去2回、統合テストは通っていたのに実プレイでは
 * 壊れている状態が続いた根本原因は、統合テストの人間入力が Direction8.None 固定(完全無操作)
 * だったこと: Team Aの操作選手が本当に一度も動かないシナリオでしか検証していなかったため、
 * 「操作選手がカーソル自動追従で入れ替わった後、キック溜め状態が残ってカーソルが永久に
 * 固定される」バグ等、"人間が実際に動いている"時にしか顕在化しない不具合を検出できなかった。
 *
 * ここでは Math.random() を使わず、既存のsim用PRNG(mulberry32、core/rng.ts)をテストコード側で
 * 流用し、「前進バイアス+たまに他方向/停止/パス/キック」という決定論的な擬似ランダム入力列を
 * 生成する。これは実際にプレイする人間の入力パターン(常に最適操作ではないが、概ね能動的に
 * 動き続ける)を模している。
 */
const DIRECTIONS = [
  Direction8.Up,
  Direction8.UpRight,
  Direction8.Right,
  Direction8.DownRight,
  Direction8.Down,
  Direction8.DownLeft,
  Direction8.Left,
  Direction8.UpLeft,
];

function scriptedHumanInputSequence(seed: number, length: number) {
  let rng: RngState = createRng(seed);
  const seq: Array<{ direction: Direction8; buttons: ButtonState }> = [];
  for (let i = 0; i < length; i++) {
    let roll: number;
    [roll, rng] = nextRangeInt(rng, 0, 100);
    let direction: Direction8;
    if (roll < 45) {
      direction = Direction8.Up; // 前進バイアス (Team Aは半分1で北へ攻める)
    } else if (roll < 90) {
      let dirIdx: number;
      [dirIdx, rng] = nextRangeInt(rng, 0, DIRECTIONS.length);
      direction = DIRECTIONS[dirIdx] as Direction8;
    } else {
      direction = Direction8.None;
    }
    let yRoll: number;
    [yRoll, rng] = nextRangeInt(rng, 0, 100);
    let bRoll: number;
    [bRoll, rng] = nextRangeInt(rng, 0, 100);
    seq.push({ direction, buttons: { ...emptyButtonState(), Y: yRoll < 8, B: bRoll < 8 } });
  }
  return seq;
}

/** ペナルティエリア相当の深さ (ゴールラインからこの距離以内、仮値)。 */
const BOX_DEPTH_FIXED_PX = 150;
/** 「団子」判定の距離しきい値 (px、ユーザー指定)。 */
const DANGO_DISTANCE_PX = 150;
/** この人数以上がボールから離れていれば「団子ではない」(ユーザー指定: 7人以上)。 */
const MIN_PLAYERS_FAR_FROM_BALL = 7;
const MATCH_LENGTH_TICKS = 21600; // 前後半フル (FULL_MATCH_DURATION_FRAMES相当)

describe('simulate — bug regression: scripted human-like input (not fully idle), Team B must advance and must not dogpile', () => {
  // 3シード(単発のラッキーな乱数列に依存しないことを確認するため複数実行)。
  for (const seed of [42, 99, 12345]) {
    it(`seed=${seed}: Team B reaches the penalty box, and the ball is never surrounded by a dogpile`, () => {
      const seq = scriptedHumanInputSequence(seed, MATCH_LENGTH_TICKS);
      let state = createInitialState(1, { difficulty: 'hard' });

      let reachedBox = false;
      let minDangoFarCount = 22; // 各tickでの「ボールから150px以上離れた人数」の最小値を追跡

      for (let i = 0; i < seq.length; i++) {
        state = simulate(state, seq[i]!);

        if (toFloat(state.ball.pos.y) >= PITCH_HEIGHT - BOX_DEPTH_FIXED_PX) {
          reachedBox = true;
        }

        // 序盤(キックオフ直後、全員がホーム位置に密集している立ち上がり)は対象外にする。
        if (i > 100) {
          let farCount = 0;
          for (const player of state.players) {
            const distPx = Math.sqrt(distSqFixed(player.pos, state.ball.pos) as number) / 16;
            if (distPx > DANGO_DISTANCE_PX) farCount++;
          }
          if (farCount < minDangoFarCount) minDangoFarCount = farCount;
        }
      }

      // (a) Team Bが敵陣ペナルティエリアまで到達すること
      expect(reachedBox).toBe(true);
      // (b) 各ティックで「ボールから150px以上離れた選手」が7人以上いること (団子防止)
      expect(minDangoFarCount).toBeGreaterThanOrEqual(MIN_PLAYERS_FAR_FROM_BALL);
    });
  }

  it('is deterministic: the same scripted input sequence always produces the same final state', () => {
    const seq = scriptedHumanInputSequence(42, 3000);
    let stateA = createInitialState(1, { difficulty: 'hard' });
    let stateB = createInitialState(1, { difficulty: 'hard' });
    for (const inputs of seq) {
      stateA = simulate(stateA, inputs);
      stateB = simulate(stateB, inputs);
    }
    expect(stateA).toEqual(stateB);
  });
});
