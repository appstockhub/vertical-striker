import { toFixed } from '../core/fixed';
import type { Fixed } from '../core/types';
import { PITCH_HEIGHT } from '../config/pitch';
import { attackingIsUpward, opponentOf, TeamId, type Half } from './formations';
import { computeOffsideLine } from './teamAI';
import type { PlayerState } from './state';

const HALFWAY_Y_FIXED: Fixed = toFixed(PITCH_HEIGHT / 2);

export interface OffsideCheckResult {
  readonly offside: boolean;
  /** オフサイド成立時の該当選手 (players[] index)。複数該当時は昇順indexの選手。 */
  readonly offsidePlayerIndex: number | null;
}

/**
 * キック実行の瞬間 (カーソルパス発火・チャージキック解放) に呼ぶオフサイド判定。
 * このゲームには明示的な「受け手」の概念が無く (空いたスペースへの強キック＝スルーパスとして
 * 機能する、CLAUDE.md)、特定の受け手だけを見ると主要なスルーパスの使い方を見逃してしまうため、
 * キッカー自身を除く味方全員をチェック対象にする (計画セクションE、要ユーザー確認の割り切り)。
 *
 * 成立条件: 相手陣内(ハーフウェーラインより攻撃方向側)にいる 味方が1人でも、
 * 相手のオフサイドライン(computeOffsideLine)より攻撃方向に出ていること。
 * 自陣内にいる味方は判定から除外する (「自陣ではオフサイドにならない」の安価な近似)。
 */
export function checkOffside(
  kickerIndex: number,
  kickerTeam: TeamId,
  players: readonly PlayerState[],
  half: Half,
): OffsideCheckResult {
  const opponentTeam = opponentOf(kickerTeam);
  const offsideLineY = computeOffsideLine(players, opponentTeam, half) as number;
  const attacksUp = attackingIsUpward(kickerTeam, half);
  const halfwayY = HALFWAY_Y_FIXED as number;

  for (let i = 0; i < players.length; i++) {
    if (i === kickerIndex) continue;
    const player = players[i];
    if (!player || player.team !== kickerTeam) continue;

    const y = player.pos.y as number;
    const inOpponentHalf = attacksUp ? y < halfwayY : y > halfwayY;
    if (!inOpponentHalf) continue;

    const beyondLine = attacksUp ? y < offsideLineY : y > offsideLineY;
    if (beyondLine) {
      return { offside: true, offsidePlayerIndex: i };
    }
  }

  return { offside: false, offsidePlayerIndex: null };
}
