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
 * ★24周目サイクル④で「即時笛」から「遅延判定」へ置き換え★
 *
 * 旧実装 (checkOffside を各キック箇所で即時評価) は「相手陣内でラインを超えている味方が
 * 1人でも居れば、パスの行き先と無関係に即オフサイド」という割り切りで、コメントにも
 * 「要ユーザー確認の割り切り」と明記されていた。この割り切りは観戦シミュレーターの計測で
 * **人間側の攻撃を丸ごと没収する**ことが判明した: ライン押し上げで味方FWが前に居る状態では
 * 全ての前進キックが即笛になり、Team Aのボールは敵陣1/3に1tickも入れない (c6シュート0本の
 * 最深部の原因)。競技規則 第11条の実体は「オフサイド位置に居た選手が、その後ボールに
 * **関与した時**に成立」なので、規則そのものへ置き換える:
 *   1. キックの瞬間: computeOffsidePositions でオフサイド位置の味方の集合を記録
 *      (GameState.pendingOffside)
 *   2. その集合の選手が次にボールへ触れた瞬間に笛 (update.ts の解決ロジック)
 *   3. 誰であれ別の選手 (オンサイドの味方・相手) が先に触れたら保留は消滅
 * これは「空いたスペースへの強キック=スルーパス」という原作の使い方とも整合する
 * (スペースへ蹴る事自体は自由、オフサイド位置から追いかけて触ると反則 — 実サッカーどおり)。
 *
 * 位置判定の成立条件 (旧実装から不変): 相手陣内(ハーフウェーラインより攻撃方向側)かつ
 * 相手のオフサイドライン(computeOffsideLine)より攻撃方向に出ていること。
 * 自陣内にいる味方は判定から除外する (「自陣ではオフサイドにならない」の安価な近似)。
 */
export function computeOffsidePositions(
  kickerIndex: number,
  kickerTeam: TeamId,
  players: readonly PlayerState[],
  half: Half,
): readonly number[] {
  const opponentTeam = opponentOf(kickerTeam);
  const offsideLineY = computeOffsideLine(players, opponentTeam, half) as number;
  const attacksUp = attackingIsUpward(kickerTeam, half);
  const halfwayY = HALFWAY_Y_FIXED as number;
  const result: number[] = [];

  for (let i = 0; i < players.length; i++) {
    if (i === kickerIndex) continue;
    const player = players[i];
    if (!player || player.team !== kickerTeam) continue;

    const y = player.pos.y as number;
    const inOpponentHalf = attacksUp ? y < halfwayY : y > halfwayY;
    if (!inOpponentHalf) continue;

    const beyondLine = attacksUp ? y < offsideLineY : y > offsideLineY;
    if (beyondLine) result.push(i);
  }

  return result;
}

/**
 * 旧・即時判定 (最初に該当した1人を返す)。遅延判定への移行後は「キック瞬間にオフサイド
 * 位置の味方が居るか」の問い合わせとしてテスト等から使われる。実試合の成立判定には
 * 使わないこと (上記コメント参照)。
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
