import { clampFixed, fixedDiv, fixedMul, lerpFixed, toFixed, vScaleFixed, ZERO_FIXED } from '../core/fixed';
import type { Fixed } from '../core/types';
import { Direction8, LogicalButton, type ButtonState } from '../input/types';
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
 * コンパス順(時計回り)の8方向配列。シフトキックの「1段回転」の基準にする。
 * DIRECTION_VECTORSと1:1対応するが、順序(隣接関係)が明示的に必要なためここで別途定義する。
 */
const COMPASS_ORDER: readonly Direction8[] = [
  Direction8.Up,
  Direction8.UpRight,
  Direction8.Right,
  Direction8.DownRight,
  Direction8.Down,
  Direction8.DownLeft,
  Direction8.Left,
  Direction8.UpLeft,
];

/**
 * シフトキック (続編仕様): キック方向をL/Rでコンパス上1段だけ回転させる。
 * R = 時計回り、L = 反時計回り。両方/どちらも押されていない場合は変化しない
 * (両方同時押しはドリブル中の「蹴り出しドリブル」トリガーと文脈が別なので、
 * キック方向としては未定義=無視でよい)。Direction8.Noneはシフト対象外
 * (基準となる方向自体が無いため)。
 */
export function shiftKickDirection(dir: Direction8, buttons: Pick<ButtonState, LogicalButton.L | LogicalButton.R>): Direction8 {
  if (dir === Direction8.None) return dir;
  if (buttons.L === buttons.R) return dir;
  const index = COMPASS_ORDER.indexOf(dir);
  if (index === -1) return dir;
  const step = buttons.R ? 1 : -1;
  const nextIndex = (index + step + COMPASS_ORDER.length) % COMPASS_ORDER.length;
  return COMPASS_ORDER[nextIndex]!;
}

/**
 * キック実行 (速度軸+弾道軸+シフトキック)。releasedFrames > 0 かつ tick開始時点で近接して
 * いた場合にのみ呼ばれる想定。方向入力の有無で弱キック/強キックを分け (速度軸)、溜め時間で
 * 弾道の高さと水平速度の減衰を決める (弾道軸、続編仕様の「押下時間」方式)。
 * buttons省略時(カーソルパス・CPUキック等、人間の直接照準ではない経路)はシフト無し。
 * カーブ/バックスピンは対象外 (後続フェーズ)。
 */
export function applyKick(
  ball: BallState,
  player: PlayerState,
  releasedFrames: number,
  releaseDirection: Direction8,
  buttons?: Pick<ButtonState, LogicalButton.L | LogicalButton.R>,
): BallState {
  const isStrong = releaseDirection !== Direction8.None;
  const baseSpeed: Fixed = isStrong ? STRONG_KICK_SPEED_FIXED : WEAK_KICK_SPEED_FIXED;
  const baseDirection = isStrong ? releaseDirection : player.facing;
  const shiftedDirection = buttons ? shiftKickDirection(baseDirection, buttons) : baseDirection;
  const dir = DIRECTION_VECTORS[shiftedDirection];

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
