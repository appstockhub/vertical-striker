import { dotFixed, fixedAdd, fixedMul } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { Direction8 } from '../input/types';
import { DIRECTION_VECTORS } from './constants';

/**
 * AIステアリング用の8方向量子化。sqrt/正規化を使わず、8方向それぞれとの内積の
 * argmax で「vと角度が最も近い方向」を求める (|v|は全候補で共通なので比較に影響しない)。
 */
const CANDIDATE_DIRECTIONS: readonly Direction8[] = [
  Direction8.Up,
  Direction8.UpRight,
  Direction8.Right,
  Direction8.DownRight,
  Direction8.Down,
  Direction8.DownLeft,
  Direction8.Left,
  Direction8.UpLeft,
];

/**
 * ベクトル v を8方向に量子化する。|v|^2 が deadzoneSq 未満なら Direction8.None。
 * 同点 (内積が完全一致) は CANDIDATE_DIRECTIONS の先頭側 (Up→...→UpLeft の順) が勝つ、
 * 決定論的なタイブレーク。
 */
export function quantizeToDirection8(v: Vec2Fixed, deadzoneSq: Fixed): Direction8 {
  const magSq = fixedAdd(fixedMul(v.x, v.x), fixedMul(v.y, v.y));
  if ((magSq as number) < (deadzoneSq as number)) {
    return Direction8.None;
  }

  let best = CANDIDATE_DIRECTIONS[0] as Direction8;
  let bestDot = dotFixed(v, DIRECTION_VECTORS[best]);
  for (let i = 1; i < CANDIDATE_DIRECTIONS.length; i++) {
    const candidate = CANDIDATE_DIRECTIONS[i] as Direction8;
    const dot = dotFixed(v, DIRECTION_VECTORS[candidate]);
    if ((dot as number) > (bestDot as number)) {
      best = candidate;
      bestDot = dot;
    }
  }
  return best;
}
