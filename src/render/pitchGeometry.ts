import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';

/**
 * ピッチのライン類の「ワールド座標での寸法」だけを集めた定数と、それを線分/円弧の
 * 集合として吐き出す純関数。★描画方式 (真上 or 疑似3D) に依存しない★
 *
 * 16周目に pitchMarkings.ts (真上視点で直接 Graphics に描く実装) から寸法定義だけを
 * 切り出した。疑似3D化では「同じ寸法を、投影してから描く」だけなので、寸法の
 * 定義がひとつであることが重要 (sim/ 側の定数との整合コメントもここに集約する)。
 *
 * 寸法の方針: 実寸比をそのまま使わない。このピッチは 480x1800 (1:3.75) と、実物
 * (68m x 105m = 1:1.54) よりはるかに縦長な、縦スクロール前提の意図的な形状のため。
 *   - ゴール幅80px は sim/goalkeeperConstants.ts の GOAL_WIDTH_FIXED と一致
 *   - ゴールエリア深さ66px は boundsConstants.ts の GOAL_KICK_DEPTH(60) にほぼ一致
 *   - センターサークル半径68px は boundsConstants.ts の KICKOFF_CIRCLE_RADIUS と一致
 *     (キックオフで相手が押し出される円が、画面に描かれている円そのものになる)
 */

/** ペナルティエリア (幅は横幅の60%、実物の59%にほぼ一致)。 */
export const PENALTY_AREA_WIDTH = 288;
export const PENALTY_AREA_DEPTH = 168;
/** ゴールエリア (小さい方のボックス)。 */
export const GOAL_AREA_WIDTH = 160;
export const GOAL_AREA_DEPTH = 66;
/** ペナルティスポット (PKマーク) の深さ。 */
export const PENALTY_SPOT_DEPTH = 110;
/** センターサークル/ペナルティアークの半径 (実物同様、両者は同じ半径)。 */
export const CIRCLE_RADIUS = 68;
/** コーナーアークの半径。 */
export const CORNER_ARC_RADIUS = 14;
/** 芝の刈り込み縞1本の奥行き (ワールドpx)。奥行き感とスクロールの体感を作る。 */
export const STRIPE_DEPTH = 120;
/** ゴールの奥行き (ゴールラインからネット後方まで、ワールドpx)。 */
export const GOAL_DEPTH = 26;
/** ゴールの高さ (疑似3Dで縦に立てるためのワールドpx。クロスバーの高さ)。 */
export const GOAL_HEIGHT = 26;

/** ワールド座標の線分 (投影してから描く)。 */
export interface WorldSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** 円/円弧をワールド座標の折れ線として展開する (投影すると自然に楕円に見える)。 */
export function arcPoints(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  steps: number,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const a = startAngle + ((endAngle - startAngle) * i) / steps;
    points.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
  }
  return points;
}

/** 矩形を4本の線分に展開する。 */
export function rectSegments(x: number, y: number, w: number, h: number): WorldSegment[] {
  return [
    { x1: x, y1: y, x2: x + w, y2: y },
    { x1: x + w, y1: y, x2: x + w, y2: y + h },
    { x1: x + w, y1: y + h, x2: x, y2: y + h },
    { x1: x, y1: y + h, x2: x, y2: y },
  ];
}

/**
 * ピッチのライン一式 (外周・ハーフウェー・両エンドのボックス) をワールド線分で返す。
 * 円弧類は曲線なので別関数 (pitchArcs) に分ける。
 */
export function pitchLineSegments(): WorldSegment[] {
  const w = PITCH_WIDTH;
  const h = PITCH_HEIGHT;
  const cx = w / 2;
  const segments: WorldSegment[] = [
    // 外周
    ...rectSegments(0, 0, w, h),
    // ハーフウェーライン
    { x1: 0, y1: h / 2, x2: w, y2: h / 2 },
  ];

  // 両エンドのボックス。inward = ピッチ内側へ向かう符号。
  for (const [goalLineY, inward] of [
    [0, 1],
    [h, -1],
  ] as const) {
    for (const [boxWidth, depth] of [
      [PENALTY_AREA_WIDTH, PENALTY_AREA_DEPTH],
      [GOAL_AREA_WIDTH, GOAL_AREA_DEPTH],
    ] as const) {
      const top = inward === 1 ? goalLineY : goalLineY - depth;
      segments.push(...rectSegments(cx - boxWidth / 2, top, boxWidth, depth));
    }
  }
  return segments;
}

/** 円弧類 (センターサークル、ペナルティアーク、コーナーアーク) をワールド折れ線で返す。 */
export function pitchArcPolylines(): Array<Array<{ x: number; y: number }>> {
  const w = PITCH_WIDTH;
  const h = PITCH_HEIGHT;
  const cx = w / 2;
  const polylines: Array<Array<{ x: number; y: number }>> = [
    arcPoints(cx, h / 2, CIRCLE_RADIUS, 0, Math.PI * 2, 28),
  ];

  for (const [goalLineY, inward] of [
    [0, 1],
    [h, -1],
  ] as const) {
    // ペナルティアーク(D): スポット中心の円のうちペナルティエリアの外へ出る部分。
    const spotY = goalLineY + inward * PENALTY_SPOT_DEPTH;
    const toBoxEdge = PENALTY_AREA_DEPTH - PENALTY_SPOT_DEPTH;
    if (Math.abs(toBoxEdge) < CIRCLE_RADIUS) {
      const halfAngle = Math.acos(toBoxEdge / CIRCLE_RADIUS);
      const axis = inward === 1 ? Math.PI / 2 : -Math.PI / 2;
      polylines.push(arcPoints(cx, spotY, CIRCLE_RADIUS, axis - halfAngle, axis + halfAngle, 14));
    }
  }

  // コーナーアーク (各隅からピッチ内側へ開く1/4円)
  const r = CORNER_ARC_RADIUS;
  polylines.push(arcPoints(0, 0, r, 0, Math.PI / 2, 6));
  polylines.push(arcPoints(w, 0, r, Math.PI / 2, Math.PI, 6));
  polylines.push(arcPoints(w, h, r, Math.PI, Math.PI * 1.5, 6));
  polylines.push(arcPoints(0, h, r, Math.PI * 1.5, Math.PI * 2, 6));

  return polylines;
}

/** スポット (センター/PK) のワールド座標。 */
export function pitchSpots(): Array<{ x: number; y: number }> {
  const cx = PITCH_WIDTH / 2;
  return [
    { x: cx, y: PITCH_HEIGHT / 2 },
    { x: cx, y: PENALTY_SPOT_DEPTH },
    { x: cx, y: PITCH_HEIGHT - PENALTY_SPOT_DEPTH },
  ];
}
