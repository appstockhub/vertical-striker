import { distSqFixed, fixedMul, toFixed } from '../core/fixed';
import type { Vec2Fixed } from '../core/types';
import type { PlayerState } from './state';
import { DRIBBLE_RADIUS_SQ_FIXED } from './ballConstants';

/**
 * タッチ優先権のヒステリシス許容マージン (px、仮値、二乗)。下記 findTouchPriorityPlayer 参照。
 * previousTouchIndexがnullの既存呼び出しは影響を受けない(挙動100%不変)。
 */
const TOUCH_PRIORITY_HYSTERESIS_MARGIN_SQ_FIXED = fixedMul(toFixed(6), toFixed(6)) as number;

/**
 * 22人の中でボールに最も近く、かつドリブル半径 (DRIBBLE_RADIUS_SQ_FIXED) 以内の選手の
 * players[] index を返す。該当者が無ければ null。
 *
 * ドリブルタッチ/キック権・自陣ポゼッション判定・タックル対象特定・GK自動交代など、
 * 「誰がボールに触れているか」を要するあらゆるクロスプレイヤー判定がこれを共有する。
 *
 * ヒステリシス (バグ修正、B-5(b)導入のバタフライ効果で発覚): 味方2人がボールを挟んで
 * ほぼ等距離に立つ場面 (ゴール前の混戦等) で、旧実装は距離の生の大小関係だけで判定していたため、
 * 各tickのドリブルタッチによるボールの微小な移動(「触れると少し前に転がる」設計)が
 * 2人の相対距離をtickごとに逆転させ、タッチ優先権が永久に往復する「トレーディング」が
 * 発生し、ボールが2人の間で静止せず振動して見える不具合があった (観戦シミュレーターの
 * 振動検出で発覚)。前tickのタッチ保持者(previousTouchIndex)がドリブル半径内に留まっており、
 * かつ新しい最短距離とほぼ同等(マージン以内)なら保持者を優先する。previousTouchIndexが
 * nullの既存呼び出しは一切影響を受けない(完全後方互換)。
 *
 * 決定論: players を厳密に昇順indexで走査し、同点(完全に同じ距離の二乗)は
 * 小さいindexが勝つ (strict `<` のみで更新するため自然にそうなる)。
 */
export function findTouchPriorityPlayer(
  players: readonly PlayerState[],
  ballPos: Vec2Fixed,
  previousTouchIndex: number | null = null,
): number | null {
  let bestIndex: number | null = null;
  let bestDistSq = 0;
  let previousDistSq: number | null = null;

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (!player) continue;

    const distSq = distSqFixed(ballPos, player.pos) as number;

    if (distSq > (DRIBBLE_RADIUS_SQ_FIXED as number)) continue;
    if (i === previousTouchIndex) previousDistSq = distSq;
    if (bestIndex === null || distSq < bestDistSq) {
      bestIndex = i;
      bestDistSq = distSq;
    }
  }

  if (
    previousDistSq !== null &&
    previousTouchIndex !== bestIndex &&
    previousDistSq <= bestDistSq + TOUCH_PRIORITY_HYSTERESIS_MARGIN_SQ_FIXED
  ) {
    return previousTouchIndex as number;
  }
  return bestIndex;
}
