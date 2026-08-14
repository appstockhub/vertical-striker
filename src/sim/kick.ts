import { clampFixed, fixedDiv, fixedMul, lerpFixed, toFixed, vScaleFixed, ZERO_FIXED } from '../core/fixed';
import type { Fixed } from '../core/types';
import { Direction8 } from '../input/types';
import type { BallState, PlayerState } from './state';
import { DIRECTION_VECTORS } from './constants';
import {
  HIGH_ARC_SPEED_MULTIPLIER_FIXED,
  KICK_MAX_CHARGE_FRAMES,
  KICK_MIN_CHARGE_FRAMES,
  KICK_Z_VEL_MAX_FIXED,
  KICK_Z_VEL_MIN_FIXED,
  STRONG_KICK_SPEED_FIXED,
  WEAK_KICK_SPEED_FIXED,
} from './ballConstants';

export interface KickChargeResult {
  readonly nextFrames: number;
  /** >0 のとき、このtickが解放(キック実行)のtick。値は溜めていたtick数。 */
  readonly releasedFrames: number;
}

/**
 * キックの溜め管理 (純粋な整数カウンタ)。Inputs には edge 情報を持たせず、
 * 前tickまでの蓄積 (prevFrames) と今tickの Bボタン状態だけで立ち上がり/立ち下がりの
 * 両方を導出する。
 */
export function updateKickCharge(prevFrames: number, bHeld: boolean): KickChargeResult {
  if (bHeld) {
    return { nextFrames: Math.min(prevFrames + 1, KICK_MAX_CHARGE_FRAMES), releasedFrames: 0 };
  }
  if (prevFrames > 0) {
    return { nextFrames: 0, releasedFrames: prevFrames }; // このtickが解放
  }
  return { nextFrames: 0, releasedFrames: 0 };
}

const CHARGE_RANGE_FIXED: Fixed = toFixed(KICK_MAX_CHARGE_FRAMES - KICK_MIN_CHARGE_FRAMES);

/**
 * キック実行 (速度軸+弾道軸)。releasedFrames > 0 かつ tick開始時点で近接していた場合にのみ
 * 呼ばれる想定。方向入力の有無で弱キック/強キックを分け (速度軸)、溜め時間で弾道の高さと
 * 水平速度の減衰を決める (弾道軸)。精密照準・カーブ/バックスピンは対象外 (後続フェーズ)。
 */
export function applyKick(
  ball: BallState,
  player: PlayerState,
  releasedFrames: number,
  releaseDirection: Direction8,
): BallState {
  const isStrong = releaseDirection !== Direction8.None;
  const baseSpeed: Fixed = isStrong ? STRONG_KICK_SPEED_FIXED : WEAK_KICK_SPEED_FIXED;
  const dir = DIRECTION_VECTORS[isStrong ? releaseDirection : player.facing];

  const chargeRatio = clampFixed(
    fixedDiv(toFixed(releasedFrames - KICK_MIN_CHARGE_FRAMES), CHARGE_RANGE_FIXED),
    ZERO_FIXED,
    toFixed(1),
  );

  const zVel = lerpFixed(KICK_Z_VEL_MIN_FIXED, KICK_Z_VEL_MAX_FIXED, chargeRatio);
  const speedMul = lerpFixed(toFixed(1), HIGH_ARC_SPEED_MULTIPLIER_FIXED, chargeRatio);
  const vel = vScaleFixed(dir, fixedMul(baseSpeed, speedMul));

  return { ...ball, vel, zVel };
}
