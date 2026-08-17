import { describe, expect, it } from 'vitest';
import { Direction8 } from '../../src/input/types';
import { humanCarrying, runScript, step } from './harness';

/**
 * シナリオ: 通常ドリブルの成立 (直進・方向転換・ニュートラル介在)。
 * 成立条件は「操作した本人がボールを失わないこと」。
 * parity-targets.md D1 (ボール〜足元距離) / 不具合#7 (ニュートラルでボールが離れる) に対応。
 */

/** トレースから「touch-priorityを失っていた最長連続tick数」を出す。 */
function longestLossStreak(trace: readonly { holderIndex: number | null; controlledIndex: number }[]): number {
  let longest = 0;
  let cur = 0;
  for (const t of trace) {
    if (t.holderIndex !== t.controlledIndex) {
      cur++;
      longest = Math.max(longest, cur);
    } else {
      cur = 0;
    }
  }
  return longest;
}

describe('シナリオ: 通常ドリブル', () => {
  it('S-D1: 直進500tickでボールを失わない (瞬間的な離れは12tick未満)', () => {
    // 開始位置は南端付近 (y=1700)。500tick × 3px/tick = 1500px 前進してもピッチ内に収まる
    // (北端まで走り切るとゴールライン越えの境界イベントが発生し、保持喪失が判定を汚す)。
    const { trace } = runScript(humanCarrying(undefined, 240, 1700), [step(500, Direction8.Up)]);
    expect(longestLossStreak(trace), '直進ドリブルで保持を失った').toBeLessThan(12);
    const maxGap = Math.max(...trace.map((t) => t.carrierGap));
    expect(maxGap, 'ボールが射程(30px)の外へ逃げた').toBeLessThanOrEqual(30);
  });

  it('S-D2: 8方向の方向転換を繰り返してもボールを失わない', () => {
    const { trace } = runScript(humanCarrying(undefined, 240, 1200), [
      step(90, Direction8.Up),
      step(60, Direction8.UpRight),
      step(60, Direction8.Left),
      step(60, Direction8.Up),
      step(60, Direction8.Right),
      step(60, Direction8.UpLeft),
      step(60, Direction8.Down), // 反転を含む
      step(90, Direction8.Up),
    ]);
    expect(longestLossStreak(trace), '方向転換でボールを置き去りにした').toBeLessThan(12);
    const maxGap = Math.max(...trace.map((t) => t.carrierGap));
    expect(maxGap, '方向転換でボールが射程の外へ逃げた').toBeLessThanOrEqual(30);
  });

  /**
   * ★不具合#7の再現シナリオ★ ドリブル中に十字キーを離す(ニュートラル)と、追従サーボが
   * 完全停止しボールだけが転がり続けて保持を失う (凍結文書: 4tickで足元から離れ8tickでロスト)。
   * 原作のドリブルは離散タッチなので、手を離してもボールは摩擦で減速してその場に残り、
   * 選手が追いつける。修正(離散タッチ化 or ニュートラル時の減衰)後に it へ昇格すること。
   */
  it.fails('S-D3: ドリブル中のニュートラル介在(30tick)でもボールを失わない [不具合#7]', () => {
    const { trace } = runScript(humanCarrying(undefined, 240, 1200), [
      step(60, Direction8.Up),
      step(30, Direction8.None), // 手を離す
      step(60, Direction8.Up),   // 再開
    ]);
    expect(longestLossStreak(trace), 'ニュートラル介在で保持を失った').toBeLessThan(20);
    const maxGap = Math.max(...trace.map((t) => t.carrierGap));
    expect(maxGap, 'ニュートラル中にボールが逃げた').toBeLessThanOrEqual(30);
  });
});
