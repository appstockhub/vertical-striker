import { clampFixed, distSqFixed, dotFixed, fixedAdd, fixedMul, fixedSub, toFixed, vZero, ZERO_FIXED } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { Direction8, type ButtonState } from '../input/types';
import { TeamId } from './formations';
import type { BallState, PlayerState } from './state';
import { PITCH_WIDTH } from '../config/pitch';
import { quantizeToDirection8 } from './steering';
import {
  CATCH_MAX_SPEED_FIXED,
  CATCH_RANGE_SQ_FIXED,
  GK_AUTO_TAKEOVER_RADIUS_SQ_FIXED,
  GK_COVERAGE_RADIUS_FIXED,
  GK_SAVE_RANGE_SQ_FIXED,
  PUNCH_RANGE_SQ_FIXED,
} from './goalkeeperConstants';

const GOAL_CENTER_X: Fixed = toFixed(PITCH_WIDTH / 2);
// 0 だと「ちょうど目標位置にいる (差ベクトル=(0,0))」場合に quantizeToDirection8 の
// デッドゾーン判定が `magSq(0) < deadzoneSq(0)` = false になって素通りし、8方向タイブレークの
// 先頭 (Up) にフォールバックしてしまう (実際にテストで踏んだ回帰)。ごく小さい正の値にする。
const AI_STEER_DEADZONE_SQ: Fixed = fixedMul(toFixed(0.5), toFixed(0.5));

/**
 * キーパーの自動ステアリング目標位置。ゴールライン上、ボールのx位置に追従しつつ
 * GK_COVERAGE_RADIUS でクランプする。y座標はホームポジション (フォーメーションのGK深さ) を維持する。
 */
export function computeGoalkeeperTargetPos(gk: PlayerState, ballPos: Vec2Fixed): Vec2Fixed {
  const targetX = clampFixed(
    ballPos.x,
    fixedSub(GOAL_CENTER_X, GK_COVERAGE_RADIUS_FIXED),
    fixedAdd(GOAL_CENTER_X, GK_COVERAGE_RADIUS_FIXED),
  );
  return { x: targetX, y: gk.pos.y };
}

/**
 * 自動モード (人間が操作していない側のGK) の1tickぶんの操作方向。
 * 「反応速度」は呼び出し側 (sim/update.ts) が GK_AUTO_SPEED_FIXED を使って
 * 通常より遅い速度でこの方向へ動かすことで表現する (パラメータ化された反応速度)。
 */
export function computeGoalkeeperAutoDirection(gk: PlayerState, ballPos: Vec2Fixed): Direction8 {
  const target = computeGoalkeeperTargetPos(gk, ballPos);
  const toTarget = { x: fixedSub(target.x, gk.pos.x), y: fixedSub(target.y, gk.pos.y) };
  return quantizeToDirection8(toTarget, AI_STEER_DEADZONE_SQ);
}

/**
 * Team A GK への自動交代 (手動操作の乗っ取り) が発生すべきか。
 * ボールが近づいた場合、または L を押し続けていて Team A がボールを保持していない場合。
 * 呼び出し側 (sim/update.ts) で「操作選手がキック溜め中/タックル中はガードする」を担う。
 */
export function shouldTakeOverGoalkeeper(
  goalkeeper: PlayerState,
  ballPos: Vec2Fixed,
  buttons: ButtonState,
  teamAInPossession: boolean,
): boolean {
  const nearBall = (distSqFixed(goalkeeper.pos, ballPos) as number) <= (GK_AUTO_TAKEOVER_RADIUS_SQ_FIXED as number);
  const lWantsGoalkeeper = buttons.L && !teamAInPossession;
  return nearBall || lWantsGoalkeeper;
}

/** ボールがキーパーのセーブ文脈 (Y=キャッチ/B=パンチング) に入る範囲内か。 */
export function isInSaveRange(goalkeeper: PlayerState, ballPos: Vec2Fixed): boolean {
  return (distSqFixed(goalkeeper.pos, ballPos) as number) <= (GK_SAVE_RANGE_SQ_FIXED as number);
}

export type SaveOutcome = 'secured' | 'deflected' | 'missed';

/**
 * セーブ判定 (純関数)。CLAUDE.mdの「確実に届くならY、ギリギリならB、
 * ただしBのこぼれ球は詰められるリスク」に対応:
 * - キャッチ(Y): CATCH_RANGE以内 かつ 速度がCATCH_MAX_SPEED以下 -> 確保 (secured)。
 *   範囲内だが速すぎる -> 弾く (deflected、パンチングと同じ扱い)。範囲外 -> 届かない (missed)。
 * - パンチング(B): PUNCH_RANGE以内なら常に弾く (deflected)。範囲外 -> 届かない (missed)。
 */
export function resolveSaveOutcome(
  goalkeeper: PlayerState,
  ball: BallState,
  action: 'catch' | 'punch',
): SaveOutcome {
  const distSq = distSqFixed(goalkeeper.pos, ball.pos) as number;

  if (action === 'catch') {
    if (distSq > (CATCH_RANGE_SQ_FIXED as number)) return 'missed';
    const speedSq = dotFixed(ball.vel, ball.vel) as number;
    const maxSpeedSq = fixedMul(CATCH_MAX_SPEED_FIXED, CATCH_MAX_SPEED_FIXED) as number;
    return speedSq <= maxSpeedSq ? 'secured' : 'deflected';
  }

  return distSq <= (PUNCH_RANGE_SQ_FIXED as number) ? 'deflected' : 'missed';
}

/**
 * セーブの結果をボールに適用する。
 * secured: キーパーの位置で確保 (速度0、地面に静止)。
 * deflected: 自陣ゴールから遠ざける向きへy速度の符号を強制する (大きさは維持)。
 *   RNGは使わず、符号を強制するだけの決定論的な跳ね返り。x速度は維持する。
 */
export function applySave(ball: BallState, goalkeeper: PlayerState, outcome: SaveOutcome): BallState {
  if (outcome === 'missed') return ball;

  if (outcome === 'secured') {
    return { pos: goalkeeper.pos, vel: vZero(), height: ZERO_FIXED, zVel: ZERO_FIXED };
  }

  const magnitude = Math.abs(ball.vel.y as number);
  const sign = goalkeeper.team === TeamId.A ? -1 : 1; // Team A の自陣ゴールは大きいy側 -> 遠ざけるには-y
  const deflectedVelY = (sign * magnitude) as Fixed;

  return { ...ball, vel: { x: ball.vel.x, y: deflectedVelY } };
}
