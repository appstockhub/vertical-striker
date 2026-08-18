/**
 * ★台帳L-05 (24周目-6) の恒久ゲート (render側)★ GKのセーブポーズ。
 * 原作の遷移 (vf3829-3851): 水平ダイブ → 倒れ込み維持(約0.5秒) → 起き上がり → 直立。
 */
import { describe, expect, it } from 'vitest';

import { computeGkPose } from '../../src/render/gkPose';

describe('GK save pose (台帳L-05)', () => {
  it('パンチ直後は水平に倒れる (ダイブ)', () => {
    const pose = computeGkPose(0, 'gkPunch', 1);
    expect(pose.active).toBe(true);
    expect(Math.abs(pose.angle)).toBeGreaterThanOrEqual(70); // ほぼ水平
  });

  it('倒れ込みは約0.5秒維持され、その後 膝立ち → 直立と多段階で復帰する', () => {
    // 0.4秒後 (24tick): まだ倒れている
    expect(Math.abs(computeGkPose(24, 'gkPunch', 1).angle)).toBeGreaterThanOrEqual(70);
    // 倒れ→起き上がりの中間姿勢が存在する (瞬間起立しない)
    const mid = computeGkPose(35, 'gkPunch', 1);
    expect(mid.active).toBe(true);
    expect(Math.abs(mid.angle)).toBeGreaterThan(0);
    expect(Math.abs(mid.angle)).toBeLessThan(70);
    // 十分経てば直立へ戻る
    expect(computeGkPose(60, 'gkPunch', 1).active).toBe(false);
  });

  it('倒す向きはボールが来た側に従う', () => {
    expect(computeGkPose(0, 'gkPunch', 1).angle).toBeGreaterThan(0);
    expect(computeGkPose(0, 'gkPunch', -1).angle).toBeLessThan(0);
  });

  it('キャッチは倒れない (立ったまま確保 = gkHold中のボール描画が保持を表す)', () => {
    expect(computeGkPose(0, 'gkCatch', 1).active).toBe(false);
    expect(computeGkPose(10, 'gkCatch', 1).angle).toBe(0);
  });

  it('イベント未発生 (負のframesSince) では何もしない', () => {
    expect(computeGkPose(-1, 'gkPunch', 1).active).toBe(false);
  });
});
