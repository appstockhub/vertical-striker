import { describe, expect, it } from 'vitest';
import { createProjection, DEFAULT_PROJECTION_CONFIG } from '../../src/render/projection';
import { PITCH_HEIGHT, PITCH_WIDTH, VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from '../../src/config/pitch';
import {
  FOCUS_SCREEN_Y_FRAC,
  PLAYER_SIZE_BOOST,
  PLAYER_SPRITE_FIGURE_HEIGHT,
} from '../../src/render/viewConstants';
import { GOAL_WIDTH_FIXED } from '../../src/sim/goalkeeperConstants';
import { toFloat } from '../../src/core/fixed';

const GOAL_WIDTH_PX = toFloat(GOAL_WIDTH_FIXED);

/**
 * ★段階1 (ピッチスケールとカメラの確定) の計測ツール★
 *
 * 原作スクリーンショットから目視で測れるのと「同じ項目」を、自作の投影パラメータから
 * 解析的に算出する。目的は「原作と自作を同じ物差しで並べる」こと。
 *
 * `npm run view:metrics` で人間可読の表を出す。パラメータを変えたら必ず再実行し、
 * docs/screen-geometry.md の対比表を更新すること。
 *
 * 注: ここは計測専用でアサートは最小限 (投影が破綻していないことだけ確認する)。
 * 数値の良し悪しは人間が原作と見比べて判断する。
 */

/** ピッチ幅を実寸 68m と見なした時の px/m。深さを「m換算」で語るための唯一の物差し。 */
const PX_PER_METER = PITCH_WIDTH / 68;

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}
function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** 選手スプライトの見かけの高さ (画面px)。描画側と同じ式。 */
function playerScreenHeight(scale: number): number {
  return PLAYER_SPRITE_FIGURE_HEIGHT * scale * PLAYER_SIZE_BOOST;
}

describe('view metrics (段階1: 原作比較用の画面ジオメトリ計測)', () => {
  const projection = createProjection(DEFAULT_PROJECTION_CONFIG);
  const cfg = DEFAULT_PROJECTION_CONFIG;
  const focusScreenY = VIEWPORT_HEIGHT * FOCUS_SCREEN_Y_FRAC;

  it('prints the screen geometry table', () => {
    // ボールがピッチ中央にある時のカメラ位置を基準にする (最も一般的な構図)。
    const ballWorldY = PITCH_HEIGHT / 2;
    const camWorldY = projection.cameraWorldYFor(ballWorldY, focusScreenY);

    const depthAt = (screenY: number) => projection.depthAtScreenY(screenY);
    const worldYAt = (screenY: number) => camWorldY - depthAt(screenY);

    const lines: string[] = [];
    const push = (label: string, value: string) => lines.push(`  ${label.padEnd(46)} ${value}`);

    lines.push('=== 画面ジオメトリ (自作) ===');
    push('ビューポート', `${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}`);
    push('ピッチ論理寸法 (幅x長さ)', `${PITCH_WIDTH}x${PITCH_HEIGHT} (1:${fmt(PITCH_HEIGHT / PITCH_WIDTH, 2)})`);
    push('  ↑実寸換算 (幅68m基準)', `68m x ${fmt(PITCH_HEIGHT / PX_PER_METER)}m`);
    push('地平線の画面Y比', `${pct(cfg.horizonY / VIEWPORT_HEIGHT)} (y=${cfg.horizonY})`);
    push('ボール(注視点)の画面Y比', `${pct(FOCUS_SCREEN_Y_FRAC)} (y=${fmt(focusScreenY, 0)})`);
    push('focal / カメラ高さ', `${fmt(projection.focal)} / ${fmt(projection.camHeight)}`);

    lines.push('');
    lines.push('--- 一度に見えるピッチの範囲 ---');
    const depthBottom = depthAt(VIEWPORT_HEIGHT);
    const depthBall = depthAt(focusScreenY);
    // 「実用的な奥の限界」= 選手の見かけ高さが画面の2%を切る深さ (それ以上奥は識別不能)。
    const minUsefulHeight = VIEWPORT_HEIGHT * 0.02;
    const usefulScale = minUsefulHeight / (PLAYER_SPRITE_FIGURE_HEIGHT * PLAYER_SIZE_BOOST);
    const depthUseful = (cfg.nearDepth / usefulScale);
    push('画面下端の奥行き (near)', `${fmt(depthBottom)}px = ${fmt(depthBottom / PX_PER_METER)}m`);
    push('ボール位置の奥行き', `${fmt(depthBall)}px = ${fmt(depthBall / PX_PER_METER)}m`);
    push('選手が識別できる奥の限界(高さ2%)', `${fmt(depthUseful)}px = ${fmt(depthUseful / PX_PER_METER)}m`);
    push('  ↑その時の画面Y比', pct(projection.project(PITCH_WIDTH / 2, camWorldY - depthUseful, camWorldY).y / VIEWPORT_HEIGHT));
    const visibleDepth = depthUseful - depthBottom;
    push('★実用的に見えるピッチの奥行き', `${fmt(visibleDepth)}px = ${fmt(visibleDepth / PX_PER_METER)}m`);
    push('  ↑ピッチ全長に占める割合', pct(visibleDepth / PITCH_HEIGHT));

    lines.push('');
    lines.push('--- 選手の見かけサイズ ---');
    const scaleBottom = projection.scaleAtDepth(depthBottom);
    const scaleBall = projection.scaleAtDepth(depthBall);
    const scaleFar = projection.scaleAtDepth(depthUseful);
    push('手前(画面下端)の選手の高さ', `${fmt(playerScreenHeight(scaleBottom))}px = ${pct(playerScreenHeight(scaleBottom) / VIEWPORT_HEIGHT)}`);
    push('ボール位置の選手の高さ', `${fmt(playerScreenHeight(scaleBall))}px = ${pct(playerScreenHeight(scaleBall) / VIEWPORT_HEIGHT)}`);
    push('奥の限界の選手の高さ', `${fmt(playerScreenHeight(scaleFar))}px = ${pct(playerScreenHeight(scaleFar) / VIEWPORT_HEIGHT)}`);
    push('★手前/奥のサイズ比 (下端 vs 限界)', `${fmt(scaleBottom / scaleFar, 2)}x`);

    lines.push('');
    lines.push('--- ゴールの見かけ幅 ---');
    for (const [label, dist] of [
      ['ゴールライン上 (距離0)', 0],
      ['PKスポット相当 (110px)', 110],
      ['ペナルティエリア角 (168px)', 168],
      ['ハーフウェー付近 (900px)', 900],
    ] as const) {
      // ボールが dist だけゴールから離れている時のカメラで、ゴール幅が画面幅の何%に見えるか。
      const cam = projection.cameraWorldYFor(dist, focusScreenY);
      const goalDepth = cam - 0;
      if (goalDepth <= cfg.minDepth) {
        push(label, '(カメラの手前で投影不能)');
        continue;
      }
      const left = projection.project(PITCH_WIDTH / 2 - GOAL_WIDTH_PX / 2, 0, cam);
      const right = projection.project(PITCH_WIDTH / 2 + GOAL_WIDTH_PX / 2, 0, cam);
      const widthPx = right.x - left.x;
      push(label, `${fmt(widthPx)}px = ${pct(widthPx / VIEWPORT_WIDTH)} (ゴール画面Y ${pct(left.y / VIEWPORT_HEIGHT)})`);
    }

    lines.push('');
    lines.push('--- ピッチ幅の見かけ ---');
    for (const [label, screenY] of [
      ['画面下端', VIEWPORT_HEIGHT],
      ['ボール位置', focusScreenY],
      ['画面中央', VIEWPORT_HEIGHT / 2],
    ] as const) {
      const d = depthAt(screenY);
      const halfW = (projection.focal * (PITCH_WIDTH / 2)) / d;
      push(`${label} でのピッチ幅`, `${fmt(halfW * 2)}px = 画面幅の ${pct((halfW * 2) / VIEWPORT_WIDTH)}`);
    }

    console.log('\n' + lines.join('\n') + '\n');

    // 破綻していないことだけ確認する (数値の良し悪しは人間が判断)。
    expect(projection.focal).toBeGreaterThan(0);
    expect(projection.camHeight).toBeGreaterThan(0);
    expect(worldYAt(VIEWPORT_HEIGHT)).toBeLessThan(camWorldY);
  });
});
