/**
 * 縦スクロールカメラの Y 座標計算 (純関数、描画専用)。
 *
 * カメラのスクロール位置は GameState に含めない —
 * ネット対戦/リプレイで一致する必要がない「見た目」の状態だからである。
 * そのため sim/ とは異なり、ここでは float のイージングを許可する。
 *
 * Phase 0 の暫定仕様: ボールが静止しているため、追従ターゲットには
 * プレイヤー座標を渡す (Phase 1 でボール追従に切り替える際もこの関数の
 * シグネチャは変わらず、呼び出し側の引数を差し替えるだけでよい)。
 */

export interface CameraConfig {
  readonly viewportHeight: number;
  readonly pitchHeight: number;
  /** 進行方向の先読みオフセット量の上限 (px)。 */
  readonly lookAheadMax: number;
  /** この速度(px/tick)で lookAheadMax に達する。 */
  readonly lookAheadVelRef: number;
  /** 0〜1。1に近いほど追従が速い (イージング係数)。 */
  readonly smoothing: number;
}

export function computeCameraY(
  targetY: number,
  targetVelY: number,
  prevCameraY: number,
  cfg: CameraConfig,
): number {
  const lookAheadRaw = (targetVelY / cfg.lookAheadVelRef) * cfg.lookAheadMax;
  const lookAhead = Math.max(-cfg.lookAheadMax, Math.min(cfg.lookAheadMax, lookAheadRaw));

  const desired = clamp(
    targetY - cfg.viewportHeight / 2 + lookAhead,
    0,
    Math.max(0, cfg.pitchHeight - cfg.viewportHeight),
  );

  return prevCameraY + (desired - prevCameraY) * cfg.smoothing;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
