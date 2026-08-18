import { describe, expect, it } from 'vitest';
import { toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import {
  advanceTacklePhase,
  applyTackleWin,
  checkTackleEligibility,
  checkTackleSuccess,
  getTackleMovementOverride,
} from '../../src/sim/tackle';
import {
  TACKLE_ACTIVE_FRAMES,
  TACKLE_RECOVERY_FRAMES,
  TACKLE_SLIDE_SPEED_FIXED,
  TACKLE_WINDUP_FRAMES,
  TACKLE_WIN_SPEED_FIXED,
} from '../../src/sim/tackleConstants';
import { TeamId } from '../../src/sim/formations';
import { TacklePhase, type BallState, type PlayerState } from '../../src/sim/state';
import { Direction8 } from '../../src/input/types';

function makePlayer(
  x: number,
  y: number,
  team: TeamId,
  overrides: Partial<PlayerState> = {},
): PlayerState {
  return {
    pos: { x: toFixed(x), y: toFixed(y) },
    vel: { x: ZERO_FIXED, y: ZERO_FIXED },
    facing: Direction8.Up,
    kickChargeFrames: 0,
    team,
    isGoalkeeper: false,
    slotIndex: 1,
    tacklePhase: TacklePhase.None,
    tackleFrames: 0,
    tackleDirection: Direction8.None,
    ...overrides,
  };
}

function makeBall(x: number, y: number): BallState {
  return { pos: { x: toFixed(x), y: toFixed(y) }, vel: { x: ZERO_FIXED, y: ZERO_FIXED }, height: ZERO_FIXED, zVel: ZERO_FIXED };
}

describe('checkTackleEligibility', () => {
  it('is eligible when directly behind an opponent facing the same way, within range, with an input direction', () => {
    // carrier(y=0) は Up (北、小さいy方向) を向いて北へ移動中。tackler はその南 (=背後、大きいy) にいる。
    const carrier = makePlayer(0, 0, TeamId.B, { facing: Direction8.Up });
    const tackler = makePlayer(0, 10, TeamId.A);
    const players = [carrier, tackler];
    expect(checkTackleEligibility(tackler, players, 0, Direction8.Up)).toBe(true);
  });

  it('is not eligible without an input direction (cannot slide nowhere)', () => {
    const carrier = makePlayer(0, 0, TeamId.B, { facing: Direction8.Up });
    const tackler = makePlayer(0, 10, TeamId.A);
    const players = [carrier, tackler];
    expect(checkTackleEligibility(tackler, players, 0, Direction8.None)).toBe(false);
  });

  it('is not eligible against a teammate (same team)', () => {
    const carrier = makePlayer(0, 0, TeamId.A, { facing: Direction8.Up });
    const tackler = makePlayer(0, 10, TeamId.A);
    const players = [carrier, tackler];
    expect(checkTackleEligibility(tackler, players, 0, Direction8.Up)).toBe(false);
  });

  it('is not eligible when the tackler is in front of the carrier (not behind)', () => {
    // carrier(y=10) は Up (小さいy方向) を向いている。tackler が北側(carrierの前方、小さいy)にいる = 背後ではない。
    const carrier = makePlayer(0, 10, TeamId.B, { facing: Direction8.Up });
    const tackler = makePlayer(0, 0, TeamId.A);
    const players = [carrier, tackler];
    expect(checkTackleEligibility(tackler, players, 0, Direction8.Up)).toBe(false);
  });

  it('is not eligible when out of range', () => {
    const carrier = makePlayer(0, 0, TeamId.B, { facing: Direction8.Up });
    const tackler = makePlayer(0, 500, TeamId.A);
    const players = [carrier, tackler];
    expect(checkTackleEligibility(tackler, players, 0, Direction8.Up)).toBe(false);
  });

  it('is not eligible when nobody holds touch-priority', () => {
    const tackler = makePlayer(0, 0, TeamId.A);
    expect(checkTackleEligibility(tackler, [tackler], null, Direction8.Up)).toBe(false);
  });
});

describe('advanceTacklePhase', () => {
  it('stays None when not triggered', () => {
    const player = makePlayer(0, 0, TeamId.A);
    const next = advanceTacklePhase(player, false, Direction8.Up);
    expect(next.tacklePhase).toBe(TacklePhase.None);
  });

  it('transitions None -> Windup on trigger, locking the direction', () => {
    const player = makePlayer(0, 0, TeamId.A);
    const next = advanceTacklePhase(player, true, Direction8.UpRight);
    expect(next.tacklePhase).toBe(TacklePhase.Windup);
    expect(next.tackleFrames).toBe(TACKLE_WINDUP_FRAMES);
    expect(next.tackleDirection).toBe(Direction8.UpRight);
  });

  it('counts down through Windup -> Active -> Recovery -> None over the full duration', () => {
    let player = makePlayer(0, 0, TeamId.A);
    let advance = advanceTacklePhase(player, true, Direction8.Up);
    player = { ...player, ...advance };

    // Windupを消化
    for (let i = 1; i < TACKLE_WINDUP_FRAMES; i++) {
      advance = advanceTacklePhase(player, false, Direction8.None);
      player = { ...player, ...advance };
      expect(player.tacklePhase).toBe(TacklePhase.Windup);
    }
    advance = advanceTacklePhase(player, false, Direction8.None);
    player = { ...player, ...advance };
    expect(player.tacklePhase).toBe(TacklePhase.Active);
    expect(player.tackleFrames).toBe(TACKLE_ACTIVE_FRAMES);

    // Activeを消化
    for (let i = 1; i < TACKLE_ACTIVE_FRAMES; i++) {
      advance = advanceTacklePhase(player, false, Direction8.None);
      player = { ...player, ...advance };
      expect(player.tacklePhase).toBe(TacklePhase.Active);
    }
    advance = advanceTacklePhase(player, false, Direction8.None);
    player = { ...player, ...advance };
    expect(player.tacklePhase).toBe(TacklePhase.Recovery);
    expect(player.tackleFrames).toBe(TACKLE_RECOVERY_FRAMES);

    // Recoveryを消化
    for (let i = 1; i < TACKLE_RECOVERY_FRAMES; i++) {
      advance = advanceTacklePhase(player, false, Direction8.None);
      player = { ...player, ...advance };
      expect(player.tacklePhase).toBe(TacklePhase.Recovery);
    }
    advance = advanceTacklePhase(player, false, Direction8.None);
    player = { ...player, ...advance };
    expect(player.tacklePhase).toBe(TacklePhase.None);
    expect(player.tackleDirection).toBe(Direction8.None);
  });

  it('ignores a new trigger while already mid-tackle', () => {
    const player = makePlayer(0, 0, TeamId.A, { tacklePhase: TacklePhase.Windup, tackleFrames: 3, tackleDirection: Direction8.Up });
    const next = advanceTacklePhase(player, true, Direction8.Down);
    // Windup中は新規発動を無視し、既存のカウントダウンをそのまま続ける
    expect(next.tacklePhase).toBe(TacklePhase.Windup);
    expect(next.tackleFrames).toBe(2);
    expect(next.tackleDirection).toBe(Direction8.Up);
  });
});

describe('checkTackleSuccess', () => {
  // ★24周目-6 (台帳L-06)★ 成功条件を「ボールに足が届いたか」(ボール基準) へ変更。
  // 旧仕様の背後コーン要求は「横・正面からは重なっていても奪えない」の主因だった。
  it('fails when the ball has been carried out of reach', () => {
    const tackler = makePlayer(0, 10, TeamId.A);
    const movedCarrier = makePlayer(0, 500, TeamId.B, { facing: Direction8.Up });
    const farBall = makeBall(0, 500);
    expect(checkTackleSuccess(tackler, [movedCarrier, tackler], 0, farBall)).toBe(false);
  });

  it('succeeds when the ball is within slide reach', () => {
    const carrier = makePlayer(0, 0, TeamId.B, { facing: Direction8.Up });
    const tackler = makePlayer(0, 10, TeamId.A);
    const nearBall = makeBall(0, 2);
    expect(checkTackleSuccess(tackler, [carrier, tackler], 0, nearBall)).toBe(true);
  });

  it('succeeds from the SIDE too (実プレイ報告「奪えない」の再発防止)', () => {
    // carrier は上向き、tackler は真横 — 旧仕様(背後コーン)では絶対に成立しなかった形
    const carrier = makePlayer(0, 0, TeamId.B, { facing: Direction8.Up });
    const tackler = makePlayer(20, 0, TeamId.A);
    const nearBall = makeBall(5, 0);
    expect(checkTackleSuccess(tackler, [carrier, tackler], 0, nearBall)).toBe(true);
  });

  it('fails when no opposing carrier holds touch-priority (味方のボールは奪わない)', () => {
    const mate = makePlayer(0, 0, TeamId.A, { facing: Direction8.Up });
    const tackler = makePlayer(0, 10, TeamId.A);
    const nearBall = makeBall(0, 2);
    expect(checkTackleSuccess(tackler, [mate, tackler], 0, nearBall)).toBe(false);
  });
});

describe('applyTackleWin', () => {
  it('overwrites ball velocity toward the tackle direction at TACKLE_WIN_SPEED', () => {
    const ball = makeBall(0, 0);
    const next = applyTackleWin(ball, Direction8.Right);
    expect(toFloat(next.vel.x)).toBeCloseTo(toFloat(TACKLE_WIN_SPEED_FIXED), 1);
    expect(next.vel.y).toBe(ZERO_FIXED);
  });
});

describe('getTackleMovementOverride', () => {
  it('freezes movement during Windup', () => {
    const override = getTackleMovementOverride(TacklePhase.Windup, Direction8.Up);
    expect(override.direction).toBe(Direction8.None);
    expect(override.speed).toBeUndefined();
  });

  it('slides in the locked direction during Active at TACKLE_SLIDE_SPEED', () => {
    const override = getTackleMovementOverride(TacklePhase.Active, Direction8.DownLeft);
    expect(override.direction).toBe(Direction8.DownLeft);
    expect(override.speed).toBe(TACKLE_SLIDE_SPEED_FIXED);
  });

  it('slows movement during Recovery but leaves direction to the player input', () => {
    const override = getTackleMovementOverride(TacklePhase.Recovery, Direction8.Up);
    expect(override.direction).toBeUndefined();
    expect(override.speed).toBeDefined();
  });

  it('has no override when None', () => {
    const override = getTackleMovementOverride(TacklePhase.None, Direction8.None);
    expect(override.direction).toBeUndefined();
    expect(override.speed).toBeUndefined();
  });
});
