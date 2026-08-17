import { describe, expect, it } from 'vitest';
import { Direction8 } from '../../src/input/types';
import { humanCarrying, runScript, step } from './harness';

/**
 * シナリオ: 蹴り出しドリブル (L+R同時押し → 片方ホールドで継続)。
 * parity-targets.md D3/D4、不具合#6 に対応。
 *
 * 原作実測 (2標本の範囲): 蹴り出しでボールが 0.8〜1.8身長 (12〜26px) 先まで離れ、
 * 0.3〜0.9秒 (18〜54tick) で追いつく離散サイクル。
 * 現行実装は「追従サーボの目標距離が16pxへ変わる」だけで、蹴り出しの離散性が無い
 * (実際に蹴り出すコードはデッドコード)。
 */

describe('シナリオ: 蹴り出しドリブル', () => {
  /**
   * ★不具合#6の再現シナリオ → サイクル②(離散タッチ化)で成立し昇格★
   * 旧実装は蹴り出しコードがデッドコードで、追従サーボの16px目標に張り付くだけだった。
   * 新実装 (KICKOUT_IMPULSE_SPEED=2.0のインパルス) のプローブ実測: 最大ギャップ19.7px・
   * 追いつき19tick = 原作実測 D3 (12〜26px) / D4 (18〜54tick) の範囲内。
   * 判定は「離散性」そのもの:
   *  1. トリガー後、ボールが17px超まで離れる (旧サーボ上限16pxでは到達不能な値)
   *  2. その後54tick以内に10px以下まで追いつく (蹴る→追う→また触る、のサイクル)
   */
  it('S-KD1: L+R同時押しで蹴り出し→追いつきの離散サイクルが起きる [不具合#6→②で解消]', () => {
    const { trace } = runScript(humanCarrying(undefined, 240, 1400), [
      step(30, Direction8.Up), // 通常ドリブルで助走
      step(1, Direction8.Up, { L: true, R: true }), // L+R同時押し = 蹴り出しトリガー
      step(80, Direction8.Up, { L: true }), // Lホールドで継続、追走
    ]);
    const afterTrigger = trace.slice(31);
    const maxGap = Math.max(...afterTrigger.map((t) => t.carrierGap));
    expect(maxGap, '蹴り出してもボールが17px超まで離れない(インパルス不在)').toBeGreaterThan(17);

    // 最大ギャップの後、54tick以内に10px以下へ追いつく
    const peakIdx = afterTrigger.findIndex((t) => t.carrierGap === maxGap);
    const chase = afterTrigger.slice(peakIdx, peakIdx + 54);
    const caughtUp = chase.some((t) => t.carrierGap <= 10);
    expect(caughtUp, '蹴り出したボールに54tick以内で追いつけない').toBe(true);
  });

  /** 蹴り出し中でも保持権を完全に失わないこと (転がり去らない)。現行の追従モデルでも成立。 */
  it('S-KD2: L+Rドリブル中にボールが転がり去らない (最大でも40px以内)', () => {
    const { trace } = runScript(humanCarrying(undefined, 240, 1400), [
      step(30, Direction8.Up),
      step(1, Direction8.Up, { L: true, R: true }),
      step(120, Direction8.Up, { L: true }),
    ]);
    const maxGap = Math.max(...trace.map((t) => t.carrierGap));
    expect(maxGap, '蹴り出しドリブルでボールが行方不明になった').toBeLessThanOrEqual(40);
  });
});
