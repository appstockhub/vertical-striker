import { toFixed, vZero, ZERO_FIXED } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { createRng, type RngState } from '../core/rng';
import { Direction8 } from '../input/types';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';

export interface PlayerState {
  readonly pos: Vec2Fixed;
  readonly vel: Vec2Fixed;
  readonly facing: Direction8;
  /** 0 = 非チャージ中。>0 = Bボタンを押し続けているtick数 (Phase 1 キック弾道軸用)。 */
  readonly kickChargeFrames: number;
}

export interface BallState {
  readonly pos: Vec2Fixed;
  readonly vel: Vec2Fixed;
  /** 地面からの高さ (z軸、疑似3D)。0以上。 */
  readonly height: Fixed;
  /** 垂直方向の速度。+ = 上昇。 */
  readonly zVel: Fixed;
}

/**
 * 決定論シミュレーションの全状態。Phase 0 では player/ball は単数フィールド。
 * Phase 2 (11vs11) で players: PlayerState[] へ移行する予定だが、その変更は
 * sim/state.ts と sim/update.ts に閉じる想定 (render/・input/ は配列形状に依存しない)。
 */
export interface GameState {
  readonly frame: number;
  readonly rngState: RngState;
  readonly player: PlayerState;
  readonly ball: BallState;
}

export function createInitialState(seed: number): GameState {
  return {
    frame: 0,
    rngState: createRng(seed),
    player: {
      pos: { x: toFixed(PITCH_WIDTH / 2), y: toFixed(PITCH_HEIGHT * 0.75) },
      vel: vZero(),
      facing: Direction8.Up,
      kickChargeFrames: 0,
    },
    ball: {
      pos: { x: toFixed(PITCH_WIDTH / 2), y: toFixed(PITCH_HEIGHT * 0.5) },
      vel: vZero(),
      height: ZERO_FIXED,
      zVel: ZERO_FIXED,
    },
  };
}
