import { fixedMul, vAdd, vSub, ZERO_FIXED } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { Direction8, emptyButtonState, type ButtonState } from '../input/types';
import type { GameState, PlayerState } from './state';
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

/**
 * 純関数: 現在の状態と1tick分の入力から次の状態を返す。
 * 既存オブジェクトを変更せず、常に新しいプレーンオブジェクトを返す。
 * Math.random() や Math.sin/cos/atan2 はここでは使用しない
 * (scripts/checkDeterminism.mjs で静的にチェックされる)。
 *
 * Phase 2 (マイルストーン4: キーパーAI) のパイプライン:
 *   1. touch-priority を決定する。
 *   2. GK自動交代判定 (最優先): ボールがTeam A GKに近い、またはL押しっぱなしで
 *      Team A非保持なら操作対象をGKへ強制する (キック溜め中はガード)。
 *      発生しなければ通常のカーソル解決 (resolveCursor) を行う。
 *   3. 各選手の実効入力: 操作選手は人間入力、非操作GKは専用の自動ステアリング、
 *      その他の非操作選手はチームAI。
 *   4. touch-priority選手のドリブルタッチ。
 *   5. 操作選手がGKかつセーブ範囲内なら Y=キャッチ/B=パンチングのみを処理し、
 *      通常のカーソルパス/キック溜めは行わない。それ以外は通常通りカーソルパス/
 *      キック溜め・解放を処理する。
 *   6. ボール物理。
 *   7. 全選手の移動 (touch-priority選手はロングドリブル速度、非操作GKは
 *      GK_AUTO_SPEED_FIXEDという「反応速度」を使える)。
 */
export function simulate(state: GameState, inputs: Inputs): GameState {
  const touchPriorityIndex = findTouchPriorityPlayer(state.players, state.ball.pos);
  const teamAInPossession = isTeamAInPossession(touchPriorityIndex);

  const teamAGoalkeeper = state.players[TEAM_A_GK_INDEX];
  const currentControlled = state.players[state.controlledPlayerIndex];
  const currentLocked = (currentControlled?.kickChargeFrames ?? 0) > 0;
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

  const inSaveRange = !!controlledPlayer && controlledPlayer.isGoalkeeper && isInSaveRange(controlledPlayer, state.ball.pos);

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

  const touchInputs = touchPriorityIndex !== null ? effectiveInputs[touchPriorityIndex] : undefined;
  if (touchInputs) {
    ball = applyDribbleTouch(ball, true, touchInputs.direction, touchInputs.buttons);
  }

  if (inSaveRange && controlledPlayer) {
    // セーブ文脈: Y=キャッチ/B=パンチングのみを処理する (カーソルパス/キック溜めは行わない)。
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

    // キック溜めは操作選手についてのみ追跡する (AIは自律的にキックしない、Phase 2 スコープ外)。
    if (controlledPlayer) {
      const charge = updateKickCharge(controlledPlayer.kickChargeFrames, inputs.buttons.B);
      nextControlledKickChargeFrames = charge.nextFrames;
      if (charge.releasedFrames > 0 && touchPriorityIndex === controlledPlayerIndex) {
        ball = applyKick(ball, controlledPlayer, charge.releasedFrames, inputs.direction);
      }
    }
  }

  ball = stepBallPhysics(ball);

  const players = state.players.map((player, index) => {
    const playerInputs = effectiveInputs[index] ?? { direction: Direction8.None, buttons: NO_BUTTONS };
    const longDribble =
      index === touchPriorityIndex && isLongDribbleActive(true, playerInputs.direction, playerInputs.buttons);
    const isAutoGoalkeeper = player.isGoalkeeper && index !== controlledPlayerIndex;
    const speedOverride = isAutoGoalkeeper ? GK_AUTO_SPEED_FIXED : undefined;
    const moved = updatePlayer(player, playerInputs, longDribble, speedOverride);
    return index === controlledPlayerIndex
      ? { ...moved, kickChargeFrames: nextControlledKickChargeFrames }
      : moved;
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
  inputs: Inputs,
  longDribble: boolean,
  speedOverride?: Fixed,
): PlayerState {
  // dir は「Fixed スケールでの単位ベクトル成分」(1.0 = FIXED_ONE)、
  // 速度定数は px 単位の Fixed 値。両者とも FIXED_ONE スケールなので
  // 通常の fixedMul (a*b / FIXED_ONE) でそのまま「速度(px)」が得られる。
  const dir = DIRECTION_VECTORS[inputs.direction];
  const speed = speedOverride ?? (longDribble ? LONG_DRIBBLE_PLAYER_SPEED_FIXED : PLAYER_SPEED_FIXED);
  const vel: Vec2Fixed = {
    x: fixedMul(dir.x, speed),
    y: fixedMul(dir.y, speed),
  };
  const nextPos = clampToPitchBounds(vAdd(player.pos, vel), PLAYER_RADIUS_FIXED);
  const facing = inputs.direction === Direction8.None ? player.facing : inputs.direction;
  return { ...player, pos: nextPos, vel, facing };
}
