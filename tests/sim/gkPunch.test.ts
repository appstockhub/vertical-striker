/**
 * ★台帳L-05 (24周目-6) の恒久ゲート (sim側)★ GKのパンチングは「生きたこぼれ球」を作る。
 *
 * 原作の正解挙動 (docs/visual-behavior-audit.md 2-5節、t=144.2-145.6):
 *   - パンチしたボールは前方へ浮いて飛び、こぼれ球の詰め合いが発生する
 * 旧実装の deflected は「地上のまま y符号反転 (速度維持)」で、見た目は
 * 「ボールが勝手に反転した」ようにしか見えず、強シュートがそのままの速度で
 * 戻るため誰も詰められなかった。
 */
import { describe, expect, it } from 'vitest';

import { toFixed, ZERO_FIXED } from '../../src/core/fixed';
import { TeamId, createInitialState } from '../../src/sim/state';
import { applySave } from '../../src/sim/goalkeeperAI';
import { PUNCH_DEFLECT_DAMPING_FIXED, PUNCH_POP_Z_VEL_FIXED } from '../../src/sim/goalkeeperConstants';

describe('GKパンチング (台帳L-05)', () => {
  const base = createInitialState(1, { difficulty: 'medium', offsideEnabled: false });
  const gkA = base.players[0]!; // Team A のGK (前半は北=y小側を守る)

  it('deflected はボールを浮かせる (zVel > 0 の生きたこぼれ球)', () => {
    const shot = {
      pos: gkA.pos,
      vel: { x: toFixed(0.5), y: toFixed(-2.7) }, // 自陣ゴールへ向かう強シュート
      height: ZERO_FIXED,
      zVel: ZERO_FIXED,
    };
    const after = applySave(shot, gkA, 'deflected', 'first');
    expect((after.zVel as number) > 0, 'パンチ後のボールが浮いていない').toBe(true);
    expect(after.zVel).toBe(PUNCH_POP_Z_VEL_FIXED);
  });

  it('deflected は水平速度を減衰させる (強シュートがそのまま戻ると誰も詰められない)', () => {
    const shot = {
      pos: gkA.pos,
      vel: { x: toFixed(0.5), y: toFixed(-2.7) },
      height: ZERO_FIXED,
      zVel: ZERO_FIXED,
    };
    const after = applySave(shot, gkA, 'deflected', 'first');
    const speedBefore = Math.hypot(shot.vel.x as number, shot.vel.y as number);
    const speedAfter = Math.hypot(after.vel.x as number, after.vel.y as number);
    // 減衰係数 (0.6) どおりに落ちること
    expect(speedAfter / speedBefore).toBeCloseTo((PUNCH_DEFLECT_DAMPING_FIXED as number) / 256, 1);
  });

  it('deflected のy速度は自陣ゴールから遠ざかる向き (前半のTeam Aは+y)', () => {
    const shot = {
      pos: gkA.pos,
      vel: { x: ZERO_FIXED, y: toFixed(-2.0) },
      height: ZERO_FIXED,
      zVel: ZERO_FIXED,
    };
    const after = applySave(shot, gkA, 'deflected', 'first');
    expect((after.vel.y as number) > 0, 'こぼれ球が自陣ゴールへ向かっている').toBe(true);
  });

  it('secured (キャッチ) はボールを確保して静止させる (弾きとの明確な区別)', () => {
    const shot = {
      pos: gkA.pos,
      vel: { x: ZERO_FIXED, y: toFixed(-1.0) },
      height: ZERO_FIXED,
      zVel: ZERO_FIXED,
    };
    const after = applySave(shot, gkA, 'secured', 'first');
    expect(after.vel.x).toBe(ZERO_FIXED);
    expect(after.vel.y).toBe(ZERO_FIXED);
    expect(after.zVel).toBe(ZERO_FIXED);
    void TeamId;
  });
});
