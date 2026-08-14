import { fixedMul, vAdd, vSub, vZero, ZERO_FIXED } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { Direction8, emptyButtonState, type ButtonState } from '../input/types';
import type { BallState, GameState, PlayerState } from './state';
import { TacklePhase, TeamId } from './state';
import { opponentOf } from './formations';
import { checkOffside } from './offsideRule';
import { DIRECTION_VECTORS, PLAYER_RADIUS_FIXED, PLAYER_SPEED_FIXED } from './constants';
import { KICK_MIN_CHARGE_FRAMES, LONG_DRIBBLE_PLAYER_SPEED_FIXED } from './ballConstants';
import { applyDribbleTouch, isLongDribbleActive } from './dribble';
import { applyKick, updateKickCharge } from './kick';
import { clampToPitchBounds, stepBallPhysicsDetailed } from './ballPhysics';
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
import { getHalf, isFulltime } from './matchClock';
import { placeKickoffFormation } from './kickoff';
import { detectBoundaryEvent } from './bounds';

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

/** オフサイド成立時のリスタート用ボール状態 (該当選手の位置へ速度0で置く、間接FK相当)。 */
function offsideRestartBall(offsidePlayer: PlayerState): BallState {
  return { pos: offsidePlayer.pos, vel: vZero(), height: ZERO_FIXED, zVel: ZERO_FIXED };
}

/**
 * 純関数: 現在の状態と1tick分の入力から次の状態を返す。
 * 既存オブジェクトを変更せず、常に新しいプレーンオブジェクトを返す。
 * Math.random() や Math.sin/cos/atan2 はここでは使用しない
 * (scripts/checkDeterminism.mjs で静的にチェックされる)。
 *
 * Phase 3 (マイルストーン1-2: 半分対応+試合時計) で追加した先頭の早期return:
 *   0a. フルタイム到達済みなら frame だけ進めて他は素通しする (試合終了、入力は実質無効)。
 *   0b. このtickで前半→後半の境界を跨ぐなら、全員をミラー配置のキックオフにリセットする。
 * それ以外は通常通り Phase 2 のパイプラインを進める (オフサイド・CPU攻撃AIは後続マイルストーンで
 * 追加、現時点ではまだ無い)。
 *   1. touch-priority を決定する。
 *   2. GK自動交代判定 (最優先、キック溜め中/タックル中はガード)。無ければ通常のカーソル解決。
 *   3. 各選手の実効入力 (操作選手=人間入力、非操作GK=専用ステアリング、その他=チームAI)。
 *   4. touch-priority選手のドリブルタッチ (この時点で lastTouchTeam を更新)。
 *   5. Bボタンの文脈分岐 (GKセーブ最優先 → カーソルパス/チャージキック → タックル)。
 *      マイルストーン5: カーソルパス発火/チャージキック解放の直前でオフサイド判定
 *      (state.offsideEnabled時のみ)。成立時はapplyKickを実行させず、間接FK相当の
 *      リスタート(該当選手の位置へ速度0でボールを置く)にする。
 *   6. ボール物理 (マイルストーン3-4: クランプ前の仮位置で境界越えを検出する)。
 *      6a. 得点なら、その場でミラー配置のキックオフへリセットして早期returnする
 *          (後続の選手移動処理を古いボール位置のまま進めてしまわないため、計画セクションD)。
 *      6b. スローイン/ゴールキック/コーナーなら、ボールを復帰位置へ即座にテレポートし
 *          (速度・高さ0)、選手移動処理はそのまま続ける (計画セクションC、試合停止の演出は無し)。
 *   7. 全選手の移動。
 *
 * 既知の割り切り (仮定5): 得点判定はこの関数の中盤、前後半切替の早期return判定より「後」に
 * 行うため、半分境界とちょうど同じtickで得点が起きた場合は半分切替が優先され、その得点は
 * 記録されない (1/10800tickの極小確率、Phase 3ではこのまま許容する)。
 */
export function simulate(state: GameState, inputs: Inputs): GameState {
  if (isFulltime(state.frame)) {
    return { ...state, frame: state.frame + 1, prevButtons: inputs.buttons };
  }

  const half = getHalf(state.frame);
  const nextFrame = state.frame + 1;
  if (getHalf(nextFrame) !== half) {
    // 前半→後半の境界を跨ぐtick。全員をミラー配置のキックオフへリセットする。
    const reset = placeKickoffFormation(getHalf(nextFrame), state.teamFormations);
    return {
      frame: nextFrame,
      rngState: state.rngState,
      players: reset.players,
      ball: reset.ball,
      controlledPlayerIndex: state.controlledPlayerIndex,
      prevButtons: inputs.buttons,
      teamFormations: state.teamFormations,
      score: state.score,
      lastTouchTeam: null,
      difficulty: state.difficulty,
      offsideEnabled: state.offsideEnabled,
    };
  }

  const touchPriorityIndex = findTouchPriorityPlayer(state.players, state.ball.pos);
  const teamAInPossession = isTeamAInPossession(touchPriorityIndex);
  let lastTouchTeam = state.lastTouchTeam;

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
    const direction = computeNonControlledDirection(
      player,
      state.players,
      state.ball.pos,
      state.teamFormations,
      half,
    );
    return { direction, buttons: NO_BUTTONS };
  });

  let ball = state.ball;
  let nextControlledKickChargeFrames = controlledPlayer?.kickChargeFrames ?? 0;
  let tackleAdvance: TackleAdvance = NO_TACKLE;

  const touchInputs = touchPriorityIndex !== null ? effectiveInputs[touchPriorityIndex] : undefined;
  if (touchInputs) {
    ball = applyDribbleTouch(ball, true, touchInputs.direction, touchInputs.buttons);
    const touchPlayer = touchPriorityIndex !== null ? state.players[touchPriorityIndex] : undefined;
    if (touchPlayer) lastTouchTeam = touchPlayer.team;
  }

  if (inSaveRange && controlledPlayer) {
    // セーブ文脈: Y=キャッチ/B=パンチングのみを処理する (カーソルパス/キック溜め/タックルは行わない)。
    const yEdge = inputs.buttons.Y && !state.prevButtons.Y;
    const bEdge = inputs.buttons.B && !state.prevButtons.B;
    if (yEdge) {
      const outcome = resolveSaveOutcome(controlledPlayer, ball, 'catch');
      ball = applySave(ball, controlledPlayer, outcome, half);
      if (outcome !== 'missed') lastTouchTeam = controlledPlayer.team;
    } else if (bEdge) {
      const outcome = resolveSaveOutcome(controlledPlayer, ball, 'punch');
      ball = applySave(ball, controlledPlayer, outcome, half);
      if (outcome !== 'missed') lastTouchTeam = controlledPlayer.team;
    }
  } else {
    if (cursor.passTriggered && cursor.passTargetIndex !== null && controlledPlayer) {
      const receiver = state.players[cursor.passTargetIndex];
      if (receiver) {
        const offside = state.offsideEnabled
          ? checkOffside(controlledPlayerIndex, controlledPlayer.team, state.players, half)
          : { offside: false, offsidePlayerIndex: null };
        const offsidePlayer =
          offside.offside && offside.offsidePlayerIndex !== null ? state.players[offside.offsidePlayerIndex] : undefined;
        if (offsidePlayer) {
          // オフサイド成立: パスを実行させず、間接FK相当のリスタートにする。
          ball = offsideRestartBall(offsidePlayer);
          lastTouchTeam = opponentOf(controlledPlayer.team);
        } else {
          // 確定パス: 溜め不要・低い弾道の速いグラウンダー。方向だけ受け手に向けて上書きする
          // (既存applyKickの速度軸/弾道軸をそのまま再利用、新しい物理モデルは作らない)。
          const passDirection = quantizeToDirection8(vSub(receiver.pos, controlledPlayer.pos), ZERO_FIXED);
          ball = applyKick(ball, controlledPlayer, KICK_MIN_CHARGE_FRAMES, passDirection);
        }
      }
    }

    if (controlledPlayer) {
      const isCarryingBall = touchPriorityIndex === controlledPlayerIndex;

      if (isCarryingBall) {
        // ボール保持中: 既存のチャージキック (タックル状態は自然にNoneへ収束させる)。
        const charge = updateKickCharge(controlledPlayer.kickChargeFrames, inputs.buttons.B);
        nextControlledKickChargeFrames = charge.nextFrames;
        if (charge.releasedFrames > 0) {
          const offside = state.offsideEnabled
            ? checkOffside(controlledPlayerIndex, controlledPlayer.team, state.players, half)
            : { offside: false, offsidePlayerIndex: null };
          const offsidePlayer =
            offside.offside && offside.offsidePlayerIndex !== null ? state.players[offside.offsidePlayerIndex] : undefined;
          if (offsidePlayer) {
            ball = offsideRestartBall(offsidePlayer);
            lastTouchTeam = opponentOf(controlledPlayer.team);
          } else {
            ball = applyKick(ball, controlledPlayer, charge.releasedFrames, inputs.direction);
          }
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
            lastTouchTeam = controlledPlayer.team;
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

  const ballStep = stepBallPhysicsDetailed(ball);
  const boundaryEvent = detectBoundaryEvent(ballStep.tentativePos, ballStep.ball.height, half, lastTouchTeam);

  if (boundaryEvent?.type === 'goal') {
    // 得点: 選手移動処理まで進めず、その場でミラー配置のキックオフへリセットして完結させる
    // (計画セクションD。古いボール位置ベースのAI目標が1tickだけ混ざるのを防ぐ)。
    const reset = placeKickoffFormation(half, state.teamFormations);
    const score: readonly [number, number] =
      boundaryEvent.scoringTeam === TeamId.A
        ? [state.score[0] + 1, state.score[1]]
        : [state.score[0], state.score[1] + 1];
    return {
      frame: nextFrame,
      rngState: state.rngState,
      players: reset.players,
      ball: reset.ball,
      controlledPlayerIndex: state.controlledPlayerIndex,
      prevButtons: inputs.buttons,
      teamFormations: state.teamFormations,
      score,
      lastTouchTeam: null,
      difficulty: state.difficulty,
      offsideEnabled: state.offsideEnabled,
    };
  }

  if (boundaryEvent) {
    // スローイン/ゴールキック/コーナー: 即座にテレポートするのみ (試合停止の演出は無し)。
    // 選手移動処理はこのまま続ける (Team Aはカーソルスナップ、Team Bはボール引力AIが
    // 自然にリスタート位置へ収束する、計画セクションC)。
    ball = { pos: boundaryEvent.pos, vel: vZero(), height: ZERO_FIXED, zVel: ZERO_FIXED };
    lastTouchTeam = null;
  } else {
    ball = ballStep.ball;
  }

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
    frame: nextFrame,
    rngState: state.rngState,
    players,
    ball,
    controlledPlayerIndex,
    prevButtons: inputs.buttons,
    teamFormations: state.teamFormations,
    score: state.score,
    lastTouchTeam,
    difficulty: state.difficulty,
    offsideEnabled: state.offsideEnabled,
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
