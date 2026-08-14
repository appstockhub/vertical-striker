import { fixedMul, vAdd, vSub, ZERO_FIXED } from '../core/fixed';
import type { Vec2Fixed } from '../core/types';
import { Direction8, emptyButtonState, type ButtonState } from '../input/types';
import type { GameState, PlayerState } from './state';
import { DIRECTION_VECTORS, PLAYER_RADIUS_FIXED, PLAYER_SPEED_FIXED } from './constants';
import { KICK_MIN_CHARGE_FRAMES, LONG_DRIBBLE_PLAYER_SPEED_FIXED } from './ballConstants';
import { applyDribbleTouch, isLongDribbleActive } from './dribble';
import { applyKick, updateKickCharge } from './kick';
import { clampToPitchBounds, stepBallPhysics } from './ballPhysics';
import { findTouchPriorityPlayer } from './ballTouch';
import { computeNonControlledDirection } from './teamAI';
import { resolveCursor } from './cursor';
import { quantizeToDirection8 } from './steering';

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
 * Phase 2 (マイルストーン3: カーソル切替+パス) のパイプライン:
 *   1. tick開始時点の位置で touch-priority を決定する (findTouchPriorityPlayer)。
 *   2. カーソル解決 (resolveCursor): Team Aがボールを持っていれば操作対象をその選手へ
 *      スナップしYはカーソルパスに、持っていなければYは手動切替でボールに最も近い
 *      Team A選手へヒステリシス付きで自動追従する。
 *   3. 各選手の「実効入力」を求める: 解決後の操作選手は人間の入力そのまま、
 *      非操作選手はチームAIが出す Direction8 (buttonsは常に空)。
 *   4. touch-priorityを持つ選手のドリブルタッチ → カーソルパスが発火していれば
 *      それを反映 (既存applyKickを再利用し方向だけ受け手に向けて上書き) →
 *      操作選手のキック溜め/解放 (touch-priorityかつ操作選手本人の場合のみボールに作用)。
 *   5. ボール物理。
 *   6. 全選手の移動を適用 (touch-priorityを持つ選手だけロングドリブル速度を使える)。
 */
export function simulate(state: GameState, inputs: Inputs): GameState {
  const touchPriorityIndex = findTouchPriorityPlayer(state.players, state.ball.pos);

  const cursor = resolveCursor(
    state.players,
    state.controlledPlayerIndex,
    touchPriorityIndex,
    state.ball.pos,
    inputs.buttons,
    state.prevButtons,
  );
  const controlledPlayerIndex = cursor.controlledPlayerIndex;

  const effectiveInputs: Inputs[] = state.players.map((player, index) => {
    if (index === controlledPlayerIndex) return inputs;
    const direction = computeNonControlledDirection(
      player,
      state.players,
      state.ball.pos,
      state.teamFormations,
    );
    return { direction, buttons: NO_BUTTONS };
  });

  let ball = state.ball;
  let nextControlledKickChargeFrames = state.players[controlledPlayerIndex]?.kickChargeFrames ?? 0;

  const touchInputs = touchPriorityIndex !== null ? effectiveInputs[touchPriorityIndex] : undefined;
  if (touchInputs) {
    ball = applyDribbleTouch(ball, true, touchInputs.direction, touchInputs.buttons);
  }

  if (cursor.passTriggered && cursor.passTargetIndex !== null) {
    const carrier = state.players[controlledPlayerIndex];
    const receiver = state.players[cursor.passTargetIndex];
    if (carrier && receiver) {
      // 確定パス: 溜め不要・低い弾道の速いグラウンダー。方向だけ受け手に向けて上書きする
      // (既存applyKickの速度軸/弾道軸をそのまま再利用、新しい物理モデルは作らない)。
      const passDirection = quantizeToDirection8(vSub(receiver.pos, carrier.pos), ZERO_FIXED);
      ball = applyKick(ball, carrier, KICK_MIN_CHARGE_FRAMES, passDirection);
    }
  }

  // キック溜めは操作選手についてのみ追跡する (AIは自律的にキックしない、Phase 2 スコープ外)。
  const controlledPlayer = state.players[controlledPlayerIndex];
  if (controlledPlayer) {
    const charge = updateKickCharge(controlledPlayer.kickChargeFrames, inputs.buttons.B);
    nextControlledKickChargeFrames = charge.nextFrames;
    if (charge.releasedFrames > 0 && touchPriorityIndex === controlledPlayerIndex) {
      ball = applyKick(ball, controlledPlayer, charge.releasedFrames, inputs.direction);
    }
  }

  ball = stepBallPhysics(ball);

  const players = state.players.map((player, index) => {
    const playerInputs = effectiveInputs[index] ?? { direction: Direction8.None, buttons: NO_BUTTONS };
    const longDribble =
      index === touchPriorityIndex && isLongDribbleActive(true, playerInputs.direction, playerInputs.buttons);
    const moved = updatePlayer(player, playerInputs, longDribble);
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
