import { fixedAdd, fixedMul, fixedSub } from '../core/fixed';
import type { Vec2Fixed } from '../core/types';
import type { PlayerState } from './state';
import { DRIBBLE_RADIUS_SQ_FIXED } from './ballConstants';

/**
 * 22人の中でボールに最も近く、かつドリブル半径 (DRIBBLE_RADIUS_SQ_FIXED) 以内の選手の
 * players[] index を返す。該当者が無ければ null。
 *
 * ドリブルタッチ/キック権・自陣ポゼッション判定・タックル対象特定・GK自動交代など、
 * 「誰がボールに触れているか」を要するあらゆるクロスプレイヤー判定がこれを共有する。
 *
 * 決定論: players を厳密に昇順indexで走査し、同点(完全に同じ距離の二乗)は
 * 小さいindexが勝つ (strict `<` のみで更新するため自然にそうなる)。
 */
export function findTouchPriorityPlayer(
  players: readonly PlayerState[],
  ballPos: Vec2Fixed,
): number | null {
  let bestIndex: number | null = null;
  let bestDistSq = 0;

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (!player) continue;

    const dx = fixedSub(ballPos.x, player.pos.x);
    const dy = fixedSub(ballPos.y, player.pos.y);
    const distSq = fixedAdd(fixedMul(dx, dx), fixedMul(dy, dy)) as number;

    if (distSq > (DRIBBLE_RADIUS_SQ_FIXED as number)) continue;
    if (bestIndex === null || distSq < bestDistSq) {
      bestIndex = i;
      bestDistSq = distSq;
    }
  }

  return bestIndex;
}
