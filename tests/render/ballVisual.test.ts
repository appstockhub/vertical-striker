/**
 * ★台帳L-02 (ボールの影) の恒久ゲート★
 *
 * 原作の正解挙動 (docs/visual-behavior-audit.md 2-2節):
 *   - 浮遊中も濃い楕円影が地面に常時追従する (vf1876-1904)。影は消えない
 *   - ボール本体は高度に応じて地上の約2.5〜3倍まで拡大する (vf690)
 *   - 高さの手がかりは「影と本体の分離距離」+「本体の拡大」
 *
 * 24周目-6以前の実装は影を高さに応じて縮小+透明化しており (最大高さで α=0.126、
 * 実質不可視)、「ボールに影がない」という実プレイ報告の実体だった。
 */
import { describe, expect, it } from 'vitest';

import { BALL_SHADOW_ALPHA, computeBallVisual } from '../../src/render/ballVisual';

// ボールの最大高さ (ballConstants の zVel 上限から決まる実測値、docs/screen-geometry.md D-3)
const MAX_BALL_HEIGHT_PX = 52;

describe('ball visual (台帳L-02: 浮き球の影と拡大)', () => {
  it('影の不透明度は高さによらず一定 (浮き球ほど影が消える、が再発しないこと)', () => {
    for (const h of [0, 5, 15, 30, MAX_BALL_HEIGHT_PX]) {
      const v = computeBallVisual(h, 0.6);
      expect(v.shadowAlpha).toBe(BALL_SHADOW_ALPHA);
      expect(v.shadowAlpha).toBeGreaterThanOrEqual(0.3); // 「濃い」影であること
    }
  });

  it('影の縮小は最大高さでも20%以内 (影が常時見えていること)', () => {
    const ground = computeBallVisual(0, 0.6);
    const top = computeBallVisual(MAX_BALL_HEIGHT_PX, 0.6);
    expect(top.shadowScale / ground.shadowScale).toBeGreaterThanOrEqual(0.8);
  });

  it('本体は最大高さで地上の2.2〜3.2倍に拡大する (原作実測 約2.5〜3倍)', () => {
    const ground = computeBallVisual(0, 0.6);
    const top = computeBallVisual(MAX_BALL_HEIGHT_PX, 0.6);
    const grow = top.bodyScale / ground.bodyScale;
    expect(grow).toBeGreaterThanOrEqual(2.2);
    expect(grow).toBeLessThanOrEqual(3.2);
  });

  it('高さゼロでも影はボールの真下に僅かに覗く (接地時の縁、vf2058)', () => {
    const v = computeBallVisual(0, 0.6);
    expect(v.shadowOffsetY).toBeGreaterThan(0);
    expect(v.liftPx).toBe(0);
  });
});
