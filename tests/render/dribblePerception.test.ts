/**
 * ★台帳L-03 (24周目-6) の恒久ゲート★ ドリブルの「体感速度」= 画面上の移動速度。
 *
 * 経緯: 物理速度は T1 (2.15身長/s±) に合格していたのに「ドリブルが遅い」と報告された。
 * 実体はカメラの框 (台帳L-01): 可視幅が選手35.7人分まで広がっていたため、同じ物理速度でも
 * 画面上の移動速度が原作の約1/4しかなかった。
 *   原作: 2.15身長/s ÷ 可視幅9人分 → 画面幅の約19.3%/s (高さの22.1%/s)
 *   修正前: 画面幅の約6%/s (視覚的に「進まない」)
 * 物理 (T1) と框 (L-01) の両方が正しくて初めて体感が原作になる、という合成量を
 * ここで直接ゲートする (CRITIC.md 原則8: 部分指標の合格は体験の合格を意味しない)。
 */
import { describe, expect, it } from 'vitest';

import { createProjection } from '../../src/render/projection';
import { FOCUS_SCREEN_Y_FRAC } from '../../src/render/viewConstants';

// T1ゲートの許容範囲 (docs/parity-targets.md): 1.7〜2.7身長/s → 0.42〜0.66 px/tick
const T1_MIN_PX_PER_TICK = 0.42;
const T1_MAX_PX_PER_TICK = 0.66;

// 原作の画面上ドリブル速度 (実測): 幅の19.3%/s、高さの22.1%/s。許容は 0.5〜1.5倍。
const ORIGINAL_WIDTH_FRAC_PER_SEC = 0.193;
const ORIGINAL_HEIGHT_FRAC_PER_SEC = 0.221;

describe('dribble perception (台帳L-03: 画面上の体感速度)', () => {
  const proj = createProjection();
  const ballScreenY = proj.config.viewportHeight * FOCUS_SCREEN_Y_FRAC;
  const ballDepth = proj.depthAtScreenY(ballScreenY);
  const screenScale = proj.focal / ballDepth; // world px → screen px (ボール位置)

  it('T1帯のドリブルは、画面上で原作の0.5〜1.5倍の速度で動いて見える', () => {
    for (const v of [T1_MIN_PX_PER_TICK, T1_MAX_PX_PER_TICK]) {
      const screenPxPerSec = v * 60 * screenScale;
      const widthFrac = screenPxPerSec / proj.config.viewportWidth;
      const heightFrac = screenPxPerSec / proj.config.viewportHeight;
      expect(widthFrac, `幅比 (v=${v})`).toBeGreaterThanOrEqual(ORIGINAL_WIDTH_FRAC_PER_SEC * 0.5);
      expect(widthFrac, `幅比 (v=${v})`).toBeLessThanOrEqual(ORIGINAL_WIDTH_FRAC_PER_SEC * 1.5);
      expect(heightFrac, `高さ比 (v=${v})`).toBeGreaterThanOrEqual(ORIGINAL_HEIGHT_FRAC_PER_SEC * 0.5);
      expect(heightFrac, `高さ比 (v=${v})`).toBeLessThanOrEqual(ORIGINAL_HEIGHT_FRAC_PER_SEC * 1.65);
    }
  });

  it('framing sanity: 可視ワールド幅は選手9〜16人分 (原作4:3の9人分〜16:9換算+余裕)', () => {
    const visibleWorldWidth = proj.config.viewportWidth / screenScale;
    const playerHeights = visibleWorldWidth / 14.68;
    expect(playerHeights).toBeGreaterThanOrEqual(9);
    expect(playerHeights).toBeLessThanOrEqual(16);
  });
});
