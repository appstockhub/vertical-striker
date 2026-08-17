import { fixedMul, toFixed } from '../core/fixed';
import type { Fixed } from '../core/types';
import type { Difficulty } from './state';

/**
 * CPU(Team B)攻撃AIの難易度パラメータ。すべて仮値 (要プレイテスト調整)。
 *
 * 射程の物理的根拠 (観戦シミュレーターで発覚した「射程600pxのシュートは途中で止まる」
 * 問題の修正): 強キックのグラウンダーは初速9px/tick・転がり摩擦0.96/tickなので、
 * 総到達距離は 9/(1-0.96) ≈ 225px しかない。射程を到達距離より大きくすると、
 * CPUが「絶対に届かないシュート」を大量に打ってはボールを手放すだけになる。
 * hard の射程200pxは「ほぼ確実に届く距離からしか打たない」、easy の140pxは
 * 「かなり近づかないと打たない(その分ドリブルで運んで奪われやすい)」を表す。
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

// ★テンポ変更(24周目サイクル①)★ 冒頭コメントの導出式のまま物理だけ差し替え:
// 強キックのグラウンダーは初速 2.7px/tick・摩擦 0.968/tick なので総到達距離は
// 2.7×0.968/(1-0.968) ≈ 82px。旧の到達距離(225px)比 0.36 で射程・横ずれ・ノイズを縮めた
// (「絶対に届かないシュートを打たない」という元の設計判断を保存するための連動調整)。
export const DIFFICULTY_TIERS: Readonly<Record<Difficulty, DifficultyTier>> = {
  easy: { shootRangeSq: sq(toFixed(50)), shootMaxLateral: toFixed(36), aimNoiseRange: 22 },
  medium: { shootRangeSq: sq(toFixed(61)), shootMaxLateral: toFixed(47), aimNoiseRange: 9 },
  hard: { shootRangeSq: sq(toFixed(72)), shootMaxLateral: toFixed(58), aimNoiseRange: 0 },
};
