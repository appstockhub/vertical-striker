import { describe, expect, it } from 'vitest';
import { Direction8 } from '../../src/input/types';
import { humanCarrying, runScript, step } from './harness';

/**
 * シナリオ: B溜めで弾道が変わる (続編仕様「押下時間で強さ+弾道が連動」)。
 * parity-targets.md K2、不具合#3 (B長押しで浮かない → sim単体では再現せず) に対応。
 */

/** B を chargeTicks 押してから離し、その後60tick放置したトレースを返す。 */
function kickWithCharge(chargeTicks: number) {
  return runScript(humanCarrying(undefined, 240, 1400), [
    step(chargeTicks, Direction8.Up, { B: true }),
    step(1, Direction8.Up), // 解放 = このtickでキック
    step(60, Direction8.None),
  ]);
}

describe('シナリオ: B溜めと弾道', () => {
  it('S-K1: Bタップ(2tick)は低い弾道 (ボールがほぼ浮かない)', () => {
    const { trace } = kickWithCharge(2);
    const maxHeight = Math.max(...trace.map((t) => t.ballHeight));
    expect(maxHeight, 'タップキックが高く浮きすぎ').toBeLessThan(8);
  });

  it('S-K2: B長押し(30tick)は高い弾道に浮く [不具合#3の回帰ゲート]', () => {
    // 23周目の調査で「sim単体では正常に浮く」ことを確認済み (reportedBugs23.test.ts)。
    // ここではシナリオとして固定し、二度と壊れないようにする (ラチェット)。
    const { trace } = kickWithCharge(30);
    const maxHeight = Math.max(...trace.map((t) => t.ballHeight));
    expect(maxHeight, 'B長押しでもボールが浮かない').toBeGreaterThan(20);
  });

  it('S-K3: 溜めるほど弾道が高くなる (2tick < 15tick < 30tick)', () => {
    const h = (ticks: number) => {
      const { trace } = kickWithCharge(ticks);
      return Math.max(...trace.map((t) => t.ballHeight));
    };
    const h2 = h(2);
    const h15 = h(15);
    const h30 = h(30);
    expect(h15, '中溜めがタップより浮かない').toBeGreaterThan(h2);
    expect(h30, '最大溜めが中溜めより浮かない').toBeGreaterThan(h15);
  });

  /**
   * ★parity-targets.md K2 のゲート★ 続編仕様「押す長さがそのままボールの強さになる」。
   * 原作実測: キック初速の分布はp25 6.9 → p75 16.0身長/s と広い = 強いキックは弱いキックの
   * 約2倍出ている。現行実装は最大溜めで総合パワーが**下がる** (8.82→8.46、仕様と逆)。
   * テンポ再調整(サイクル①)で直したら it へ昇格すること。
   * 注: 20周目に「これを直すと観戦シミュレーターの正常性基準が3件落ちる」ことを実測済み。
   * AIしきい値の連動調整とセットで直すこと (CRITIC.md 原則5の「不可分な場合」に該当)。
   */
  it.fails('S-K4: 最大溜めの蹴りの強さ(水平+垂直の合成初速)はタップの1.5〜2.0倍 [K2ゲート]', () => {
    const speedOf = (chargeTicks: number) => {
      const { trace } = kickWithCharge(chargeTicks);
      // 解放tick直後の合成初速 (水平 + 上昇率で近似)
      const release = trace[chargeTicks]!; // 解放tickの観測
      const next = trace[chargeTicks + 1]!;
      const vz = Math.max(0, next.ballHeight - release.ballHeight);
      return Math.hypot(next.ballSpeed, vz);
    };
    const ratio = speedOf(30) / speedOf(2);
    expect(ratio, '溜めても蹴りが強くならない').toBeGreaterThanOrEqual(1.5);
    expect(ratio, '溜めの強さが過剰').toBeLessThanOrEqual(2.0);
  });
});
