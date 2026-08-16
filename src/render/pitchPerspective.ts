import Phaser from 'phaser';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';
import type { Projection } from './projection';
import {
  GOAL_DEPTH,
  GOAL_HEIGHT,
  pitchArcPolylines,
  pitchLineSegments,
  pitchSpots,
  STRIPE_DEPTH,
  type WorldSegment,
} from './pitchGeometry';

/**
 * ピッチの疑似3D描画 (毎フレーム、投影しながら描く)。★描画専用★
 *
 * 真上視点の頃はピッチが静的だったので Graphics に1回焼くだけで済んだが、透視投影では
 * カメラが動くたびに台形の形自体が変わるため、毎フレーム描き直す必要がある。
 * 60fps を守るため、プリミティブ数は意図的に抑えている (縞15本 + ライン約30本 +
 * 円弧4本 + ゴール2組)。折れ線は beginPath/lineTo/strokePath でまとめて1ストロークにする。
 */

const TURF_DARK = 0x1c6636;
const TURF_LIGHT = 0x237943;
/**
 * ★段階1★ タッチライン/ゴールラインの外側にも続く芝 (ランオフ)。
 *
 * 原作の画面を測ると、ピッチはほぼ常に画面幅いっぱいを占め、外に出るのは遠方の隅だけで、
 * そこも「暗い虚無」ではなく陸上トラック相当の暖色だった。当実装はピッチ(480px幅)の外側が
 * 一様な暗緑だったため、奥へ行くほどピッチが細い帯に見え、「廊下を走っている」ような
 * 画になっていた (自己観察キャプチャ `.shots/before-*.png`)。
 * 実寸のスタジアム同様、ラインの外にも芝を延ばして画面を埋める。
 */
const TURF_OUTER_DARK = 0x1a6033;
const TURF_OUTER_LIGHT = 0x20703e;
/**
 * ランオフの芝をラインの外へどれだけ延ばすか (ワールドpx)。
 * MAX_DRAW_DEPTH(3200) 相当まで延ばし、通常のカメラ位置では画面が芝で埋まるようにする
 * (外周色が見えるのは、ゴール裏を極端に覗き込んだ時の遠方の隅だけ)。
 */
const RUNOFF_X = 2800;
const RUNOFF_Y = 2800;
/**
 * 描画範囲の外 (地平線のすぐ下、MAX_DRAW_DEPTH より奥) を埋める色。
 * ここは「大気で沈んだ最遠部」であり、地面の色ではなく drawDistanceHaze と同系の暗色に
 * しておくと、芝がそのままスタンドの影へ溶けて見える (原作もピッチの far end が
 * スタンドに接していて、その間に土色の帯は無い)。
 */
const SURROUND_COLOR = 0x0d1622;
const LINE_COLOR = 0xffffff;
const LINE_ALPHA = 0.8;
/** ライン幅は near で 2.5px、奥ほど細くする (遠近感)。 */
const LINE_WIDTH_NEAR = 2.5;
const LINE_WIDTH_MIN = 0.8;

const NET_COLOR = 0xffffff;
const NET_ALPHA = 0.35;
const POST_COLOR = 0xf2f2f2;

/**
 * 描画対象にする最遠の奥行き。これ以上奥は1px以下になり描いても見えない。
 * ★段階1で 3200 → 6000★ 3200 だと地平線の下 55px ぶんが「何も描かれない帯」になり、
 * 芝が途中で切れて土色の帯が出ていた (自己観察キャプチャ after1)。芝をかすみの帯まで
 * 到達させ、そのままスタンドの影へ溶けるようにする。
 */
const MAX_DRAW_DEPTH = 6000;

interface Ctx {
  readonly g: Phaser.GameObjects.Graphics;
  readonly proj: Projection;
  readonly camY: number;
}

/** 線分をカメラ手前の平面でクリップして投影する。両端とも手前なら null。 */
function clipAndProject(
  ctx: Ctx,
  seg: WorldSegment,
): { x1: number; y1: number; x2: number; y2: number; depth: number } | null {
  const { proj, camY } = ctx;
  const minDepth = proj.config.minDepth;
  // depth(y) = camY - y。depth >= minDepth のみ描ける。
  const maxWorldY = camY - minDepth;
  let { x1, y1, x2, y2 } = seg;

  const inside1 = y1 <= maxWorldY;
  const inside2 = y2 <= maxWorldY;
  if (!inside1 && !inside2) return null;
  if (!inside1) {
    const t = (maxWorldY - y2) / (y1 - y2);
    x1 = x2 + (x1 - x2) * t;
    y1 = maxWorldY;
  } else if (!inside2) {
    const t = (maxWorldY - y1) / (y2 - y1);
    x2 = x1 + (x2 - x1) * t;
    y2 = maxWorldY;
  }

  // 奥すぎる側も切る (地平線に貼り付く線を大量に描かない)。
  const minWorldY = camY - MAX_DRAW_DEPTH;
  if (y1 < minWorldY && y2 < minWorldY) return null;

  const p1 = proj.project(x1, y1, camY);
  const p2 = proj.project(x2, y2, camY);
  if (!p1.visible || !p2.visible) return null;
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, depth: Math.min(p1.depth, p2.depth) };
}

/** 奥行きに応じた線幅 (遠いほど細い)。 */
function lineWidthAt(proj: Projection, depth: number): number {
  return Math.max(LINE_WIDTH_MIN, LINE_WIDTH_NEAR * proj.scaleAtDepth(depth));
}

function strokeSegment(ctx: Ctx, seg: WorldSegment, alpha = LINE_ALPHA, color = LINE_COLOR): void {
  const p = clipAndProject(ctx, seg);
  if (!p) return;
  ctx.g.lineStyle(lineWidthAt(ctx.proj, p.depth), color, alpha);
  ctx.g.lineBetween(p.x1, p.y1, p.x2, p.y2);
}

/**
 * 刈り込み縞を、指定のワールドX範囲・Y範囲について台形として塗る。
 * ランオフ(ライン外の芝)と、ピッチ本体で色だけ変えて2回呼ぶ。
 */
function drawStripeBands(
  ctx: Ctx,
  worldLeft: number,
  worldRight: number,
  worldFarY: number,
  worldNearY: number,
  darkColor: number,
  lightColor: number,
): void {
  const { g, proj, camY } = ctx;
  const nearest = Math.min(worldNearY, camY - proj.config.minDepth);
  const farthest = Math.max(worldFarY, camY - MAX_DRAW_DEPTH);
  if (nearest <= farthest) return;

  const firstBand = Math.floor(farthest / STRIPE_DEPTH);
  const lastBand = Math.ceil(nearest / STRIPE_DEPTH);

  for (let band = firstBand; band < lastBand; band++) {
    const yFar = Math.max(farthest, band * STRIPE_DEPTH);
    const yNear = Math.min(nearest, (band + 1) * STRIPE_DEPTH);
    if (yNear <= yFar) continue;

    const farLeft = proj.project(worldLeft, yFar, camY);
    const farRight = proj.project(worldRight, yFar, camY);
    const nearLeft = proj.project(worldLeft, yNear, camY);
    const nearRight = proj.project(worldRight, yNear, camY);
    if (!farLeft.visible || !nearLeft.visible) continue;

    // 縞の位相はピッチ本体とランオフで揃える (ずれると継ぎ目が目立つ)。
    g.fillStyle(band % 2 === 0 ? darkColor : lightColor, 1);
    g.fillPoints(
      [
        { x: farLeft.x, y: farLeft.y },
        { x: farRight.x, y: farRight.y },
        { x: nearRight.x, y: nearRight.y },
        { x: nearLeft.x, y: nearLeft.y },
      ],
      true,
    );
  }
}

/** 芝の刈り込み縞 (ランオフ込み) + その外側の地面。ライン描画より先に呼ぶこと。 */
function drawTurf(ctx: Ctx): void {
  const { g, proj } = ctx;

  // 最下層: 地平線からビューポート下端までを陸上トラック相当の色で埋める
  // (ランオフの芝より外側に出る遠方の隅だけがこの色になる)。
  g.fillStyle(SURROUND_COLOR, 1);
  g.fillRect(0, proj.config.horizonY, proj.config.viewportWidth, proj.config.viewportHeight - proj.config.horizonY);

  // ランオフの芝 (ラインの外側)。ピッチ本体より一段暗くして、プレー領域との境界は
  // 白いタッチライン/ゴールラインが担う。
  drawStripeBands(
    ctx,
    -RUNOFF_X,
    PITCH_WIDTH + RUNOFF_X,
    -RUNOFF_Y,
    PITCH_HEIGHT + RUNOFF_Y,
    TURF_OUTER_DARK,
    TURF_OUTER_LIGHT,
  );

  // ピッチ本体 (ランオフの上に重ねる)。
  drawStripeBands(ctx, 0, PITCH_WIDTH, 0, PITCH_HEIGHT, TURF_DARK, TURF_LIGHT);
}

/** 折れ線 (円弧など) をまとめて1ストロークで描く。 */
function strokePolyline(ctx: Ctx, points: ReadonlyArray<{ x: number; y: number }>): void {
  const { proj, camY } = ctx;
  const maxWorldY = camY - proj.config.minDepth;
  let started = false;
  let depthForWidth = proj.config.nearDepth;
  const path: Array<{ x: number; y: number }> = [];

  for (const pt of points) {
    if (pt.y > maxWorldY) {
      started = false; // カメラ手前で途切れる
      continue;
    }
    const p = proj.project(pt.x, pt.y, camY);
    if (!p.visible) {
      started = false;
      continue;
    }
    if (!started) {
      if (path.length > 1) flushPath(ctx, path, depthForWidth);
      path.length = 0;
      started = true;
      depthForWidth = p.depth;
    }
    path.push({ x: p.x, y: p.y });
  }
  if (path.length > 1) flushPath(ctx, path, depthForWidth);
}

function flushPath(ctx: Ctx, path: ReadonlyArray<{ x: number; y: number }>, depth: number): void {
  const { g, proj } = ctx;
  g.lineStyle(lineWidthAt(proj, depth), LINE_COLOR, LINE_ALPHA);
  g.beginPath();
  g.moveTo(path[0]!.x, path[0]!.y);
  for (let i = 1; i < path.length; i++) g.lineTo(path[i]!.x, path[i]!.y);
  g.strokePath();
}

/**
 * ゴール枠 (立体)。疑似3Dなので、ゴールラインの上に「高さ GOAL_HEIGHT のクロスバー」を
 * 立てて描く。地面の点を投影してから、見かけのスケールぶんだけ画面上方向へ持ち上げる
 * (ボールの高さ表現と同じ扱い方 = 高さは常に画面Y方向の持ち上げで表現する)。
 */
function drawGoals(ctx: Ctx, goalHalfWidth: number): void {
  const { g, proj, camY } = ctx;
  const cx = PITCH_WIDTH / 2;

  for (const [goalLineY, inward] of [
    [0, 1],
    [PITCH_HEIGHT, -1],
  ] as const) {
    const backY = goalLineY - inward * GOAL_DEPTH; // ゴールの奥 (ピッチ外側)
    const posts: Array<{ x: number; y: number }> = [
      { x: cx - goalHalfWidth, y: goalLineY },
      { x: cx + goalHalfWidth, y: goalLineY },
    ];

    const ground = posts.map((p) => proj.project(p.x, p.y, camY));
    const back = posts.map((p) => proj.project(p.x, backY, camY));
    if (ground.some((p) => !p.visible) || back.some((p) => !p.visible)) continue;

    const lift = (p: { y: number; scale: number }): number => p.y - GOAL_HEIGHT * p.scale;

    // ネット (面として分かる最小限のメッシュ: 縦3本 + 横2本)
    g.lineStyle(1, NET_COLOR, NET_ALPHA);
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const x = cx - goalHalfWidth + goalHalfWidth * 2 * t;
      const gp = proj.project(x, goalLineY, camY);
      const bp = proj.project(x, backY, camY);
      if (!gp.visible || !bp.visible) continue;
      g.lineBetween(gp.x, lift(gp), bp.x, lift(bp)); // 天井の網
      g.lineBetween(bp.x, lift(bp), bp.x, bp.y); // 奥の面の縦糸
    }
    g.lineBetween(back[0]!.x, back[0]!.y, back[1]!.x, back[1]!.y);

    // ポスト + クロスバー
    const postWidth = Math.max(1.5, 4 * ground[0]!.scale);
    g.lineStyle(postWidth, POST_COLOR, 0.95);
    for (const gp of ground) g.lineBetween(gp.x, gp.y, gp.x, lift(gp));
    g.lineBetween(ground[0]!.x, lift(ground[0]!), ground[1]!.x, lift(ground[1]!));
  }
}

/**
 * 遠方のかすみ。地平線付近を薄く暗くして、奥行きが「平らな壁」に見えるのを防ぐ
 * (実際の遠景も大気で色が沈む)。地平線から数十px、透明度を落としながら重ねるだけ。
 */
function drawDistanceHaze(ctx: Ctx): void {
  const { g, proj } = ctx;
  const bands = 8;
  const depth = 70; // 地平線から下へ何pxまでかすませるか
  for (let i = 0; i < bands; i++) {
    const t = i / bands;
    g.fillStyle(0x0d1622, 0.34 * (1 - t));
    g.fillRect(0, proj.config.horizonY + (depth * i) / bands, proj.config.viewportWidth, depth / bands + 1);
  }
}

/** ピッチ全体 (芝 → ライン → スポット → ゴール) を1フレームぶん描く。 */
export function drawPitchPerspective(
  g: Phaser.GameObjects.Graphics,
  proj: Projection,
  camY: number,
  goalWidth: number,
): void {
  const ctx: Ctx = { g, proj, camY };
  g.clear();

  drawTurf(ctx);

  for (const seg of pitchLineSegments()) strokeSegment(ctx, seg);
  for (const poly of pitchArcPolylines()) strokePolyline(ctx, poly);

  // スポット (センター/PK)
  for (const spot of pitchSpots()) {
    const p = proj.project(spot.x, spot.y, camY);
    if (!p.visible) continue;
    g.fillStyle(LINE_COLOR, LINE_ALPHA);
    g.fillCircle(p.x, p.y, Math.max(1, 3 * p.scale));
  }

  drawGoals(ctx, goalWidth / 2);

  // かすみは最後に重ねる (ライン/ゴールも遠方では沈むのが自然)。
  drawDistanceHaze(ctx);
}
