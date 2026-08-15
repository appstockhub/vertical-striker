import { distSqFixed } from '../core/fixed';
import type { RngState } from '../core/rng';
import { nextRangeInt } from '../core/rng';
import { Direction8 } from '../input/types';
import { CHARGE_RANGE_SQ_FIXED } from './tackleConstants';
import { TacklePhase, type Difficulty, type PlayerState } from './state';

/**
 * CPU(非操作選手)の守備チャレンジ判断。
 *
 * ★実装の動機 (観戦シミュレーターで発覚した試合停止)★
 * CPUには攻撃AI (cpuAttackAI.ts) しか無く、守備側は「ボールへ寄る」引力しか持って
 * いなかった。ボールを奪う手段 (スライディング/ショルダーチャージ) は人間の操作選手
 * 専用だったため、CPU守備者は相手保持者に9.6pxまで密着しても**永久に何もしない**。
 * 人間が静止しているだけで試合が完全に停止する (実測: idle試合でTeam Bのシュート1本)。
 * 実サッカーでは、密着した守備者は必ずボールにチャレンジする。
 *
 * 設計:
 *   - 相手保持者にショルダーチャージの間合い (CHARGE_RANGE) まで詰めた守備者のみが対象。
 *     スライディングではなくチャージにしたのは、こちらが「予備動作なしで密着時に出せる
 *     低リスク低リターンの選択肢」であり、状態機械 (Windup/Active/Recovery) を
 *     全選手ぶん回さずに1tickで完結できるため (tackle.ts のコメント参照)。
 *   - 毎tick必ず成功すると人間がボールを1秒も持てなくなるため、確率で発火させる。
 *     決定論を守るため確率は seed 付き PRNG (rngState) から引き、呼び出し側が
 *     必ず戻り値の rngState を書き戻す (cpuAttackAI と同じ規約)。
 *   - 候補が複数いる場合は「最も近い1人」に限定し、同距離ならindexの小さい方を選ぶ
 *     (決定論のため。複数人が同tickにチャージするとボール速度が上書きし合う)。
 */

/** 難易度ごとの、密着時に1tickでチャレンジを仕掛ける確率 (%)。 */
const CHALLENGE_CHANCE_PERCENT: Readonly<Record<Difficulty, number>> = {
  // easy でも必ずチャレンジは来る (来ないと試合が止まる) が、人間がボールを運ぶ猶予は長い。
  easy: 4,
  medium: 8,
  hard: 14,
};

export interface CpuDefenseDecision {
  /** チャージを仕掛ける守備者の players[] index。仕掛けない場合は null。 */
  readonly chargerIndex: number | null;
  /** チャージ方向 (守備者のfacing)。chargerIndex が null の時は Direction8.None。 */
  readonly direction: Direction8;
  /** RNGを消費した場合の更新後state (消費しなくても常に呼び出し側へ返す)。 */
  readonly rngState: RngState;
}

const NO_CHALLENGE = (rngState: RngState): CpuDefenseDecision => ({
  chargerIndex: null,
  direction: Direction8.None,
  rngState,
});

/**
 * このtickにCPU守備者がショルダーチャージを仕掛けるかを判断する純関数。
 *
 * @param carrierIndex touch-priority を持つ選手 (= ボール保持者)。null ならルーズボール。
 * @param controlledPlayerIndex 人間が操作中の選手 (この選手は自分の入力で動くため対象外)。
 */
export function decideCpuDefense(
  carrierIndex: number | null,
  controlledPlayerIndex: number,
  players: readonly PlayerState[],
  difficulty: Difficulty,
  rngState: RngState,
): CpuDefenseDecision {
  if (carrierIndex === null) return NO_CHALLENGE(rngState);
  const carrier = players[carrierIndex];
  if (!carrier) return NO_CHALLENGE(rngState);

  // 間合い以内にいる、相手チームの非操作フィールドプレイヤーのうち最も近い1人。
  let bestIndex: number | null = null;
  let bestDistSq = 0;
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (!player || player.team === carrier.team) continue;
    if (i === controlledPlayerIndex) continue; // 人間の操作選手は自分でBを押す
    if (player.isGoalkeeper) continue; // GKは専用AI (セーブ) に任せる
    if (player.tacklePhase !== TacklePhase.None) continue; // 硬直中は仕掛けない
    const distSq = distSqFixed(player.pos, carrier.pos) as number;
    if (distSq > (CHARGE_RANGE_SQ_FIXED as number)) continue;
    if (bestIndex === null || distSq < bestDistSq) {
      bestIndex = i;
      bestDistSq = distSq;
    }
  }
  if (bestIndex === null) return NO_CHALLENGE(rngState);

  const [roll, nextRng] = nextRangeInt(rngState, 0, 100);
  if (roll >= CHALLENGE_CHANCE_PERCENT[difficulty]) return NO_CHALLENGE(nextRng);

  const charger = players[bestIndex]!;
  return { chargerIndex: bestIndex, direction: charger.facing, rngState: nextRng };
}
