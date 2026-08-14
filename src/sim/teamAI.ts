import { vAdd, vScaleFixed, vSub, ZERO_FIXED } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { Direction8 } from '../input/types';
import { DIRECTION_VECTORS } from './constants';
import { quantizeToDirection8 } from './steering';
import {
  attackingIsUpward,
  depthFromOwnGoal,
  getHomePosition,
  opponentOf,
  TeamId,
  type FormationId,
  type Half,
} from './formations';
import type { PlayerState } from './state';
import {
  AI_BALL_DEADZONE_SQ_FIXED,
  AI_FINAL_DEADZONE_SQ_FIXED,
  AI_HOME_DEADZONE_SQ_FIXED,
  BALL_ATTRACTION_WEIGHT_FIXED,
  HOME_PULL_WEIGHT_FIXED,
  OFFSIDE_BIAS_WEIGHT_FIXED,
} from './teamAIConstants';

/**
 * 指定チームのオフサイドライン Y 座標 (自陣ゴールから2番目に深い選手のY、GK含む11人中)。
 * 「2番目に深い選手」を昇順indexで走査しながら streaming に求める (安定ソート不要、O(11))。
 * 同点は先に見つかった方 (小さいindex) が優先される — depth が同値ならYも同値になるため、
 * どちらが選ばれても結果のオフサイドラインYは変わらない。
 */
export function computeOffsideLine(allPlayers: readonly PlayerState[], team: TeamId, half: Half): Fixed {
  let bestDepth: number | null = null;
  let bestY: Fixed = ZERO_FIXED;
  let secondDepth: number | null = null;
  let secondY: Fixed = ZERO_FIXED;

  for (let i = 0; i < allPlayers.length; i++) {
    const player = allPlayers[i];
    if (!player || player.team !== team) continue;

    const depth = depthFromOwnGoal(team, half, player.pos.y) as number;
    if (bestDepth === null || depth < bestDepth) {
      secondDepth = bestDepth;
      secondY = bestY;
      bestDepth = depth;
      bestY = player.pos.y;
    } else if (secondDepth === null || depth < secondDepth) {
      secondDepth = depth;
      secondY = player.pos.y;
    }
  }

  // 通常は11人(GK含む)全員見つかるため secondY が必ず設定される。
  // チーム人数が1人以下の異常系では bestY にフォールバックする。
  return secondDepth === null ? bestY : secondY;
}

/**
 * 非操作選手1人ぶんのAI操作方向を求める (毎tick呼ぶ純関数)。
 * 「ホームポジションへの復元力 + ボール位置への引力 + オフサイドライン意識」を
 * それぞれ8方向に量子化してから重み付け合成し、最終的にもう一度8方向へ量子化する。
 * 生ベクトルのまま重み付けすると、ピクセル距離が大きい項が重みを無視して支配して
 * しまうため、量子化してから重みを掛けるのが必須 (Phase 2 実装計画参照)。
 *
 * 出力は既存の Direction8 語彙のため、そのまま updatePlayer/applyDribbleTouch に渡せる
 * (Phase 1 のシグネチャ変更が本当に不要だった、という設計判断の実例)。
 */
export function computeNonControlledDirection(
  player: PlayerState,
  allPlayers: readonly PlayerState[],
  ballPos: Vec2Fixed,
  teamFormations: readonly [FormationId, FormationId],
  half: Half,
): Direction8 {
  const home = getHomePosition(player.team, player.slotIndex, teamFormations[player.team], half);
  const homeDir = quantizeToDirection8(vSub(home, player.pos), AI_HOME_DEADZONE_SQ_FIXED);
  const ballDir = quantizeToDirection8(vSub(ballPos, player.pos), AI_BALL_DEADZONE_SQ_FIXED);

  const offsideLineY = computeOffsideLine(allPlayers, opponentOf(player.team), half);
  const attacksUp = attackingIsUpward(player.team, half);
  const beyondLine = attacksUp
    ? (player.pos.y as number) < (offsideLineY as number)
    : (player.pos.y as number) > (offsideLineY as number);
  const offsideDir = beyondLine ? (attacksUp ? Direction8.Down : Direction8.Up) : Direction8.None;

  const combined = vAdd(
    vAdd(
      vScaleFixed(DIRECTION_VECTORS[homeDir], HOME_PULL_WEIGHT_FIXED),
      vScaleFixed(DIRECTION_VECTORS[ballDir], BALL_ATTRACTION_WEIGHT_FIXED),
    ),
    vScaleFixed(DIRECTION_VECTORS[offsideDir], OFFSIDE_BIAS_WEIGHT_FIXED),
  );

  return quantizeToDirection8(combined, AI_FINAL_DEADZONE_SQ_FIXED);
}
