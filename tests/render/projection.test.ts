import { describe, expect, it } from 'vitest';
import { createProjection, DEFAULT_PROJECTION_CONFIG } from '../../src/render/projection';
import { PITCH_WIDTH, VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from '../../src/config/pitch';

/**
 * 疑似3D投影 (src/render/projection.ts) のユニットテスト。
 * 描画専用レイヤーだが、「台形になっているか」「奥ほど小さいか」は数式で検証できるため、
 * 目視に頼らずここで固定しておく (ブラウザでの目視は最終確認としてのみ使う)。
 */

const proj = createProjection();
const cfg = DEFAULT_PROJECTION_CONFIG;
/** カメラ: ワールドY=1000 の地点が near (画面下端) に来る位置。 */
const CAM_Y = 1000 + cfg.nearDepth;

describe('透視投影の基本性質', () => {
  it('near (画面下端) の奥行きが画面下端に写る', () => {
    const p = proj.project(PITCH_WIDTH / 2, 1000, CAM_Y);
    expect(p.visible).toBe(true);
    expect(p.y).toBeCloseTo(VIEWPORT_HEIGHT, 3);
    expect(p.x).toBeCloseTo(VIEWPORT_WIDTH / 2, 3);
    expect(p.scale).toBeCloseTo(1, 6);
  });

  it('奥へ行くほど画面上へ、地平線に収束する (超えない)', () => {
    const near = proj.project(240, 1000, CAM_Y);
    const mid = proj.project(240, 600, CAM_Y);
    const far = proj.project(240, 0, CAM_Y);
    expect(mid.y).toBeLessThan(near.y);
    expect(far.y).toBeLessThan(mid.y);
    expect(far.y).toBeGreaterThan(cfg.horizonY);
  });

  it('奥へ行くほど小さくなる (スケール)', () => {
    const near = proj.project(240, 1000, CAM_Y).scale;
    const mid = proj.project(240, 600, CAM_Y).scale;
    const far = proj.project(240, 0, CAM_Y).scale;
    expect(mid).toBeLessThan(near);
    expect(far).toBeLessThan(mid);
    expect(far).toBeGreaterThan(0);
  });

  it('★台形★ 同じピッチ幅が、奥ほど画面上で狭く写る', () => {
    const widthAt = (worldY: number): number =>
      proj.project(PITCH_WIDTH, worldY, CAM_Y).x - proj.project(0, worldY, CAM_Y).x;
    const nearWidth = widthAt(1000);
    const midWidth = widthAt(600);
    const farWidth = widthAt(200);
    expect(midWidth).toBeLessThan(nearWidth);
    expect(farWidth).toBeLessThan(midWidth);
    // near のタッチラインは設定どおり画面幅の 1.18 倍 (左右が少し画面外)。
    expect(nearWidth).toBeCloseTo(VIEWPORT_WIDTH * cfg.nearWidthRatio, 3);
  });

  it('中央線 (x = ピッチ中央) はどの奥行きでも画面中央に写る (消失点が中央)', () => {
    for (const worldY of [1000, 800, 400, 0, -500]) {
      expect(proj.project(PITCH_WIDTH / 2, worldY, CAM_Y).x).toBeCloseTo(VIEWPORT_WIDTH / 2, 6);
    }
  });

  it('左右対称 (中央からの距離が等しい2点は画面中央から等距離)', () => {
    const left = proj.project(PITCH_WIDTH / 2 - 100, 700, CAM_Y);
    const right = proj.project(PITCH_WIDTH / 2 + 100, 700, CAM_Y);
    expect(VIEWPORT_WIDTH / 2 - left.x).toBeCloseTo(right.x - VIEWPORT_WIDTH / 2, 6);
  });

  it('カメラの手前/後ろは visible=false (投影が発散する領域を描かない)', () => {
    expect(proj.project(240, CAM_Y, CAM_Y).visible).toBe(false);
    expect(proj.project(240, CAM_Y + 100, CAM_Y).visible).toBe(false);
  });
});

describe('逆算ヘルパー', () => {
  it('depthAtScreenY は project の逆になっている', () => {
    const p = proj.project(240, 500, CAM_Y);
    expect(proj.depthAtScreenY(p.y)).toBeCloseTo(p.depth, 3);
  });

  it('cameraWorldYFor は指定ワールドYを指定画面Yに写すカメラ位置を返す', () => {
    const focusWorldY = 900;
    const focusScreenY = VIEWPORT_HEIGHT * 0.62;
    const camY = proj.cameraWorldYFor(focusWorldY, focusScreenY);
    expect(proj.project(240, focusWorldY, camY).y).toBeCloseTo(focusScreenY, 3);
  });

  it('地平線より上は無限遠 (縞やラインの生成ループが止まらなくならないためのガード)', () => {
    expect(proj.depthAtScreenY(cfg.horizonY)).toBe(Infinity);
    expect(proj.depthAtScreenY(cfg.horizonY - 10)).toBe(Infinity);
  });
});
