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
   * ★parity-targets.md K2 のゲート → サイクル③で解消し昇格★ 続編公式「押す長さがそのまま
   * ボールの強さになる」。HIGH_ARC_SPEED_MULTIPLIER 0.7→1.4 で最大溜めの合成初速は
   * タップの約1.55倍になった (原作実測の分布 p25 6.9〜p75 16.0身長/s ≈2.3倍と整合)。
   * 統計ゲートへの影響はサイクル③末の全数スイープで吸収した (20周目の教訓どおりセットで実施)。
   */
  it('S-K4: 最大溜めの蹴りの強さ(水平+垂直の合成初速)はタップの1.5〜2.0倍 [K2ゲート→③で解消]', () => {
    const speedOf = (chargeTicks: number) => {
      const { trace } = kickWithCharge(chargeTicks);
      // サイクル③追従: 発射は解放から KICK_WINDUP_TICKS(6) 後 (不具合#4)。発射直後の
      // 合成初速 (水平 + 上昇率で近似) を発射tick近傍の最大値で取る。
      const fire = chargeTicks + 6;
      let best = 0;
      for (let i = fire; i < Math.min(fire + 4, trace.length - 1); i++) {
        const vz = Math.max(0, trace[i + 1]!.ballHeight - trace[i]!.ballHeight);
        best = Math.max(best, Math.hypot(trace[i + 1]!.ballSpeed, vz));
      }
      return best;
    };
    const ratio = speedOf(30) / speedOf(2);
    expect(ratio, '溜めても蹴りが強くならない').toBeGreaterThanOrEqual(1.5);
    expect(ratio, '溜めの強さが過剰').toBeLessThanOrEqual(2.0);
  });
});
