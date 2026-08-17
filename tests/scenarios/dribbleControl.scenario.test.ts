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
   * ★不具合#7の再現シナリオ → サイクル①(テンポ変更)で成立し昇格★
   * 旧テンポでは、ニュートラルで追従サーボが止まった後もボールが3.6px/tick级で転がり続け、
   * 4tickで足元から離れ8tickで保持を失っていた。テンポ変更(ドリブル速度0.63px/tick +
   * 摩擦0.985→0.968)により、ニュートラル中のボールは十数pxで減衰静止し、保持半径内に留まる。
   * 根本原因(ニュートラル時のサーボ完全停止)自体はサイクル②の離散タッチ化で置き換える。
   */
  it('S-D3: ドリブル中のニュートラル介在(30tick)でもボールを失わない [不具合#7→①で解消]', () => {
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
