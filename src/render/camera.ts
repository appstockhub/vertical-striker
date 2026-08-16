import {
  CAMERA_SMOOTHING,
  CAMERA_X_MAX_FRAC,
  CAMERA_X_MIN_FRAC,
  CAMERA_X_SMOOTHING,
  LOOK_AHEAD_MAX,
  LOOK_AHEAD_VEL_REF,
} from './viewConstants';

/**
 * 注視点 (ボール) 追従の純関数。★描画専用★
 *
 * カメラの状態は GameState に含めない — ネット対戦/リプレイで一致する必要がない
 * 「見た目」だからである。そのため sim/ とは異なり float のイージングを許可する。
 *
 * ★段階1で書き直した★ 16周目の疑似3D化で「カメラのスクロールY」という概念自体が
 * 無くなり (全オブジェクトを画面座標に置き、カメラ移動 = 投影に渡す cameraWorldY を
 * 変えること、と定義が一本化された)、旧・真上視点用の computeCameraY は使われないまま
 * 残っていた。ここでは実際に PitchScene が使う「注視点のワールドYを1フレーム進める」
 * 計算だけを持たせ、カメラ挙動をテストから直接検証できるようにする。
 */

export interface CameraFollowConfig {
  /** 注視点をクランプする下限/上限 (通常は 0..PITCH_HEIGHT)。 */
  readonly minWorldY: number;
  readonly maxWorldY: number;
  /** 進行方向の先読みオフセット量の上限 (ワールドpx)。 */
  readonly lookAheadMax: number;
  /** この速度(px/tick)で lookAheadMax に達する。 */
  readonly lookAheadVelRef: number;
  /** 0〜1。1に近いほど追従が速い (イージング係数)。 */
  readonly smoothing: number;
}

export function makeCameraFollowConfig(pitchHeight: number): CameraFollowConfig {
  return {
    minWorldY: 0,
    maxWorldY: pitchHeight,
    lookAheadMax: LOOK_AHEAD_MAX,
    lookAheadVelRef: LOOK_AHEAD_VEL_REF,
    smoothing: CAMERA_SMOOTHING,
  };
}

/** 先読みを加えた「本来注視したいワールドY」(イージング前の目標値)。 */
export function desiredFocusWorldY(
  ballWorldY: number,
  ballVelY: number,
  cfg: CameraFollowConfig,
): number {
  const raw = (ballVelY / cfg.lookAheadVelRef) * cfg.lookAheadMax;
  const lookAhead = clamp(raw, -cfg.lookAheadMax, cfg.lookAheadMax);
  return clamp(ballWorldY + lookAhead, cfg.minWorldY, cfg.maxWorldY);
}

/** 注視点を1フレーム進める (イージング)。 */
export function followFocusWorldY(
  prevFocusWorldY: number,
  ballWorldY: number,
  ballVelY: number,
  cfg: CameraFollowConfig,
): number {
  const desired = desiredFocusWorldY(ballWorldY, ballVelY, cfg);
  return prevFocusWorldY + (desired - prevFocusWorldY) * cfg.smoothing;
}

/**
 * カメラのワールドXを1フレーム進める (横追従)。
 *
 * カメラ俯角を原作に合わせた結果、ピッチ全幅が画面に入らなくなったため必要になった
 * (viewConstants.ts の CAMERA_X_MIN_FRAC のコメント参照)。縦の追従より遅くして、
 * 左右のドリブルでカメラが小刻みに揺れないようにする。
 */
export function followCameraWorldX(prevCameraX: number, ballWorldX: number, pitchWidth: number): number {
  const desired = clamp(ballWorldX, pitchWidth * CAMERA_X_MIN_FRAC, pitchWidth * CAMERA_X_MAX_FRAC);
  return prevCameraX + (desired - prevCameraX) * CAMERA_X_SMOOTHING;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
