import { fixedMul, vAdd } from '../core/fixed';
import type { Vec2Fixed } from '../core/types';
import { Direction8, type ButtonState } from '../input/types';
import type { GameState, PlayerState } from './state';
import { DIRECTION_VECTORS, PLAYER_RADIUS_FIXED, PLAYER_SPEED_FIXED } from './constants';
import { LONG_DRIBBLE_PLAYER_SPEED_FIXED } from './ballConstants';
import { applyDribbleTouch, isLongDribbleActive, isNearBall } from './dribble';
import { applyKick, updateKickCharge } from './kick';
import { clampToPitchBounds, stepBallPhysics } from './ballPhysics';

/**
 * 1tick分の入力。InputFrame のサブセット (sim/ は入力の生成元を知らない)。
 * キック溜め時間などtickをまたぐ状態はすべて GameState 側 (PlayerState.kickChargeFrames)
 * に持たせるため、ここに edge (buttonsPressed 等) を追加する必要は無い。
 */
export interface Inputs {
  readonly direction: Direction8;
  readonly buttons: ButtonState;
}

/**
 * 純関数: 現在の状態と1tick分の入力から次の状態を返す。
 * 既存オブジェクトを変更せず、常に新しいプレーンオブジェクトを返す。
 * Math.random() や Math.sin/cos/atan2 はここでは使用しない
 * (scripts/checkDeterminism.mjs で静的にチェックされる)。
 *
 * パイプライン順序 (Phase 1):
 *   1. near判定 (tick開始時点の位置。移動適用前の値を使い同tick内の循環参照を避ける)
 *   2. プレイヤー移動 (ロングドリブル中は速度を差し替え)
 *   3. ドリブルタッチ (near かつ接地なら ball.vel を上書き)
 *   4. キック溜め更新 → 解放ならキック実行 (ドリブルタッチの結果を上書きし直す)
 *   5. ボール物理 (重力・バウンド・転がり摩擦・境界クランプ)
 */
export function simulate(state: GameState, inputs: Inputs): GameState {
  const near = isNearBall(state.player.pos, state.ball.pos);
  const longDribble = isLongDribbleActive(near, inputs.direction, inputs.buttons);

  const player = updatePlayer(state.player, inputs, longDribble);

  let ball = applyDribbleTouch(state.ball, near, inputs.direction, inputs.buttons);

  const charge = updateKickCharge(state.player.kickChargeFrames, inputs.buttons.B);
  if (charge.releasedFrames > 0 && near) {
    ball = applyKick(ball, state.player, charge.releasedFrames, inputs.direction);
  }
  const playerWithCharge: PlayerState = { ...player, kickChargeFrames: charge.nextFrames };

  ball = stepBallPhysics(ball);

  return {
    frame: state.frame + 1,
    rngState: state.rngState,
    player: playerWithCharge,
    ball,
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
  return { pos: nextPos, vel, facing, kickChargeFrames: player.kickChargeFrames };
}
