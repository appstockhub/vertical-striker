import { fixedMul, toFixed } from '../core/fixed';
import type { Fixed } from '../core/types';
import type { Difficulty } from './state';

/**
 * CPU(Team B)攻撃AIの難易度パラメータ。すべて仮値 (要プレイテスト調整)。
 * ピッチ高さ1800px(config/pitch.ts)に対する妥当な射程として設定した。
 */
export interface DifficultyTier {
  /** この距離の二乗以内ならシュートを検討する。 */
  readonly shootRangeSq: Fixed;
  /** ゴール中央からのx方向のずれがこれ以内ならシュートを検討する (角度が開きすぎない範囲)。 */
  readonly shootMaxLateral: Fixed;
  /** シュート照準のx座標に加えるノイズの最大幅 (px)。0なら常に正確に狙う。 */
  readonly aimNoiseRange: number;
}

function sq(f: Fixed): Fixed {
  return fixedMul(f, f);
}

export const DIFFICULTY_TIERS: Readonly<Record<Difficulty, DifficultyTier>> = {
  easy: { shootRangeSq: sq(toFixed(300)), shootMaxLateral: toFixed(150), aimNoiseRange: 60 },
  medium: { shootRangeSq: sq(toFixed(450)), shootMaxLateral: toFixed(180), aimNoiseRange: 25 },
  hard: { shootRangeSq: sq(toFixed(600)), shootMaxLateral: toFixed(220), aimNoiseRange: 0 },
};
