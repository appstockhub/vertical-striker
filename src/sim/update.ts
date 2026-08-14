import { fixedMul, vAdd, vSub, ZERO_FIXED } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { Direction8, emptyButtonState, type ButtonState } from '../input/types';
import type { GameState, PlayerState } from './state';
import { TacklePhase } from './state';
import { DIRECTION_VECTORS, PLAYER_RADIUS_FIXED, PLAYER_SPEED_FIXED } from './constants';
import { KICK_MIN_CHARGE_FRAMES, LONG_DRIBBLE_PLAYER_SPEED_FIXED } from './ballConstants';
import { applyDribbleTouch, isLongDribbleActive } from './dribble';
import { applyKick, updateKickCharge } from './kick';
import { clampToPitchBounds, stepBallPhysics } from './ballPhysics';
import { findTouchPriorityPlayer } from './ballTouch';
import { computeNonControlledDirection } from './teamAI';
import { isTeamAInPossession, resolveCursor } from './cursor';
import { quantizeToDirection8 } from './steering';
import {
  applySave,
  computeGoalkeeperAutoDirection,
  isInSaveRange,
  resolveSaveOutcome,
  shouldTakeOverGoalkeeper,
} from './goalkeeperAI';
import { GK_AUTO_SPEED_FIXED } from './goalkeeperConstants';
import {
  advanceTacklePhase,
  applyTackleWin,
  checkTackleEligibility,
  checkTackleSuccess,
  getTackleMovementOverride,
  type TackleAdvance,
} from './tackle';
import { TACKLE_RECOVERY_FRAMES } from './tackleConstants';

/**
 * 1tick分の入力。InputFrame のサブセット (sim/ は入力の生成元を知らない)。
 * キック溜め時間などtickをまたぐ状態はすべて GameState 側 (PlayerState.kickChargeFrames、
 * GameState.prevButtons) に持たせるため、ここに edge (buttonsPressed 等) を追加する必要は無い。
 */
export interface Inputs {
  readonly direction: Direction8;
  readonly buttons: ButtonState;
}

const NO_BUTTONS = emptyButtonState();
const TEAM_A_GK_INDEX = 0;
const NO_TACKLE: TackleAdvance = { tacklePhase: TacklePhase.None, tackleFrames: 0, tackleDirection: Direction8.None };

/**
 * 純関数: 現在の状態と1tick分の入力から次の状態を返す。
 * 既存オブジェクトを変更せず、常に新しいプレーンオブジェクトを返す。
 * Math.random() や Math.sin/cos/atan2 はここでは使用しない
 * (scripts/checkDeterminism.mjs で静的にチェックされる)。
 *
 * Phase 2 (マイルストーン5: スライディングタックル) のパイプライン:
 *   1. touch-priority を決定する。
 *   2. GK自動交代判定 (最優先、キック溜め中/タックル中はガード)。無ければ通常のカーソル解決。
 *   3. 各選手の実効入力 (操作選手=人間入力、非操作GK=専用ステアリング、その他=チームAI)。
 *   4. touch-priority選手のドリブルタッチ。
 *   5. Bボタンの文脈分岐:
 *      a. 操作選手がGKかつセーブ範囲内 -> Y=キャッチ/B=パンチング (最優先)。
 *      b. それ以外: カーソルパス(Y edge) → 操作選手がボール保持中ならBはチャージキック、
 *         非保持ならBはタックル状態機械を進める (新規発動判定 + Active中の毎tick成功判定)。
 *         成功した瞬間にボールを奪い Recovery へ短絡する。
 *   6. ボール物理。
 *   7. 全選手の移動 (touch-priority選手はロングドリブル速度、非操作GKは反応速度、
 *      タックル中の操作選手はフェーズに応じた速度/方向で上書き)。
 */
export function simulate(state: GameState, inputs: Inputs): GameState {
  const touchPriorityIndex = findTouchPriorityPlayer(state.players, state.ball.pos);
  const teamAInPossession = isTeamAInPossession(touchPriorityIndex);

  const teamAGoalkeeper = state.players[TEAM_A_GK_INDEX];
  const currentControlled = state.players[state.controlledPlayerIndex];
  const currentLocked =
    (currentControlled?.kickChargeFrames ?? 0) > 0 ||
    (currentControlled?.tacklePhase ?? TacklePhase.None) !== TacklePhase.None;
  const gkTakeover =
    !currentLocked &&
    !!teamAGoalkeeper &&
    shouldTakeOverGoalkeeper(teamAGoalkeeper, state.ball.pos, inputs.buttons, teamAInPossession);

  const cursor = gkTakeover
    ? { controlledPlayerIndex: TEAM_A_GK_INDEX, passTriggered: false, passTargetIndex: null }
    : resolveCursor(
        state.players,
        state.controlledPlayerIndex,
        touchPriorityIndex,
        state.ball.pos,
        inputs.buttons,
        state.prevButtons,
      );
  const controlledPlayerIndex = cursor.controlledPlayerIndex;
  const controlledPlayer = state.players[controlledPlayerIndex];

  const inSaveRange =
    !!controlledPlayer && controlledPlayer.isGoalkeeper && isInSaveRange(controlledPlayer, state.ball.pos);

  const effectiveInputs: Inputs[] = state.players.map((player, index) => {
    if (index === controlledPlayerIndex) return inputs;
    if (player.isGoalkeeper) {
      return { direction: computeGoalkeeperAutoDirection(player, state.ball.pos), buttons: NO_BUTTONS };
    }
    const direction = computeNonControlledDirection(player, state.players, state.ball.pos, state.teamFormations);
    return { direction, buttons: NO_BUTTONS };
  });

  let ball = state.ball;
  let nextControlledKickChargeFrames = controlledPlayer?.kickChargeFrames ?? 0;
  let tackleAdvance: TackleAdvance = NO_TACKLE;

  const touchInputs = touchPriorityIndex !== null ? effectiveInputs[touchPriorityIndex] : undefined;
  if (touchInputs) {
    ball = applyDribbleTouch(ball, true, touchInputs.direction, touchInputs.buttons);
  }

  if (inSaveRange && controlledPlayer) {
    // セーブ文脈: Y=キャッチ/B=パンチングのみを処理する (カーソルパス/キック溜め/タックルは行わない)。
    const yEdge = inputs.buttons.Y && !state.prevButtons.Y;
    const bEdge = inputs.buttons.B && !state.prevButtons.B;
    if (yEdge) {
      ball = applySave(ball, controlledPlayer, resolveSaveOutcome(controlledPlayer, ball, 'catch'));
    } else if (bEdge) {
      ball = applySave(ball, controlledPlayer, resolveSaveOutcome(controlledPlayer, ball, 'punch'));
    }
  } else {
    if (cursor.passTriggered && cursor.passTargetIndex !== null && controlledPlayer) {
      const receiver = state.players[cursor.passTargetIndex];
      if (receiver) {
        // 確定パス: 溜め不要・低い弾道の速いグラウンダー。方向だけ受け手に向けて上書きする
        // (既存applyKickの速度軸/弾道軸をそのまま再利用、新しい物理モデルは作らない)。
        const passDirection = quantizeToDirection8(vSub(receiver.pos, controlledPlayer.pos), ZERO_FIXED);
        ball = applyKick(ball, controlledPlayer, KICK_MIN_CHARGE_FRAMES, passDirection);
      }
    }

    if (controlledPlayer) {
      const isCarryingBall = touchPriorityIndex === controlledPlayerIndex;

      if (isCarryingBall) {
        // ボール保持中: 既存のチャージキック (タックル状態は自然にNoneへ収束させる)。
        const charge = updateKickCharge(controlledPlayer.kickChargeFrames, inputs.buttons.B);
        nextControlledKickChargeFrames = charge.nextFrames;
        if (charge.releasedFrames > 0) {
          ball = applyKick(ball, controlledPlayer, charge.releasedFrames, inputs.direction);
        }
        tackleAdvance = advanceTacklePhase(controlledPlayer, false, Direction8.None);
      } else {
        // 非保持: Bのedgeでタックルを新規発動できる (既にNoneの時のみ)。
        const bEdge = inputs.buttons.B && !state.prevButtons.B;
        const wantsTackle =
          bEdge &&
          controlledPlayer.tacklePhase === TacklePhase.None &&
          checkTackleEligibility(controlledPlayer, state.players, touchPriorityIndex, inputs.direction);
        tackleAdvance = advanceTacklePhase(controlledPlayer, wantsTackle, inputs.direction);

        if (tackleAdvance.tacklePhase === TacklePhase.Active) {
          if (checkTackleSuccess(controlledPlayer, state.players, touchPriorityIndex)) {
            ball = applyTackleWin(ball, tackleAdvance.tackleDirection);
            // 成功した瞬間にRecoveryへ短絡する (Activeの残り時間を待たない)。
            tackleAdvance = {
              tacklePhase: TacklePhase.Recovery,
              tackleFrames: TACKLE_RECOVERY_FRAMES,
              tackleDirection: tackleAdvance.tackleDirection,
            };
          }
        }
      }
    }
  }

  ball = stepBallPhysics(ball);

  const players = state.players.map((player, index) => {
    const playerInputs = effectiveInputs[index] ?? { direction: Direction8.None, buttons: NO_BUTTONS };
    const longDribble =
      index === touchPriorityIndex && isLongDribbleActive(true, playerInputs.direction, playerInputs.buttons);
    const isAutoGoalkeeper = player.isGoalkeeper && index !== controlledPlayerIndex;

    let effectiveDirection = playerInputs.direction;
    let speedOverride = isAutoGoalkeeper ? GK_AUTO_SPEED_FIXED : undefined;

    if (index === controlledPlayerIndex && tackleAdvance.tacklePhase !== TacklePhase.None) {
      const movementOverride = getTackleMovementOverride(tackleAdvance.tacklePhase, tackleAdvance.tackleDirection);
      if (movementOverride.direction !== undefined) effectiveDirection = movementOverride.direction;
      if (movementOverride.speed !== undefined) speedOverride = movementOverride.speed;
    }

    const moved = updatePlayer(player, effectiveDirection, longDribble, speedOverride);

    if (index !== controlledPlayerIndex) return moved;
    return {
      ...moved,
      kickChargeFrames: nextControlledKickChargeFrames,
      tacklePhase: tackleAdvance.tacklePhase,
      tackleFrames: tackleAdvance.tackleFrames,
      tackleDirection: tackleAdvance.tackleDirection,
    };
  });

  return {
    frame: state.frame + 1,
    rngState: state.rngState,
    players,
    ball,
    controlledPlayerIndex,
    prevButtons: inputs.buttons,
    teamFormations: state.teamFormations,
  };
}

function updatePlayer(
  player: PlayerState,
  direction: Direction8,
  longDribble: boolean,
  speedOverride?: Fixed,
): PlayerState {
  // dir は「Fixed スケールでの単位ベクトル成分」(1.0 = FIXED_ONE)、
  // 速度定数は px 単位の Fixed 値。両者とも FIXED_ONE スケールなので
  // 通常の fixedMul (a*b / FIXED_ONE) でそのまま「速度(px)」が得られる。
  const dir = DIRECTION_VECTORS[direction];
  const speed = speedOverride ?? (longDribble ? LONG_DRIBBLE_PLAYER_SPEED_FIXED : PLAYER_SPEED_FIXED);
  const vel: Vec2Fixed = {
    x: fixedMul(dir.x, speed),
    y: fixedMul(dir.y, speed),
  };
  const nextPos = clampToPitchBounds(vAdd(player.pos, vel), PLAYER_RADIUS_FIXED);
  const facing = direction === Direction8.None ? player.facing : direction;
  return { ...player, pos: nextPos, vel, facing };
}
