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
import { lerpColor, shadeColor } from './colorUtils';

/**
 * ピッチの疑似3D描画 (毎フレーム、投影しながら描く)。★描画専用★
 *
 * 真上視点の頃はピッチが静的だったので Graphics に1回焼くだけで済んだが、透視投影では
 * カメラが動くたびに台形の形自体が変わるため、毎フレーム描き直す必要がある。
 * 60fps を守るため、プリミティブ数は意図的に抑えている (縞15本 + ライン約30本 +
 * 円弧4本 + ゴール2組)。折れ線は beginPath/lineTo/strokePath でまとめて1ストロークにする。
 */

/**
 * ★V-4 (ビジュアル手法転換・案C)★ 芝のパレット。原作PNGを実測して合わせた値
 * (docs/visual-overhaul-proposal.md 1-1)。旧実装は輝度82(暗い青緑)で原作の輝度151の
 * 54%しか無く、遠方をさらに暗くする(空気遠近が逆向き)欠陥もあった。
 *
 *   手前2色 (交互ストライプ、ΔG=6で原作の控えめなコントラストを再現):
 *     A: #83b453 (131,180,83) 輝度154.3 / B: #76ae4d (118,174,77) 輝度146.2
 *   遠方2色 (原作は手前より明るい。旧実装は逆に暗くしていたため向きを反転):
 *     A: #9acd6c (154,205,108) 輝度178.7 / B: #8fc765 (143,199,101) 輝度170.9
 */
const TURF_NEAR_A = 0x83b453;
const TURF_NEAR_B = 0x76ae4d;
const TURF_FAR_A = 0x9acd6c;
const TURF_FAR_B = 0x8fc765;
const TURF_FAMILY_A = { near: TURF_NEAR_A, far: TURF_FAR_A };
const TURF_FAMILY_B = { near: TURF_NEAR_B, far: TURF_FAR_B };

/**
 * ★段階1★ タッチライン/ゴールラインの外側にも続く芝 (ランオフ)。
 *
 * 原作の画面を測ると、ピッチはほぼ常に画面幅いっぱいを占め、外に出るのは遠方の隅だけで、
 * そこも「暗い虚無」ではなく陸上トラック相当の暖色だった。当実装はピッチ(480px幅)の外側が
 * 一様な暗緑だったため、奥へ行くほどピッチが細い帯に見え、「廊下を走っている」ような
 * 画になっていた (自己観察キャプチャ `.shots/before-*.png`)。
 * 実寸のスタジアム同様、ラインの外にも芝を延ばして画面を埋める。
 * ★V-4★ 色は本体の芝パレットを流用し、境界が分かる程度に少しだけ沈める (RUNOFF_SHADE)。
 */
const RUNOFF_SHADE = 0.86;
const TURF_FAMILY_A_OUTER = { near: shadeColor(TURF_NEAR_A, RUNOFF_SHADE), far: shadeColor(TURF_FAR_A, RUNOFF_SHADE) };
const TURF_FAMILY_B_OUTER = { near: shadeColor(TURF_NEAR_B, RUNOFF_SHADE), far: shadeColor(TURF_FAR_B, RUNOFF_SHADE) };
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
 * ★V-4★ ゴールネットの密度。旧実装は縦4本(5分割)+横2本(天井網の縦糸5本+奥面の
 * 下端1本のみ)で「面」ではなく「枠線」にしか見えなかった (docs/visual-overhaul-proposal.md
 * 1-4)。縦の分割数を増やし、天井網・奥面のどちらにも横糸(NET_ROWS)を通して格子にする。
 */
const NET_COLUMNS = 6;
const NET_ROWS = [0.33, 0.66];

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
  /** カメラのワールドX (横追従。段階1後の訂正で俯角を浅くした結果、必要になった)。 */
  readonly camX: number;
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

  const p1 = proj.project(x1, y1, camY, ctx.camX);
  const p2 = proj.project(x2, y2, camY, ctx.camX);
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

interface TurfFamily {
  readonly near: number;
  readonly far: number;
}

/**
 * 刈り込み縞を、指定のワールドX範囲・Y範囲について台形として塗る。
 * ランオフ(ライン外の芝)と、ピッチ本体で色だけ変えて2回呼ぶ。
 *
 * ★V-4で縦縞化 → ユーザー指摘で撤回・横縞へ差し戻し★
 * 前回「原作は縦縞(ゴール〜ゴールを結ぶ方向)」と判断してX軸分割+奥行きセル細分化+
 * 位置ジッターのディザリングを実装したが、ユーザー確認の結果これは誤りで、
 * 「原作の縞はピッチを横切る方向(タッチラインと平行、奥行き方向に交互に切り替わる帯)」
 * だったと判明した。加えてセル単位のディザリングは市松模様のモザイクに見えてしまい、
 * 原作にはこの質感が無かった。そのため元のY(奥行き)軸分割へ戻し、ディザリングは廃止した。
 *
 * 空気遠近 (遠方ほど明るい) はV-4で直した向きのまま維持する: 帯1本は単色だが、
 * その色を帯の奥行き位置(depthT)で family.near→family.far へ補間して決めるため、
 * 帯をまたいで滑らかに明るくなっていく (市松模様にはならない、1帯=1色のシンプルな縞)。
 */
function drawStripeBands(
  ctx: Ctx,
  worldLeft: number,
  worldRight: number,
  worldFarY: number,
  worldNearY: number,
  familyA: TurfFamily,
  familyB: TurfFamily,
): void {
  const { g, proj, camY } = ctx;
  const nearest = Math.min(worldNearY, camY - proj.config.minDepth);
  const farthest = Math.max(worldFarY, camY - MAX_DRAW_DEPTH);
  if (nearest <= farthest) return;

  const firstBand = Math.floor(farthest / STRIPE_DEPTH);
  const lastBand = Math.ceil(nearest / STRIPE_DEPTH);
  const span = nearest - farthest;

  for (let band = firstBand; band < lastBand; band++) {
    const yFar = Math.max(farthest, band * STRIPE_DEPTH);
    const yNear = Math.min(nearest, (band + 1) * STRIPE_DEPTH);
    if (yNear <= yFar) continue;

    const farLeft = proj.project(worldLeft, yFar, camY, ctx.camX);
    const farRight = proj.project(worldRight, yFar, camY, ctx.camX);
    const nearLeft = proj.project(worldLeft, yNear, camY, ctx.camX);
    const nearRight = proj.project(worldRight, yNear, camY, ctx.camX);
    if (!farLeft.visible || !nearLeft.visible) continue;

    // 縞の位相はピッチ本体とランオフで揃える (ずれると継ぎ目が目立つ)。
    const family = (((band % 2) + 2) % 2) === 0 ? familyA : familyB;
    // depthT: 0=手前(nearest、基調色) → 1=最遠(farthest、明るい遠方色)。帯の中点で評価する。
    const depthT = (nearest - (yFar + yNear) / 2) / span;
    const color = lerpColor(family.near, family.far, depthT);

    g.fillStyle(color, 1);
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
    TURF_FAMILY_A_OUTER,
    TURF_FAMILY_B_OUTER,
  );

  // ピッチ本体 (ランオフの上に重ねる)。
  drawStripeBands(ctx, 0, PITCH_WIDTH, 0, PITCH_HEIGHT, TURF_FAMILY_A, TURF_FAMILY_B);
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
    const p = proj.project(pt.x, pt.y, camY, ctx.camX);
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

interface NetColumn {
  readonly frontTop: { x: number; y: number };
  readonly backTop: { x: number; y: number };
  readonly backGround: { x: number; y: number };
}

/** aとbを t (0..1) で線形補間した点。 */
function lerpPoint(a: { x: number; y: number }, b: { x: number; y: number }, t: number): { x: number; y: number } {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * ゴールネットを密なメッシュとして描く。縦糸 (NET_COLUMNS+1本) は天井パネル
 * (ゴールライン上端→奥の上端) と奥面 (奥の上端→奥の下端) の2区間、横糸 (NET_ROWS + 下端)
 * は隣接する縦糸どうしを同じ内分点でつないで格子にする。
 */
function drawGoalNetMesh(
  ctx: Ctx,
  cx: number,
  goalHalfWidth: number,
  goalLineY: number,
  backY: number,
  lift: (p: { y: number; scale: number }) => number,
): void {
  const { g, proj, camY } = ctx;
  const columns: Array<NetColumn | null> = [];
  for (let i = 0; i <= NET_COLUMNS; i++) {
    const t = i / NET_COLUMNS;
    const x = cx - goalHalfWidth + goalHalfWidth * 2 * t;
    const gp = proj.project(x, goalLineY, camY, ctx.camX);
    const bp = proj.project(x, backY, camY, ctx.camX);
    if (!gp.visible || !bp.visible) {
      columns.push(null);
      continue;
    }
    columns.push({
      frontTop: { x: gp.x, y: lift(gp) },
      backTop: { x: bp.x, y: lift(bp) },
      backGround: { x: bp.x, y: bp.y },
    });
  }

  g.lineStyle(1, NET_COLOR, NET_ALPHA);
  // 縦糸: 天井パネル (前上→後上) + 奥面 (後上→後下)。
  for (const col of columns) {
    if (!col) continue;
    g.lineBetween(col.frontTop.x, col.frontTop.y, col.backTop.x, col.backTop.y);
    g.lineBetween(col.backTop.x, col.backTop.y, col.backGround.x, col.backGround.y);
  }
  // 横糸: 隣接する縦糸を同じ内分点(NET_ROWS + 下端1.0)でつなぎ、格子にする。
  const rows = [...NET_ROWS, 1];
  for (let i = 0; i < columns.length - 1; i++) {
    const a = columns[i];
    const b = columns[i + 1];
    if (!a || !b) continue;
    for (const r of rows) {
      const pa = lerpPoint(a.frontTop, a.backTop, r);
      const pb = lerpPoint(b.frontTop, b.backTop, r);
      g.lineBetween(pa.x, pa.y, pb.x, pb.y);
    }
    for (const r of rows) {
      const pa = lerpPoint(a.backTop, a.backGround, r);
      const pb = lerpPoint(b.backTop, b.backGround, r);
      g.lineBetween(pa.x, pa.y, pb.x, pb.y);
    }
  }
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

    const ground = posts.map((p) => proj.project(p.x, p.y, camY, ctx.camX));
    const back = posts.map((p) => proj.project(p.x, backY, camY, ctx.camX));
    if (ground.some((p) => !p.visible) || back.some((p) => !p.visible)) continue;

    const lift = (p: { y: number; scale: number }): number => p.y - GOAL_HEIGHT * p.scale;

    drawGoalNetMesh(ctx, cx, goalHalfWidth, goalLineY, backY, lift);

    // ポスト + クロスバー
    const postWidth = Math.max(1.5, 4 * ground[0]!.scale);
    g.lineStyle(postWidth, POST_COLOR, 0.95);
    for (const gp of ground) g.lineBetween(gp.x, gp.y, gp.x, lift(gp));
    g.lineBetween(ground[0]!.x, lift(ground[0]!), ground[1]!.x, lift(ground[1]!));
  }
}

/**
 * ★V-4で向きを反転★ 遠方のかすみ。地平線付近を薄く「明るく」して、奥行きが
 * 「平らな壁」に見えるのを防ぐ。
 *
 * 段階1の旧実装はここを暗いネイビー(0x0d1622 = SURROUND_COLOR そのもの)で沈めていたが、
 * それは当時「遠方は暗くする」という(実測で誤りと判明した)前提の上に作られたもので、
 * V-4の芝の空気遠近 (drawStripeBandsVertical、遠方ほど明るい) と正反対の効果になっていた。
 *
 * ★重要な副作用★ 透視投影は y = horizonY + C/depth の形のため、depth をどれだけ
 * 大きくしても地平線ちょうど(horizonY)には漸近するだけで到達しない。つまり芝の描画は
 * MAX_DRAW_DEPTH の位置で止まり、その先には常に「芝が描かれない隙間」が残る
 * (地平線のごく手前の数px)。旧実装はこの隙間の色 = SURROUND_COLOR と、かすみの色が
 * 偶然まったく同じ値だったため隙間が見えなかっただけ。かすみの色だけを明るくすると、
 * この隙間がむしろ「暗いすき間 + 明るいかすみ」の縞として露呈する
 * (V-4検証で実測: 地平線直下40pxの輝度が67.9まで落ち込んでいた)。
 * 対策として、地平線ちょうどでは不透明度を1.0にして隙間を完全に覆い隠し、
 * 数十px下で自然な芝のグラデーションへ滑らかに溶け込ませる。
 */
const HAZE_COLOR = lerpColor(TURF_FAR_A, 0xffffff, 0.4);

function drawDistanceHaze(ctx: Ctx): void {
  const { g, proj } = ctx;
  const bands = 8;
  const depth = 70; // 地平線から下へ何pxまでかすませるか
  for (let i = 0; i < bands; i++) {
    const t = i / bands;
    g.fillStyle(HAZE_COLOR, 1 - t);
    g.fillRect(0, proj.config.horizonY + (depth * i) / bands, proj.config.viewportWidth, depth / bands + 1);
  }
}

/** ピッチ全体 (芝 → ライン → スポット → ゴール) を1フレームぶん描く。 */
export function drawPitchPerspective(
  g: Phaser.GameObjects.Graphics,
  proj: Projection,
  camY: number,
  camX: number,
  goalWidth: number,
): void {
  const ctx: Ctx = { g, proj, camY, camX };
  g.clear();

  drawTurf(ctx);

  for (const seg of pitchLineSegments()) strokeSegment(ctx, seg);
  for (const poly of pitchArcPolylines()) strokePolyline(ctx, poly);

  // スポット (センター/PK)
  for (const spot of pitchSpots()) {
    const p = proj.project(spot.x, spot.y, camY, ctx.camX);
    if (!p.visible) continue;
    g.fillStyle(LINE_COLOR, LINE_ALPHA);
    g.fillCircle(p.x, p.y, Math.max(1, 3 * p.scale));
  }

  drawGoals(ctx, goalWidth / 2);

  // かすみは最後に重ねる (ライン/ゴールも遠方では沈むのが自然)。
  drawDistanceHaze(ctx);
}
