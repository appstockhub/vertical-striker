import { clampFixed, fixedDiv, fixedMul, fixedSub, lerpFixed, toFixed, vScaleFixed, ZERO_FIXED } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { Direction8, LogicalButton, type ButtonState } from '../input/types';
import type { BallState, PlayerState } from './state';
import { DIRECTION_VECTORS } from './constants';
import {
  GRAVITY_FIXED,
  HIGH_ARC_SPEED_MULTIPLIER_FIXED,
  KICK_MAX_CHARGE_FRAMES,
  KICK_MIN_CHARGE_FRAMES,
  KICK_Z_VEL_MAX_FIXED,
  KICK_Z_VEL_MIN_FIXED,
  LONG_FEED_DISTANCE_FIXED,
  LONG_FEED_SPEED_FIXED,
  PASS_GROUND_MAX_DIST_FIXED,
  PASS_GROUND_SPEED_PER_DIST_FIXED,
  PASS_LOB_SPEED_FIXED,
  PASS_MAX_GROUND_SPEED_FIXED,
  PASS_MAX_LOB_Z_FIXED,
  PASS_MIN_LOB_Z_FIXED,
  PASS_MIN_SPEED_FIXED,
  STRONG_KICK_SPEED_FIXED,
  WEAK_KICK_SPEED_FIXED,
} from './ballConstants';

/**
 * ★24周目サイクル③ (不具合#2-③ / P1)★ カーソルパス・CPUパスの実照準キック。
 *
 * 旧実装は「受け手の方向を8方向に量子化 + 強キック固定速度(2.7)」で、
 *   - 量子化で最大22.5°ずれて受け手の脇へ逸れる
 *   - グラウンダーの到達距離(約82px)を超える受け手には物理的に届かない
 * という二重の理由で「Yパスが誰にも通らない」不具合の一因だった。
 *
 * 新実装:
 *   - 方向は受け手への正確なベクトル (照準スキルの対象はB/シフトキック。カーソルパスは
 *     「確実だが受け手を選べない」自動補足なので、量子化しない方が仕様に忠実)
 *   - 近距離 (PASS_GROUND_MAX_DIST 以下) は距離連動の速度のグラウンダー
 *     (到達時に少し勢いが残る係数。P1ゲートの帯 1.2〜2.2px/tick に概ね収まる)
 *   - 遠距離は浮き球で通す (空中は転がり摩擦が無いため、zVel を距離から逆算して
 *     受け手の足元に落とす。「浮かせて前線へ送る」原作のロビングの物理)
 *
 * 決定論: Math.sqrt はIEEE754で正確に丸められるため使用可 (dribble.ts の前例と同じ)。
 * 戻りは必ず floor して Fixed の整数不変条件を守る。
 */
export function applyAimedPass(ball: BallState, from: Vec2Fixed, targetPos: Vec2Fixed): BallState {
  const dx = fixedSub(targetPos.x, from.x);
  const dy = fixedSub(targetPos.y, from.y);
  const distSq = (fixedMul(dx, dx) as number) + (fixedMul(dy, dy) as number);
  if (distSq <= 0) return ball;
  const dist = Math.floor(Math.sqrt(distSq * 256)) as Fixed; // Fixedスケールの距離 (px*256)

  if ((dist as number) <= (PASS_GROUND_MAX_DIST_FIXED as number)) {
    // グラウンダー: v = clamp(dist × 係数)。摩擦0.968で「距離の約1.2倍」転がる係数なので、
    // 受け手に届いた時点で拾いやすい残速になる。
    const speed = clampFixed(
      fixedMul(dist, PASS_GROUND_SPEED_PER_DIST_FIXED),
      PASS_MIN_SPEED_FIXED,
      PASS_MAX_GROUND_SPEED_FIXED,
    );
    const vel = { x: fixedDiv(fixedMul(dx, speed), dist), y: fixedDiv(fixedMul(dy, speed), dist) };
    return { ...ball, vel, zVel: ZERO_FIXED };
  }

  // ロビング: 水平速度は固定 (PASS_LOB_SPEED)、滞空時間 t=2·zVel/g で dist を飛ぶよう
  // zVel = dist·g/(2·vx) を逆算する。
  const vel = {
    x: fixedDiv(fixedMul(dx, PASS_LOB_SPEED_FIXED), dist),
    y: fixedDiv(fixedMul(dy, PASS_LOB_SPEED_FIXED), dist),
  };
  const zVel = clampFixed(
    fixedDiv(fixedMul(dist, GRAVITY_FIXED), fixedMul(toFixed(2), PASS_LOB_SPEED_FIXED)),
    PASS_MIN_LOB_Z_FIXED,
    PASS_MAX_LOB_Z_FIXED,
  );
  return { ...ball, vel, zVel };
}

/**
 * X = ロングフィード (24周目サイクル④)。方向キックの弾道版: 水平速度は固定
 * (LONG_FEED_SPEED)、zVel は狙い飛距離 (LONG_FEED_DISTANCE) から逆算する
 * (applyAimedPass のロビングと同じ物理。gravity を変えても飛距離が保たれる)。
 * 方向は+字 (無入力なら向いている方向)、シフトキック対応。
 */
export function applyLongFeed(
  ball: BallState,
  player: PlayerState,
  releaseDirection: Direction8,
  buttons?: Pick<ButtonState, LogicalButton.L | LogicalButton.R>,
): BallState {
  const baseDirection = releaseDirection !== Direction8.None ? releaseDirection : player.facing;
  const shiftedDirection = buttons ? shiftKickDirection(baseDirection, buttons) : baseDirection;
  const vel = vScaleFixed(DIRECTION_VECTORS[shiftedDirection], LONG_FEED_SPEED_FIXED);
  const zVel = fixedDiv(
    fixedMul(LONG_FEED_DISTANCE_FIXED, GRAVITY_FIXED),
    fixedMul(toFixed(2), LONG_FEED_SPEED_FIXED),
  );
  return { ...ball, vel, zVel };
}

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
