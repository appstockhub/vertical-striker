import { fixedMul, vAdd } from '../core/fixed';
import type { Vec2Fixed } from '../core/types';
import { Direction8, emptyButtonState, type ButtonState } from '../input/types';
import type { GameState, PlayerState } from './state';
import { DIRECTION_VECTORS, PLAYER_RADIUS_FIXED, PLAYER_SPEED_FIXED } from './constants';
import { LONG_DRIBBLE_PLAYER_SPEED_FIXED } from './ballConstants';
import { applyDribbleTouch, isLongDribbleActive } from './dribble';
import { applyKick, updateKickCharge } from './kick';
import { clampToPitchBounds, stepBallPhysics } from './ballPhysics';
import { findTouchPriorityPlayer } from './ballTouch';
import { computeNonControlledDirection } from './teamAI';

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

/**
 * 純関数: 現在の状態と1tick分の入力から次の状態を返す。
 * 既存オブジェクトを変更せず、常に新しいプレーンオブジェクトを返す。
 * Math.random() や Math.sin/cos/atan2 はここでは使用しない
 * (scripts/checkDeterminism.mjs で静的にチェックされる)。
 *
 * Phase 2 (マイルストーン2: 非操作選手AI) のパイプライン:
 *   1. tick開始時点の位置で touch-priority (ボールに最も近くドリブル半径以内の1人、
 *      人間/AI問わず) を決定する (findTouchPriorityPlayer)。
 *   2. 各選手の「実効入力」を求める: 操作選手は人間の入力そのまま、非操作選手は
 *      チームAI (ホーム+ボール+オフサイド意識の重み付き合成) が出す Direction8。
 *      非操作選手の buttons は常に空 (Phase 2 では自律的にキック/タックルしない、
 *      計画書の明示的スコープ外指定)。
 *   3. touch-priority を持つ選手 (人間かAIかを問わない) のみがドリブルタッチで
 *      ball.vel を上書きできる。キックは touch-priority かつ操作選手本人の場合のみ
 *      ボールに作用する (AIは自律的にキックしない)。
 *   4. ボール物理 (重力・バウンド・転がり摩擦・境界クランプ)。
 *   5. 全選手の移動を適用 (touch-priority を持つ選手だけロングドリブル速度を使える)。
 */
export function simulate(state: GameState, inputs: Inputs): GameState {
  const touchPriorityIndex = findTouchPriorityPlayer(state.players, state.ball.pos);

  const effectiveInputs: Inputs[] = state.players.map((player, index) => {
    if (index === state.controlledPlayerIndex) return inputs;
    const direction = computeNonControlledDirection(
      player,
      state.players,
      state.ball.pos,
      state.teamFormations,
    );
    return { direction, buttons: NO_BUTTONS };
  });

  let ball = state.ball;
  let nextControlledKickChargeFrames = state.players[state.controlledPlayerIndex]?.kickChargeFrames ?? 0;

  const touchInputs = touchPriorityIndex !== null ? effectiveInputs[touchPriorityIndex] : undefined;
  if (touchInputs) {
    ball = applyDribbleTouch(ball, true, touchInputs.direction, touchInputs.buttons);
  }

  // キック溜めは操作選手についてのみ追跡する (AIは自律的にキックしない、Phase 2 スコープ外)。
  const controlledPlayer = state.players[state.controlledPlayerIndex];
  if (controlledPlayer) {
    const charge = updateKickCharge(controlledPlayer.kickChargeFrames, inputs.buttons.B);
    nextControlledKickChargeFrames = charge.nextFrames;
    if (charge.releasedFrames > 0 && touchPriorityIndex === state.controlledPlayerIndex) {
      ball = applyKick(ball, controlledPlayer, charge.releasedFrames, inputs.direction);
    }
  }

  ball = stepBallPhysics(ball);

  const players = state.players.map((player, index) => {
    const playerInputs = effectiveInputs[index] ?? { direction: Direction8.None, buttons: NO_BUTTONS };
    const longDribble =
      index === touchPriorityIndex && isLongDribbleActive(true, playerInputs.direction, playerInputs.buttons);
    const moved = updatePlayer(player, playerInputs, longDribble);
    return index === state.controlledPlayerIndex
      ? { ...moved, kickChargeFrames: nextControlledKickChargeFrames }
      : moved;
  });

  return {
    frame: state.frame + 1,
    rngState: state.rngState,
    players,
    ball,
    controlledPlayerIndex: state.controlledPlayerIndex,
    prevButtons: inputs.buttons,
    teamFormations: state.teamFormations,
  };
}

function updatePlayer(player: PlayerState, inputs: Inputs, longDribble: boolean): PlayerState {
  // dir は「Fixed スケールでの単位ベクトル成分」(1.0 = FIXED_ONE)、
  // 速度定数は px 単位の Fixed 値。両者とも FIXED_ONE スケールなので
  // 通常の fixedMul (a*b / FIXED_ONE) でそのまま「速度(px)」が得られる。
  const dir = DIRECTION_VECTORS[inputs.direction];
  const speed = longDribble ? LONG_DRIBBLE_PLAYER_SPEED_FIXED : PLAYER_SPEED_FIXED;
  const vel: Vec2Fixed = {
    x: fixedMul(dir.x, speed),
    y: fixedMul(dir.y, speed),
  };
  const nextPos = clampToPitchBounds(vAdd(player.pos, vel), PLAYER_RADIUS_FIXED);
  const facing = inputs.direction === Direction8.None ? player.facing : inputs.direction;
  return { ...player, pos: nextPos, vel, facing };
}
