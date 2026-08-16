import { PITCH_WIDTH, VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from '../config/pitch';
import { HORIZON_Y_FRAC, NEAR_DEPTH, NEAR_WIDTH_RATIO } from './viewConstants';

/**
 * 疑似3D (透視投影) の座標変換レイヤー。★描画専用★
 *
 * ここは「シミュレーション座標(平面) → 画面座標(台形)」の一方向の変換だけを担う。
 * sim/ は一切これを知らないし、当たり判定・物理・AI・カメラ以外の何にも影響しない
 * (CLAUDE.md の決定論方針: 見た目の状態は GameState に持たせない)。
 * float / Math.sin 等を自由に使ってよいのもこの層から先だけ。
 *
 * ## モデル (ピンホールカメラ)
 *
 * カメラはピッチの中央線上、地面から camHeight の高さに置き、攻撃方向 (画面の奥、
 * ワールドYが小さい方) を見下ろしている。ワールド上の点の「奥行き」を
 *
 *     z = cameraWorldY - worldY        (z > 0 が画面の手前→奥)
 *
 * と定義すると、標準的なピンホール投影は
 *
 *     screenY = horizonY + (focal * camHeight) / z
 *     screenX = centerX  + (focal * (worldX - camWorldX)) / z
 *     scale   = focal / z                       (見かけの拡大率)
 *
 * になる。z→∞ で screenY→horizonY (地平線に収束)、z が小さいほど画面下・大きく写る。
 * 「奥ほど小さく、奥ほどX方向に圧縮される」という要求は、この1本の式から自動的に出る
 * (X圧縮率とスケール率を別々に持たない = 破綻しない)。
 *
 * ## パラメータの決め方
 *
 * 直感的な2つの見た目の要求から逆算する:
 *   1. 画面下端 (screenY = viewportHeight) に写るのは、カメラから nearDepth だけ奥の地面
 *   2. その nearDepth の位置で、ピッチ幅 PITCH_WIDTH が画面幅の nearWidthRatio 倍に見える
 *      (1.0 なら near のタッチラインがちょうど画面端。1 より大きいと near の左右が
 *       画面外に出て、より「低い位置から見ている」強い遠近感になる)
 * この2つから focal と camHeight が一意に決まる。
 */

export interface ProjectionConfig {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  /** 地平線の画面Y (この上にスタンド/空を描く)。 */
  readonly horizonY: number;
  /** 画面下端に写る地面の、カメラからの奥行き。 */
  readonly nearDepth: number;
  /** nearDepth の位置でピッチ幅が画面幅の何倍に見えるか。 */
  readonly nearWidthRatio: number;
  /**
   * カメラのワールドXの既定値 (ピッチ中央)。
   * ★段階1後の訂正以降、実際には毎フレーム project() の第4引数で上書きする★
   * カメラ俯角を原作に合わせた結果、ボール位置で画面に写るワールド幅が約197pxとなり、
   * 480px幅のピッチ全体は入らなくなったため、横方向にもボールを追う必要が生じた
   * (それ以前は全幅が画面に収まっていたので固定でよかった)。
   */
  readonly cameraWorldX: number;
  /** 投影可能な最小の奥行き。これより手前(カメラの後ろ含む)は描画対象外。 */
  readonly minDepth: number;
}

export interface Projection {
  readonly config: ProjectionConfig;
  /** focal (ピンホールの焦点距離、px)。 */
  readonly focal: number;
  /** カメラの地面からの高さ (ワールドpx)。 */
  readonly camHeight: number;
  /**
   * ワールド座標 → 画面座標。visible=false の点はカメラの手前/後ろで投影できない
   * (呼び出し側で setVisible(false) すること)。
   */
  project(worldX: number, worldY: number, cameraWorldY: number, cameraWorldX?: number): ProjectedPoint;
  /** 奥行き z における見かけの拡大率 (near 位置で 1.0 になるよう正規化済み)。 */
  scaleAtDepth(depth: number): number;
  /** 画面Yから逆算した奥行き (縞模様の生成やカリング範囲の計算に使う)。 */
  depthAtScreenY(screenY: number): number;
  /** 指定の画面Yに focusWorldY を写すためのカメラワールドY。 */
  cameraWorldYFor(focusWorldY: number, focusScreenY: number): number;
}

export interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
  /** near 位置を 1.0 とした見かけの拡大率。 */
  readonly scale: number;
  /** カメラからの奥行き (深度ソートにも使える)。 */
  readonly depth: number;
  readonly visible: boolean;
}

// 調整可能なパラメータの実体は render/viewConstants.ts に集約してある (段階1)。
export const DEFAULT_PROJECTION_CONFIG: ProjectionConfig = {
  viewportWidth: VIEWPORT_WIDTH,
  viewportHeight: VIEWPORT_HEIGHT,
  horizonY: Math.round(VIEWPORT_HEIGHT * HORIZON_Y_FRAC),
  nearDepth: NEAR_DEPTH,
  nearWidthRatio: NEAR_WIDTH_RATIO,
  cameraWorldX: PITCH_WIDTH / 2,
  minDepth: 24,
};

export function createProjection(config: ProjectionConfig = DEFAULT_PROJECTION_CONFIG): Projection {
  // 要求2: focal * (PITCH_WIDTH/2) / nearDepth = (viewportWidth/2) * nearWidthRatio
  const focal = (config.nearWidthRatio * config.viewportWidth * config.nearDepth) / PITCH_WIDTH;
  // 要求1: horizonY + focal*camHeight/nearDepth = viewportHeight
  const camHeight = ((config.viewportHeight - config.horizonY) * config.nearDepth) / focal;
  const focalTimesHeight = focal * camHeight;
  const nearScale = focal / config.nearDepth;

  const scaleAtDepth = (depth: number): number => focal / Math.max(depth, config.minDepth) / nearScale;

  return {
    config,
    focal,
    camHeight,
    scaleAtDepth,
    project(
      worldX: number,
      worldY: number,
      cameraWorldY: number,
      cameraWorldX: number = config.cameraWorldX,
    ): ProjectedPoint {
      const depth = cameraWorldY - worldY;
      if (depth <= config.minDepth) {
        // カメラの後ろ/直下。投影が発散するので描画対象から外す。
        return { x: 0, y: config.viewportHeight * 2, scale: 1, depth, visible: false };
      }
      return {
        x: config.viewportWidth / 2 + (focal * (worldX - cameraWorldX)) / depth,
        y: config.horizonY + focalTimesHeight / depth,
        scale: scaleAtDepth(depth),
        depth,
        visible: true,
      };
    },
    depthAtScreenY(screenY: number): number {
      const dy = screenY - config.horizonY;
      if (dy <= 0) return Infinity; // 地平線より上は無限遠
      return focalTimesHeight / dy;
    },
    cameraWorldYFor(focusWorldY: number, focusScreenY: number): number {
      const dy = Math.max(focusScreenY - config.horizonY, 1);
      return focusWorldY + focalTimesHeight / dy;
    },
  };
}
