import { toFixed, ZERO_FIXED } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { Direction8 } from '../input/types';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';
import { RUN_TEMPO } from './tempo';

/**
 * 8方向の単位ベクトル (Fixed スケール = 1.0 は FIXED_ONE=256 に相当)。
 * 斜め方向は事前正規化済み (256 * cos45° ≈ 181.02 → 181) なので、
 * 縦横と斜めで移動速度が変わらない。sqrt/trig を一切使わずに済む。
 */
export const DIRECTION_VECTORS: Readonly<Record<Direction8, Vec2Fixed>> = {
  [Direction8.None]: { x: ZERO_FIXED, y: ZERO_FIXED },
  [Direction8.Up]: { x: ZERO_FIXED, y: -256 as Fixed },
  [Direction8.Down]: { x: ZERO_FIXED, y: 256 as Fixed },
  [Direction8.Left]: { x: -256 as Fixed, y: ZERO_FIXED },
  [Direction8.Right]: { x: 256 as Fixed, y: ZERO_FIXED },
  [Direction8.UpRight]: { x: 181 as Fixed, y: -181 as Fixed },
  [Direction8.UpLeft]: { x: -181 as Fixed, y: -181 as Fixed },
  [Direction8.DownRight]: { x: 181 as Fixed, y: 181 as Fixed },
  [Direction8.DownLeft]: { x: -181 as Fixed, y: 181 as Fixed },
};

/** プレイヤーの移動速度 (px/tick, 仮値)。60fpsで秒速約3px*60=180px/secに相当。 */
export const PLAYER_SPEED_FIXED: Fixed = toFixed(3.0 * RUN_TEMPO);

/**
 * ★24周目サイクル④★ easy難易度のCPU(Team B)フィールドプレイヤーの移動速度。
 * 原作の難易度差はCPUチームの選手能力(走力等)で表現されるため、選手個性(Phase 4後半)の
 * 先取りとして easy のみCPU全員を15%減速する。人間(0.525px/tick)との速度差 0.079px/tick は
 * 100tickの追走で約8px開く = ドリブルで振り切る・マークを外すことが「できる」差。
 * medium/hard は等速のまま (原作でも上位難易度のCPUは俊敏)。GKは対象外 (セーブの信頼性維持)。
 */
export const CPU_EASY_PLAYER_SPEED_FIXED: Fixed = toFixed(3.0 * RUN_TEMPO * 0.85);

/** プレイヤーの当たり半径 (px, 仮値。ピッチ境界クランプの余白に使う)。ボール用は ballConstants.ts 参照。 */
export const PLAYER_RADIUS_FIXED: Fixed = toFixed(10);

export const PITCH_BOUNDS = {
  minX: toFixed(0) as Fixed,
  minY: toFixed(0) as Fixed,
  maxX: toFixed(PITCH_WIDTH) as Fixed,
  maxY: toFixed(PITCH_HEIGHT) as Fixed,
};
