import { distSqFixed, dotFixed, fixedMul, fixedSub, vScaleFixed } from '../core/fixed';
import type { Fixed } from '../core/types';
import { Direction8 } from '../input/types';
import { DIRECTION_VECTORS } from './constants';
import { TacklePhase, type BallState, type PlayerState } from './state';
import {
  CHARGE_RANGE_SQ_FIXED,
  CHARGE_WIN_SPEED_FIXED,
  TACKLE_ACTIVE_FRAMES,
  TACKLE_CONE_COS_THRESHOLD_SQ_FIXED,
  TACKLE_RANGE_SQ_FIXED,
  TACKLE_RECOVERY_FRAMES,
  TACKLE_RECOVERY_SPEED_FIXED,
  TACKLE_SLIDE_SPEED_FIXED,
  TACKLE_WINDUP_FRAMES,
  TACKLE_WIN_SPEED_FIXED,
} from './tackleConstants';

/**
 * 「tackler が carrier の背後から同方向にいる かつ 間合い以内」のジオメトリ判定。
 * 発動判定 (checkTackleEligibility) と Active中の毎tick成功判定 (checkTackleSuccess) の
 * 両方で共有する。sqrtは使わず、dot>0 (正面側ではない) かつ
 * dot^2 >= cosThresholdSq・|carrier.facing|^2・|tackler→carrier|^2 (コーン角内) で判定する。
 */
function isBehindInSameDirection(tackler: PlayerState, carrier: PlayerState): boolean {
  const distSq = distSqFixed(tackler.pos, carrier.pos) as number;
  if (distSq > (TACKLE_RANGE_SQ_FIXED as number)) return false;

  const tacklerToCarrier = { x: fixedSub(carrier.pos.x, tackler.pos.x), y: fixedSub(carrier.pos.y, tackler.pos.y) };
  const carrierFacingVec = DIRECTION_VECTORS[carrier.facing];
  const dot = dotFixed(tacklerToCarrier, carrierFacingVec);
  if ((dot as number) <= 0) return false;

  const dotSq = fixedMul(dot, dot);
  const facingMagSq = dotFixed(carrierFacingVec, carrierFacingVec);
  const toCarrierMagSq = dotFixed(tacklerToCarrier, tacklerToCarrier);
  const threshold = fixedMul(fixedMul(TACKLE_CONE_COS_THRESHOLD_SQ_FIXED, facingMagSq), toCarrierMagSq);

  return (dotSq as number) >= (threshold as number);
}

function resolveOpposingCarrier(
  tackler: PlayerState,
  players: readonly PlayerState[],
  touchPriorityIndex: number | null,
): PlayerState | null {
  if (touchPriorityIndex === null) return null;
  const carrier = players[touchPriorityIndex];
  if (!carrier || carrier.team === tackler.team) return null;
  return carrier;
}

/**
 * タックル発動の判定 (人間操作選手のみ。AIは自律的にタックルしない、Phase 2 スコープ外)。
 * 相手 (別チーム) が touch-priority を保持しており、tackler から見て「背後 かつ 同方向」
 * かつ間合い以内、さらに tackler 自身が方向入力を持っている (スライドする方向が要る) ことを要求する。
 */
export function checkTackleEligibility(
  tackler: PlayerState,
  players: readonly PlayerState[],
  touchPriorityIndex: number | null,
  tacklerInputDirection: Direction8,
): boolean {
  if (tacklerInputDirection === Direction8.None) return false;
  const carrier = resolveOpposingCarrier(tackler, players, touchPriorityIndex);
  return carrier !== null && isBehindInSameDirection(tackler, carrier);
}

/**
 * Active中の成功判定 (毎tick再評価)。
 *
 * ★24周目-6 (台帳L-06「奪えない」の主因修正)★ 成功条件を「スライド中にボールへ足が
 * 届いたか」(ボール基準) に変更した。旧実装は発動条件の名残である背後コーン判定
 * (isBehindInSameDirection) を成功条件にも使っており、**横・正面からのスライドは
 * ボールに重なっていても絶対に奪えなかった**。原作はボールに触れれば奪える
 * (ボールを奪えないまま相手競技者に接触したときだけファウル — sim/foul.ts と対)。
 * CLAUDE.mdの「背後からの読み勝ちタックル」はこの条件の部分集合としてそのまま成立する。
 * 相手キャリアの存在は引き続き要求する (味方が保持しているボールへのスライドで
 * 「奪う」処理が走るのを防ぐ。ルーズボールへのスライドは通常のtouch-priorityが担う)。
 */
export function checkTackleSuccess(
  tackler: PlayerState,
  players: readonly PlayerState[],
  touchPriorityIndex: number | null,
  ball: BallState,
): boolean {
  const carrier = resolveOpposingCarrier(tackler, players, touchPriorityIndex);
  if (carrier === null) return false;
  return (distSqFixed(tackler.pos, ball.pos) as number) <= (TACKLE_RANGE_SQ_FIXED as number);
}

/**
 * ショルダーチャージ (続編仕様、Y/X) の発動判定。実プレイ報告「チャージもない」への対応で新設。
 *
 * スライディング(B)との違いは意図的:
 * - 背後コーンを要求しない (肩をぶつける動作なので、横並び・正面からでも当たる)
 * - 溜め(Windup)が無く、押した瞬間に判定される
 * - 間合いが短く、奪ったボールの勢いも弱い
 * つまり「密着した競り合いで使う低リスク低リターンの選択肢」として、スライディングと
 * 住み分ける。ファウルは当プロジェクトの設計方針どおり発生しない (CLAUDE.md参照)。
 */
export function checkShoulderChargeEligibility(
  charger: PlayerState,
  players: readonly PlayerState[],
  touchPriorityIndex: number | null,
): boolean {
  const carrier = resolveOpposingCarrier(charger, players, touchPriorityIndex);
  if (carrier === null) return false;
  return (distSqFixed(charger.pos, carrier.pos) as number) <= (CHARGE_RANGE_SQ_FIXED as number);
}

/**
 * ショルダーチャージ成功時のボール奪取。チャージした選手の向き (方向入力が無ければ facing)
 * へ押し出す。スライディングより弱い速度で、こぼれ球寄りの奪い方になる。
 */
export function applyShoulderCharge(ball: BallState, chargeDirection: Direction8): BallState {
  const vel = vScaleFixed(DIRECTION_VECTORS[chargeDirection], CHARGE_WIN_SPEED_FIXED);
  return { ...ball, vel };
}

export interface TackleAdvance {
  readonly tacklePhase: TacklePhase;
  readonly tackleFrames: number;
  readonly tackleDirection: Direction8;
}

/**
 * タックル状態機械の1tickぶんの遷移 (純関数)。Windup -> Active -> Recovery -> None。
 * triggered は「このtickにタックルを新規発動するか」(checkTackleEligibility の結果 + B edge)。
 */
export function advanceTacklePhase(
  player: PlayerState,
  triggered: boolean,
  triggerDirection: Direction8,
): TackleAdvance {
  if (player.tacklePhase === TacklePhase.None) {
    if (triggered) {
      return { tacklePhase: TacklePhase.Windup, tackleFrames: TACKLE_WINDUP_FRAMES, tackleDirection: triggerDirection };
    }
    return { tacklePhase: TacklePhase.None, tackleFrames: 0, tackleDirection: Direction8.None };
  }

  const remaining = player.tackleFrames - 1;

  if (player.tacklePhase === TacklePhase.Windup) {
    return remaining <= 0
      ? { tacklePhase: TacklePhase.Active, tackleFrames: TACKLE_ACTIVE_FRAMES, tackleDirection: player.tackleDirection }
      : { tacklePhase: TacklePhase.Windup, tackleFrames: remaining, tackleDirection: player.tackleDirection };
  }

  if (player.tacklePhase === TacklePhase.Active) {
    return remaining <= 0
      ? { tacklePhase: TacklePhase.Recovery, tackleFrames: TACKLE_RECOVERY_FRAMES, tackleDirection: player.tackleDirection }
      : { tacklePhase: TacklePhase.Active, tackleFrames: remaining, tackleDirection: player.tackleDirection };
  }

  // Recovery / ChargeRecovery (どちらも残りフレームを数えてNoneへ戻るだけ)
  return remaining <= 0
    ? { tacklePhase: TacklePhase.None, tackleFrames: 0, tackleDirection: Direction8.None }
    : { tacklePhase: player.tacklePhase, tackleFrames: remaining, tackleDirection: player.tackleDirection };
}

/** 成功時のボール奪取。applyDribbleTouchと同じ「上書き」方式でタックル方向にボールを奪う。ファールは無い。 */
export function applyTackleWin(ball: BallState, tackleDirection: Direction8): BallState {
  const vel = vScaleFixed(DIRECTION_VECTORS[tackleDirection], TACKLE_WIN_SPEED_FIXED);
  return { ...ball, vel };
}

export interface TackleMovementOverride {
  readonly direction: Direction8 | undefined;
  readonly speed: Fixed | undefined;
}

/** タックル中の移動速度上書き。Windup=停止、Active=tackleDirectionへスライド、Recovery/ChargeRecovery=鈍足、None=undefined(通常通り)。 */
export function getTackleMovementOverride(
  tacklePhase: TacklePhase,
  tackleDirection: Direction8,
): TackleMovementOverride {
  switch (tacklePhase) {
    case TacklePhase.Windup:
      return { direction: Direction8.None, speed: undefined };
    case TacklePhase.Active:
      return { direction: tackleDirection, speed: TACKLE_SLIDE_SPEED_FIXED };
    case TacklePhase.Recovery:
    case TacklePhase.ChargeRecovery:
      return { direction: undefined, speed: TACKLE_RECOVERY_SPEED_FIXED };
    case TacklePhase.None:
    default:
      return { direction: undefined, speed: undefined };
  }
}
