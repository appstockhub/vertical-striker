import { clampFixed, fixedAdd, fixedMul, fixedSub, vAdd } from '../core/fixed';
import type { Vec2Fixed } from '../core/types';
import { Direction8, type ButtonState } from '../input/types';
import type { GameState, PlayerState } from './state';
import { DIRECTION_VECTORS, PITCH_BOUNDS, PLAYER_SPEED_FIXED, ENTITY_RADIUS_FIXED } from './constants';

/**
 * 1tick分の入力。InputFrame のサブセット (sim/ は入力の生成元を知らない)。
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
 */
export function simulate(state: GameState, inputs: Inputs): GameState {
  return {
    frame: state.frame + 1,
    rngState: state.rngState,
    player: updatePlayer(state.player, inputs),
    ball: state.ball, // Phase 0 ではボールは静止したまま (物理は Phase 1 で実装)
  };
}

function updatePlayer(player: PlayerState, inputs: Inputs): PlayerState {
  // dir は「Fixed スケールでの単位ベクトル成分」(1.0 = FIXED_ONE)、
  // PLAYER_SPEED_FIXED は px 単位の Fixed 値。両者とも FIXED_ONE スケールなので
  // 通常の fixedMul (a*b / FIXED_ONE) でそのまま「速度(px)」が得られる。
  const dir = DIRECTION_VECTORS[inputs.direction];
  const vel: Vec2Fixed = {
    x: fixedMul(dir.x, PLAYER_SPEED_FIXED),
    y: fixedMul(dir.y, PLAYER_SPEED_FIXED),
  };
  const nextPos = clampToPitch(vAdd(player.pos, vel));
  const facing = inputs.direction === Direction8.None ? player.facing : inputs.direction;
  return { pos: nextPos, vel, facing };
}

function clampToPitch(pos: Vec2Fixed): Vec2Fixed {
  return {
    x: clampFixed(
      pos.x,
      fixedAdd(PITCH_BOUNDS.minX, ENTITY_RADIUS_FIXED),
      fixedSub(PITCH_BOUNDS.maxX, ENTITY_RADIUS_FIXED),
    ),
    y: clampFixed(
      pos.y,
      fixedAdd(PITCH_BOUNDS.minY, ENTITY_RADIUS_FIXED),
      fixedSub(PITCH_BOUNDS.maxY, ENTITY_RADIUS_FIXED),
    ),
  };
}
