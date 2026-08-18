/**
 * ボールの疑似3D表現 (持ち上げ・拡大・接地影) の計算部。★描画専用の純関数★
 *
 * 24周目-6 (台帳L-02) で PitchScene.renderBall から抽出した。理由:
 * 「浮き球ほど影が消える」という原作と正反対の実装が、描画コードの中に埋まっていて
 * どのテストからも見えなかった。原作の正解挙動 (docs/visual-behavior-audit.md 2-2節、
 * vf1876-1904 / vf690):
 *   - 影は浮遊中も濃い楕円が地面に常時追従する (高さの主要な手がかりは
 *     「影とボール本体の分離距離」)
 *   - ボール本体は高度に応じて地上の約2.5〜3倍まで拡大する
 * この2点を tests/render/ballVisual.test.ts が恒久ゲートとして守る。
 */

import {
  BALL_HEIGHT_GROW_PER_PX,
  BALL_HEIGHT_LIFT_SCALE,
  BALL_SHADOW_SHRINK_PER_PX,
} from './viewConstants';

/** 接地影の不透明度 (高さによらず一定 — 原作準拠)。 */
export const BALL_SHADOW_ALPHA = 0.4;

/**
 * 地上のボールでも影が「ボールの真下の縁」として見えるようにする画面Yオフセット (near px)。
 * 原作 (vf2058: 地面のボールの下に暗いピクセルが覗く) に合わせた小さな値。
 */
export const BALL_SHADOW_GROUND_OFFSET_PX = 6;

export interface BallVisual {
  /** 本体の画面Yを、地面の投影点からどれだけ持ち上げるか (screen px)。 */
  readonly liftPx: number;
  /** 本体の表示スケール (投影スケール p.scale に対する乗数込みの最終値)。 */
  readonly bodyScale: number;
  /** 影の表示スケール。 */
  readonly shadowScale: number;
  /** 影の不透明度。 */
  readonly shadowAlpha: number;
  /** 影の画面Yオフセット (地面投影点からの下方向ずらし、screen px)。 */
  readonly shadowOffsetY: number;
}

/**
 * @param heightPx ボールの高さ (ワールドpx、sim の ball.height を float 化した値)
 * @param projScale 投影の見かけ拡大率 (near=1.0 に正規化された p.scale)
 */
export function computeBallVisual(heightPx: number, projScale: number): BallVisual {
  return {
    liftPx: heightPx * projScale * BALL_HEIGHT_LIFT_SCALE,
    bodyScale: projScale * (1 + heightPx * BALL_HEIGHT_GROW_PER_PX),
    // 影は「気持ち程度」しか縮めない (最大高さ≈52pxで約17%減)。透明化はしない。
    shadowScale: projScale / (1 + heightPx * BALL_SHADOW_SHRINK_PER_PX),
    shadowAlpha: BALL_SHADOW_ALPHA,
    shadowOffsetY: BALL_SHADOW_GROUND_OFFSET_PX * projScale,
  };
}
