import Phaser from 'phaser';

/**
 * サッカーピッチのライン描画 (完全に手続き的、画像アセット不使用)。
 *
 * 15周目の追加。それまでのピッチは「緑の矩形 + 200pxごとの横線 + ゴール幅の目印」だけで、
 * ペナルティエリアもセンターサークルも無く、実プレイでは**サッカーの試合ではなく
 * デバッグ画面に見えていた**。メカニクスが動くようになった今、完成度の体感を最も安く
 * 引き上げられるのがここ。
 *
 * 寸法の方針: 実寸比をそのまま使わない。このピッチは 480x1800 (1:3.75) と、実物
 * (68m x 105m = 1:1.54) よりはるかに縦長な、縦スクロール前提の意図的な形状のため。
 * 「横幅に対する比率」を実物に寄せつつ、深さは既存のゲームプレイ定数と整合させる:
 *   - ゴール幅80px は sim/goalkeeperConstants.ts の GOAL_WIDTH_FIXED と一致
 *   - ゴールエリア深さ66px は boundsConstants.ts の GOAL_KICK_DEPTH(60) にほぼ一致
 *     (ゴールキックのボール設置点がゴールエリア内に見える)
 *   - ペナルティエリアは、ゴールキック時に相手が退避させられるライン(250px)より内側に
 *     置く。退避した相手が必ずボックスの外に見えるので、ルールが目で分かる
 */

/** 芝の濃淡2色 (刈り込みの縞模様)。単色ベタ塗りより一気に「ピッチらしく」なる。 */
const TURF_DARK = 0x1c6636;
const TURF_LIGHT = 0x227640;
/** 縞1本の高さ (px)。縦スクロールの速度感を出す目印も兼ねる (旧実装の200px横線の役割を継承)。 */
const STRIPE_HEIGHT = 120;

const LINE_COLOR = 0xffffff;
const LINE_ALPHA = 0.72;
const LINE_WIDTH = 2.5;
/** 外周ラインを画面内に収めるための内側オフセット (線幅の半分ぶん)。 */
const EDGE_INSET = 1.5;

/** ペナルティエリア (幅は横幅の60%、実物の59%にほぼ一致)。 */
const PENALTY_AREA_WIDTH = 288;
const PENALTY_AREA_DEPTH = 168;
/** ゴールエリア (小さい方のボックス)。深さはゴールキックのボール設置点(60px)と揃える。 */
const GOAL_AREA_WIDTH = 160;
const GOAL_AREA_DEPTH = 66;
/** ペナルティスポット (PKマーク) の深さ。 */
const PENALTY_SPOT_DEPTH = 110;
/** センターサークル/ペナルティアークの半径 (実物同様、両者は同じ半径)。 */
const CIRCLE_RADIUS = 68;
/** スポット (センター/PK) の点の半径。 */
const SPOT_RADIUS = 3;
/** コーナーアークの半径。 */
const CORNER_ARC_RADIUS = 14;

/** ゴールネットの奥行きと網目 (真上視点では奥行きを表現できないため、面で示す最小表現)。 */
const NET_DEPTH = 20;
const NET_MESH = 7;
const NET_COLOR = 0xffffff;
const NET_ALPHA = 0.3;
/** ゴールポストの線幅 (ラインより明確に太くして「枠」だと分かるようにする)。 */
const POST_WIDTH = 5;

/** 芝 (縞模様の下地)。ライン描画より先に呼ぶこと。 */
export function drawPitchTurf(g: Phaser.GameObjects.Graphics, width: number, height: number): void {
  g.fillStyle(TURF_DARK, 1);
  g.fillRect(0, 0, width, height);
  g.fillStyle(TURF_LIGHT, 1);
  for (let y = 0; y < height; y += STRIPE_HEIGHT * 2) {
    g.fillRect(0, y, width, Math.min(STRIPE_HEIGHT, height - y));
  }
}

/**
 * 片側のエンド (ゴール前) の描画。
 * @param goalLineY そのエンドのゴールラインのY座標 (0 または height)。
 * @param inward ピッチ内側へ向かう符号 (+1 = Y増加方向、-1 = Y減少方向)。
 */
function drawEnd(
  g: Phaser.GameObjects.Graphics,
  width: number,
  goalLineY: number,
  inward: 1 | -1,
  goalHalfWidth: number,
): void {
  const centerX = width / 2;

  // ペナルティエリア / ゴールエリア (strokeRectは正の幅高さを要求するので上端を計算する)
  const box = (boxWidth: number, depth: number) => {
    const x = centerX - boxWidth / 2;
    const y = inward === 1 ? goalLineY : goalLineY - depth;
    g.strokeRect(x, y, boxWidth, depth);
  };
  box(PENALTY_AREA_WIDTH, PENALTY_AREA_DEPTH);
  box(GOAL_AREA_WIDTH, GOAL_AREA_DEPTH);

  // ペナルティスポット
  const spotY = goalLineY + inward * PENALTY_SPOT_DEPTH;
  g.fillStyle(LINE_COLOR, LINE_ALPHA);
  g.fillCircle(centerX, spotY, SPOT_RADIUS);

  // ペナルティアーク (D): スポット中心の円のうち、ペナルティエリアの外へはみ出す部分だけ。
  // ボックス端までの距離 / 半径 で、内向き軸からの半角が決まる。
  const toBoxEdge = PENALTY_AREA_DEPTH - PENALTY_SPOT_DEPTH;
  if (Math.abs(toBoxEdge) < CIRCLE_RADIUS) {
    const halfAngle = Math.acos(toBoxEdge / CIRCLE_RADIUS);
    // Phaserは画面座標 (Y下向き) なので、内向き +Y は +π/2、内向き -Y は -π/2。
    const axis = inward === 1 ? Math.PI / 2 : -Math.PI / 2;
    g.beginPath();
    g.arc(centerX, spotY, CIRCLE_RADIUS, axis - halfAngle, axis + halfAngle, false);
    g.strokePath();
  }

  // ゴールポスト (ゴールマウス) とネット。ネットはピッチ内側に敷く
  // (カメラのsetBoundsの外は描画されないため、ゴールの奥行きは内側で表現するしかない)。
  const netInnerY = goalLineY + inward * NET_DEPTH;
  g.lineStyle(1, NET_COLOR, NET_ALPHA);
  for (let x = centerX - goalHalfWidth; x <= centerX + goalHalfWidth; x += NET_MESH) {
    g.lineBetween(x, goalLineY, x, netInnerY);
  }
  const yFrom = Math.min(goalLineY, netInnerY);
  const yTo = Math.max(goalLineY, netInnerY);
  for (let y = yFrom; y <= yTo; y += NET_MESH) {
    g.lineBetween(centerX - goalHalfWidth, y, centerX + goalHalfWidth, y);
  }

  // ゴール枠 (ポスト+クロスバー相当) を太線で強調
  g.lineStyle(POST_WIDTH, LINE_COLOR, 0.95);
  g.lineBetween(centerX - goalHalfWidth, goalLineY, centerX + goalHalfWidth, goalLineY);
  g.lineBetween(centerX - goalHalfWidth, goalLineY, centerX - goalHalfWidth, netInnerY);
  g.lineBetween(centerX + goalHalfWidth, goalLineY, centerX + goalHalfWidth, netInnerY);

  g.lineStyle(LINE_WIDTH, LINE_COLOR, LINE_ALPHA); // 呼び出し側の線種へ戻す
}

/** ピッチのライン一式 (外周・ハーフウェー・センターサークル・両エンド・コーナーアーク)。 */
export function drawPitchLines(
  g: Phaser.GameObjects.Graphics,
  width: number,
  height: number,
  goalWidth: number,
): void {
  const goalHalfWidth = goalWidth / 2;
  g.lineStyle(LINE_WIDTH, LINE_COLOR, LINE_ALPHA);

  // 外周 (タッチライン + ゴールライン)
  g.strokeRect(EDGE_INSET, EDGE_INSET, width - EDGE_INSET * 2, height - EDGE_INSET * 2);

  // ハーフウェーライン + センターサークル + センタースポット
  const midY = height / 2;
  g.lineBetween(EDGE_INSET, midY, width - EDGE_INSET, midY);
  g.strokeCircle(width / 2, midY, CIRCLE_RADIUS);
  g.fillStyle(LINE_COLOR, LINE_ALPHA);
  g.fillCircle(width / 2, midY, SPOT_RADIUS);

  drawEnd(g, width, 0, 1, goalHalfWidth);
  drawEnd(g, width, height, -1, goalHalfWidth);

  // コーナーアーク (各隅からピッチ内側へ開く1/4円)
  const r = CORNER_ARC_RADIUS;
  const corners: Array<[number, number, number, number]> = [
    [EDGE_INSET, EDGE_INSET, 0, Math.PI / 2], // 左上
    [width - EDGE_INSET, EDGE_INSET, Math.PI / 2, Math.PI], // 右上
    [width - EDGE_INSET, height - EDGE_INSET, Math.PI, Math.PI * 1.5], // 右下
    [EDGE_INSET, height - EDGE_INSET, Math.PI * 1.5, Math.PI * 2], // 左下
  ];
  for (const [cx, cy, from, to] of corners) {
    g.beginPath();
    g.arc(cx, cy, r, from, to, false);
    g.strokePath();
  }
}
