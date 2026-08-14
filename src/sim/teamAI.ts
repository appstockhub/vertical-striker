import {
  clampFixed,
  dotFixed,
  fixedDiv,
  fixedMul,
  lerpFixed,
  toFixed,
  vAdd,
  vScaleFixed,
  vSub,
  ZERO_FIXED,
} from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { Direction8 } from '../input/types';
import { PITCH_HEIGHT } from '../config/pitch';
import { DIRECTION_VECTORS } from './constants';
import { quantizeToDirection8 } from './steering';
import {
  attackingIsUpward,
  depthFromOwnGoal,
  depthToY,
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
  AI_HOME_LEASH_SQ_FIXED,
  BALL_ATTRACTION_WEIGHT_FIXED,
  HOME_PULL_WEIGHT_FAR_FIXED,
  HOME_PULL_WEIGHT_NEAR_FIXED,
  LINE_RETREAT_DAMPING_FIXED,
  OFFSIDE_BIAS_WEIGHT_FIXED,
} from './teamAIConstants';

/** 自陣ハーフの深さの最大値 (ハーフウェーラインまでの距離)。ライン押し上げ量の正規化に使う。 */
const HALF_PITCH_DEPTH_FIXED: Fixed = toFixed(PITCH_HEIGHT / 2);

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
 * チームライン(全体の押し上げ/引き下げ)を反映したホームポジション。
 *
 * 自チームがボールを保持している時はボールの深さ(自陣ゴールからの距離)まで、
 * 相手が保持している時はボールの深さまで、それぞれホームポジションを引き寄せる
 * (自チーム保持中は押し上げのみ・後退はしない、相手保持中は引き下げのみ・前進はしない —
 * どちらも `home` と `ballDepth` の max/min を取ることで一方向にしか動かないよう保証する)。
 * 追従率(どれだけホームがボールに引き寄せられるか)はスロットのホーム深さそのものを再利用する
 * (0=ゴールライン close, ~PITCH_HEIGHT/2=ハーフウェー close 相当。新たなロール定義を増やさず、
 * 既存のフォーメーション深さデータをそのまま流用する): GKは深さがほぼ0なのでほぼ動かず、
 * FWは深さが大きいのでボールの深さに強く追従する、という要求どおりの非対称性が自然に出る。
 *
 * ボールが競り合い中(どちらのチームも touch-priority を持たない)の時は通常のホーム
 * ポジションのまま (押し上げ/引き下げしない)。
 */
export function computeLineAdjustedHomePosition(
  team: TeamId,
  slotIndex: number,
  formationId: FormationId,
  half: Half,
  ballPos: Vec2Fixed,
  possessionTeam: TeamId | null,
): Vec2Fixed {
  const home = getHomePosition(team, slotIndex, formationId, half);
  if (possessionTeam === null) return home;

  const homeDepth = depthFromOwnGoal(team, half, home.y) as number;
  const ballDepth = depthFromOwnGoal(team, half, ballPos.y) as number;
  const teamHasBall = possessionTeam === team;
  const targetDepth = (teamHasBall ? Math.max(homeDepth, ballDepth) : Math.min(homeDepth, ballDepth)) as Fixed;

  // 追従率 = このスロットのホーム深さ / ハーフの深さ (0..1にクランプ、GKはほぼ0、FWは大きい)。
  const followFraction = clampFixed(fixedDiv(homeDepth as Fixed, HALF_PITCH_DEPTH_FIXED), ZERO_FIXED, toFixed(1));
  // 被保持中(自チームが守る側)の引き下げは、保持中の押し上げよりも弱める (LINE_RETREAT_DAMPING_FIXED)。
  // 減衰無しだと、AI_HOME_LEASH_SQ_FIXEDによる「ホーム近傍でのボール追跡」との相乗効果で、
  // 守備側の選手がホームからどれだけ離れていても常にボールとほぼ同じ深さまで一斉に引き寄せられ、
  // 実質的に全員でボールを取り囲んでしまう(実プレイ相当のテストで発覚、計画時の想定を超えた過剰収束)。
  const effectiveFollowFraction = teamHasBall
    ? followFraction
    : fixedMul(followFraction, LINE_RETREAT_DAMPING_FIXED);
  const adjustedDepth = lerpFixed(homeDepth as Fixed, targetDepth, effectiveFollowFraction);

  return { x: home.x, y: depthToY(team, half, adjustedDepth) };
}

/**
 * 非操作選手1人ぶんのAI操作方向を求める (毎tick呼ぶ純関数)。
 * 「ホームポジションへの復元力 + ボール位置への引力 + オフサイドライン意識」を
 * それぞれ8方向に量子化してから重み付け合成し、最終的にもう一度8方向へ量子化する。
 * 生ベクトルのまま重み付けすると、ピクセル距離が大きい項が重みを無視して支配して
 * しまうため、量子化してから重みを掛けるのが必須 (Phase 2 実装計画参照)。
 *
 * ホームの復元力はホームからの距離に応じた2段階 (near/far、AI_HOME_LEASH_SQ_FIXED が閾値)。
 * ホーム近傍では弱く (ボール引力を優位にして追跡を許可)、リーシュを越えて離れた場合のみ
 * 強く (呼び戻す) する。距離によらず常にフル強度だった旧実装は、ボールがホームと反対方向に
 * ある場合ほぼ常にホーム項が勝ってしまい、非操作選手がホームのすぐ外側で実質的に凍結して
 * ボールを追いかけられない不具合があった (実プレイで発覚、Phase 3で修正)。
 *
 * ホームポジション自体も computeLineAdjustedHomePosition により、保持チームとボールの深さに
 * 応じて押し上げ/引き下げられる (チームライン全体の上下動、実プレイで発覚した「Team Bが
 * ハーフラインを越えて攻めない」バグの修正)。この関数はその「動くホーム」に向かって
 * 収束しようとするだけで、押し上げ量の計算自体には関与しない。
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
  possessionTeam: TeamId | null,
): Direction8 {
  const home = computeLineAdjustedHomePosition(
    player.team,
    player.slotIndex,
    teamFormations[player.team],
    half,
    ballPos,
    possessionTeam,
  );
  const homeDiff = vSub(home, player.pos);
  const homeDistSq = dotFixed(homeDiff, homeDiff);
  const homeDir = quantizeToDirection8(homeDiff, AI_HOME_DEADZONE_SQ_FIXED);
  const ballDir = quantizeToDirection8(vSub(ballPos, player.pos), AI_BALL_DEADZONE_SQ_FIXED);

  const offsideLineY = computeOffsideLine(allPlayers, opponentOf(player.team), half);
  const attacksUp = attackingIsUpward(player.team, half);
  const beyondLine = attacksUp
    ? (player.pos.y as number) < (offsideLineY as number)
    : (player.pos.y as number) > (offsideLineY as number);
  const offsideDir = beyondLine ? (attacksUp ? Direction8.Down : Direction8.Up) : Direction8.None;

  const homeWeight =
    (homeDistSq as number) > (AI_HOME_LEASH_SQ_FIXED as number)
      ? HOME_PULL_WEIGHT_FAR_FIXED
      : HOME_PULL_WEIGHT_NEAR_FIXED;

  const combined = vAdd(
    vAdd(
      vScaleFixed(DIRECTION_VECTORS[homeDir], homeWeight),
      vScaleFixed(DIRECTION_VECTORS[ballDir], BALL_ATTRACTION_WEIGHT_FIXED),
    ),
    vScaleFixed(DIRECTION_VECTORS[offsideDir], OFFSIDE_BIAS_WEIGHT_FIXED),
  );

  return quantizeToDirection8(combined, AI_FINAL_DEADZONE_SQ_FIXED);
}
