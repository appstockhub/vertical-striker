import { describe, expect, it } from 'vitest';
import { toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import {
  applySave,
  computeGoalkeeperAutoDirection,
  computeGoalkeeperTargetPos,
  isInSaveRange,
  resolveSaveOutcome,
  shouldTakeOverGoalkeeper,
} from '../../src/sim/goalkeeperAI';
import { CATCH_MAX_SPEED_FIXED, GK_COVERAGE_RADIUS_FIXED } from '../../src/sim/goalkeeperConstants';
import { TeamId } from '../../src/sim/formations';
import { TacklePhase, type BallState, type PlayerState } from '../../src/sim/state';
import { Direction8, emptyButtonState } from '../../src/input/types';
import { PITCH_WIDTH } from '../../src/config/pitch';

function makeGK(x: number, y: number, team: TeamId): PlayerState {
  return {
    pos: { x: toFixed(x), y: toFixed(y) },
    vel: { x: ZERO_FIXED, y: ZERO_FIXED },
    facing: team === TeamId.A ? Direction8.Up : Direction8.Down,
    kickChargeFrames: 0,
    team,
    isGoalkeeper: true,
    slotIndex: 0,
    tacklePhase: TacklePhase.None,
    tackleFrames: 0,
    tackleDirection: Direction8.None,
  };
}

function makeBall(x: number, y: number, velX = 0, velY = 0): BallState {
  return {
    pos: { x: toFixed(x), y: toFixed(y) },
    vel: { x: toFixed(velX), y: toFixed(velY) },
    height: ZERO_FIXED,
    zVel: ZERO_FIXED,
  };
}

const GOAL_CENTER_X = PITCH_WIDTH / 2;

describe('computeGoalkeeperTargetPos / computeGoalkeeperAutoDirection', () => {
  it('tracks the ball x position (quantized to an 8px grid) while staying clamped within the coverage radius', () => {
    const gk = makeGK(GOAL_CENTER_X, 1780, TeamId.A);
    const ballNearCenter = { x: toFixed(GOAL_CENTER_X + 10), y: ZERO_FIXED };
    const target = computeGoalkeeperTargetPos(gk, ballNearCenter);
    // ボールx=250 は8pxグリッドに量子化されて248になる (ジッター防止、observer simulatorで発覚した修正)
    expect(toFloat(target.x)).toBeCloseTo(248, 1);
    expect(target.y).toBe(gk.pos.y); // homeY未指定時は現在のyを維持
  });

  it('returns toward the provided formation home y when displaced (does not stay stranded upfield)', () => {
    const gk = makeGK(GOAL_CENTER_X, 1500, TeamId.A); // セーブ後などでゴール前から離れてしまった状態
    const ball = { x: toFixed(GOAL_CENTER_X), y: toFixed(900) };
    const homeY = toFixed(1764);
    const target = computeGoalkeeperTargetPos(gk, ball, homeY);
    expect(target.y).toBe(homeY);
    expect(computeGoalkeeperAutoDirection(gk, ball, homeY)).toBe(Direction8.Down); // 自陣ゴールへ戻る
  });

  it('clamps the target x to the coverage radius when the ball is far to one side', () => {
    const gk = makeGK(GOAL_CENTER_X, 1780, TeamId.A);
    const ballFarRight = { x: toFixed(GOAL_CENTER_X + 500), y: ZERO_FIXED };
    const target = computeGoalkeeperTargetPos(gk, ballFarRight);
    expect(toFloat(target.x)).toBeCloseTo(GOAL_CENTER_X + toFloat(GK_COVERAGE_RADIUS_FIXED), 1);
  });

  it('moves right when the ball is to the right of the goalkeeper', () => {
    const gk = makeGK(GOAL_CENTER_X, 1780, TeamId.A);
    const ballRight = { x: toFixed(GOAL_CENTER_X + 30), y: gk.pos.y };
    expect(computeGoalkeeperAutoDirection(gk, ballRight)).toBe(Direction8.Right);
  });

  it('stays put (None) when already at the target position', () => {
    const gk = makeGK(GOAL_CENTER_X, 1780, TeamId.A);
    const ballAtCenter = { x: toFixed(GOAL_CENTER_X), y: gk.pos.y };
    expect(computeGoalkeeperAutoDirection(gk, ballAtCenter)).toBe(Direction8.None);
  });
});

describe('shouldTakeOverGoalkeeper', () => {
  const gk = makeGK(GOAL_CENTER_X, 1780, TeamId.A);
  const buttonsNone = emptyButtonState();
  const buttonsL = { ...emptyButtonState(), L: true };

  it('is true when the ball is close, regardless of buttons', () => {
    const closeBall = { x: gk.pos.x, y: toFixed(1770) };
    expect(shouldTakeOverGoalkeeper(gk, closeBall, buttonsNone, true)).toBe(true);
  });

  it('is false when the ball is far and L is not held', () => {
    const farBall = { x: gk.pos.x, y: ZERO_FIXED };
    expect(shouldTakeOverGoalkeeper(gk, farBall, buttonsNone, true)).toBe(false);
  });

  it('★18周目に廃止★ Lボタンではキーパーへ交代しない (仕様外の割当だった)', () => {
    // L/R はシフトキック・蹴り出しドリブル(L+R)・パスカーソル切替に使うため、
    // 「Lでキーパーへ交代」と正面衝突していた。実ブラウザで、蹴り出しドリブル中に
    // カーソルが毎tickキーパーへ飛んでドリブルが壊れるのを実測したため削除した。
    const farBall = { x: gk.pos.x, y: ZERO_FIXED };
    expect(shouldTakeOverGoalkeeper(gk, farBall, buttonsL, false)).toBe(false);
    expect(shouldTakeOverGoalkeeper(gk, farBall, buttonsL, true)).toBe(false);
  });
});

describe('isInSaveRange / resolveSaveOutcome', () => {
  const gk = makeGK(0, 0, TeamId.A);

  it('is not in save range when the ball is far away', () => {
    expect(isInSaveRange(gk, { x: toFixed(500), y: toFixed(500) })).toBe(false);
  });

  it('is in save range when the ball is close', () => {
    expect(isInSaveRange(gk, { x: toFixed(5), y: toFixed(5) })).toBe(true);
  });

  it('catch secures a slow ball within catch range', () => {
    const ball = makeBall(3, 0, 1, 0); // 遅い速度
    expect(resolveSaveOutcome(gk, ball, 'catch')).toBe('secured');
  });

  it('catch deflects a fast ball even within catch range', () => {
    const fastBall = makeBall(3, 0, toFloat(CATCH_MAX_SPEED_FIXED) + 5, 0);
    expect(resolveSaveOutcome(gk, fastBall, 'catch')).toBe('deflected');
  });

  it('catch misses when the ball is outside the (short) catch range', () => {
    // CATCH_RANGE を 14→20px に広げたため (実プレイ「キーパーがキャッチしない」対応、
    // goalkeeperConstants.ts 参照)、旧値20pxは今や範囲「内」。範囲外の例を 26px に更新する
    // (PUNCH_RANGE=30px よりは近い、という元テストの意図は維持)。
    const ball = makeBall(26, 0, 1, 0);
    expect(resolveSaveOutcome(gk, ball, 'catch')).toBe('missed');
  });

  it('punch always deflects within its (longer) range regardless of speed', () => {
    const fastBall = makeBall(20, 0, 20, 0);
    expect(resolveSaveOutcome(gk, fastBall, 'punch')).toBe('deflected');
  });

  it('punch misses when the ball is outside the punch range', () => {
    const farBall = makeBall(500, 0, 1, 0);
    expect(resolveSaveOutcome(gk, farBall, 'punch')).toBe('missed');
  });
});

describe('applySave', () => {
  const gk = makeGK(100, 1780, TeamId.A);

  it('secured: ball snaps to the goalkeeper position with zero velocity', () => {
    const ball = makeBall(90, 1770, 5, -5);
    const next = applySave(ball, gk, 'secured', 1);
    expect(next.pos).toEqual(gk.pos);
    expect(next.vel.x).toBe(ZERO_FIXED);
    expect(next.vel.y).toBe(ZERO_FIXED);
  });

  it('deflected: Team A goalkeeper forces the ball back toward negative y (away from their goal)', () => {
    const incoming = makeBall(90, 1770, 3, 8); // 自陣ゴール(大きいy側)に向かっている
    const next = applySave(incoming, gk, 'deflected', 1);
    expect(toFloat(next.vel.y)).toBeLessThan(0);
    // ★24周目-6 (台帳L-05)★ 旧仕様「大きさは維持」を撤回: 原作のパンチはこぼれ球の
    // 詰め合いを作る (強シュートがそのままの速度で戻ると誰も追いつけない)。
    // 水平は0.6へ減衰し、上向きのzVelで浮かせる (gkPunch.test.ts が正本のゲート)。
    expect(Math.abs(toFloat(next.vel.y))).toBeCloseTo(8 * 0.6, 1);
    expect(toFloat(next.zVel)).toBeGreaterThan(0); // 浮いたこぼれ球
  });

  it('deflected: Team B goalkeeper forces the ball toward positive y', () => {
    const gkB = makeGK(100, 20, TeamId.B);
    const incoming = makeBall(90, 30, 3, -8);
    const next = applySave(incoming, gkB, 'deflected', 1);
    expect(toFloat(next.vel.y)).toBeGreaterThan(0);
  });

  it('missed: the ball is unaffected', () => {
    const ball = makeBall(90, 1770, 3, 8);
    const next = applySave(ball, gk, 'missed', 1);
    expect(next).toEqual(ball);
  });
});
