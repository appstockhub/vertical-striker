import {
  clampFixed,
  distSqFixed,
  dotFixed,
  fixedDiv,
  fixedMul,
  fixedSub,
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
  AI_HOME_LEASH_RAMP_FAR_SQ_FIXED,
  AI_HOME_LEASH_RAMP_NEAR_SQ_FIXED,
  BALL_ATTRACTION_WEIGHT_CLOSE_RANGE_FIXED,
  BALL_ATTRACTION_WEIGHT_FIXED,
  BALL_ATTRACTION_WEIGHT_NON_CHASER_FIXED,
  BALL_CLOSE_RANGE_SQ_FIXED,
  CHASE_RIGHT_HOLDERS_PER_TEAM,
  HOME_PULL_WEIGHT_FAR_FIXED,
  HOME_PULL_WEIGHT_NEAR_FIXED,
  LINE_RETREAT_DAMPING_FIXED,
  OFFSIDE_BIAS_WEIGHT_FIXED,
  STICKY_FACING_BIAS_FIXED,
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
 * 「ボール追跡権」を持つ選手の players[] index 集合を求める (毎tick1回だけ呼ぶ純関数)。
 * 各チームごとに、フィールドプレイヤー(GK除く)をボールとの距離の二乗で昇順ソートし、
 * 上位 holdersPerTeam 人 (通常2人=最寄り+カバー1人) だけを追跡権保持者とする。
 * 同点は小さいindexが勝つ (既存の決定論的タイブレーク方針を踏襲、argminの安定化)。
 *
 * 実プレイで発覚した「団子サッカー」(ほぼ全選手がボールへ殺到する) バグの修正。
 * 追跡権を持たない選手は computeNonControlledDirection 内で
 * BALL_ATTRACTION_WEIGHT_NON_CHASER_FIXED (弱い引力) を使うことで、ホームポジション
 * (チームライン調整込み) を優先し、フォーメーションの形を保つ。
 */
export function computeChaseRightIndices(
  players: readonly PlayerState[],
  ballPos: Vec2Fixed,
  holdersPerTeam: number = CHASE_RIGHT_HOLDERS_PER_TEAM,
): ReadonlySet<number> {
  const result = new Set<number>();

  for (const team of [TeamId.A, TeamId.B]) {
    const candidates: Array<{ index: number; distSq: number }> = [];
    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      if (!player || player.team !== team || player.isGoalkeeper) continue;
      candidates.push({ index: i, distSq: distSqFixed(player.pos, ballPos) as number });
    }
    candidates.sort((a, b) => (a.distSq !== b.distSq ? a.distSq - b.distSq : a.index - b.index));
    for (let k = 0; k < Math.min(holdersPerTeam, candidates.length); k++) {
      const candidate = candidates[k];
      if (candidate) result.add(candidate.index);
    }
  }

  return result;
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
 * ホームの復元力はホームからの距離に応じて滑らかに変化する (near=弱い やや、far=強い、
 * AI_HOME_LEASH_RAMP_NEAR/FAR_SQ_FIXED の間を線形補間)。ホーム近傍では弱く (ボール引力を
 * 優位にして追跡を許可)、離れるほど強く (呼び戻す) する。
 * 距離によらず常にフル強度だった旧実装は、ボールがホームと反対方向にある場合ほぼ常に
 * ホーム項が勝ってしまい、非操作選手がホームのすぐ外側で実質的に凍結してボールを
 * 追いかけられない不具合があった (実プレイで発覚、Phase 3で修正)。さらにその修正で
 * 単一のしきい値による瞬時切替を導入したところ、選手がしきい値ちょうどの距離に留まり
 * 「ホームへの1歩→ボールへの1歩」を永久に繰り返すチャタリング(見た目上は凍結と同じ)が
 * 実プレイで新たに発覚したため、滑らかな線形補間に置き換えた (2度目の修正)。
 *
 * ホームポジション自体も computeLineAdjustedHomePosition により、保持チームとボールの深さに
 * 応じて押し上げ/引き下げられる (チームライン全体の上下動、実プレイで発覚した「Team Bが
 * ハーフラインを越えて攻めない」バグの修正)。この関数はその「動くホーム」に向かって
 * 収束しようとするだけで、押し上げ量の計算自体には関与しない。
 *
 * hasChaseRight (computeChaseRightIndices が毎tick1回だけ判定) が false の選手は
 * ボール引力を BALL_ATTRACTION_WEIGHT_NON_CHASER_FIXED (弱い) に差し替える。
 * 全員が常にフル引力だった旧実装は、リーシュ内にいる選手全員がボールへ収束してしまう
 * 「団子サッカー」を引き起こしていた (実プレイで発覚)。
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
  hasChaseRight: boolean,
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
  const ballDiff = vSub(ballPos, player.pos);
  const ballDistSq = dotFixed(ballDiff, ballDiff);
  const ballDir = quantizeToDirection8(ballDiff, AI_BALL_DEADZONE_SQ_FIXED);

  const offsideLineY = computeOffsideLine(allPlayers, opponentOf(player.team), half);
  const attacksUp = attackingIsUpward(player.team, half);
  const beyondLine = attacksUp
    ? (player.pos.y as number) < (offsideLineY as number)
    : (player.pos.y as number) > (offsideLineY as number);
  const offsideDir = beyondLine ? (attacksUp ? Direction8.Down : Direction8.Up) : Direction8.None;

  // near半径以内は0、far半径以遠は1、間は距離の二乗に対して線形に遷移する比率
  // (チャタリング防止のため、単一しきい値での瞬時切替をやめて滑らかな帯にした)。
  const leashRampFraction = clampFixed(
    fixedDiv(
      fixedSub(homeDistSq, AI_HOME_LEASH_RAMP_NEAR_SQ_FIXED),
      fixedSub(AI_HOME_LEASH_RAMP_FAR_SQ_FIXED, AI_HOME_LEASH_RAMP_NEAR_SQ_FIXED),
    ),
    ZERO_FIXED,
    toFixed(1),
  );
  const homeWeight = lerpFixed(HOME_PULL_WEIGHT_NEAR_FIXED, HOME_PULL_WEIGHT_FAR_FIXED, leashRampFraction);
  // 追跡権を持つ選手がボールにごく近い(BALL_CLOSE_RANGE_SQ_FIXED以内)場合は、ボール引力を
  // 大きく引き上げてホーム復元力を実質無視させる(「最終アプローチ」)。
  // 量子化した8方向どうしを重み付け合成する都合上、目標が斜め方向にある場合など、
  // ホームとボールの成分が軸ごとに打ち消し合って本来ボールに向かうべきなのに
  // 合成方向がボールから外れてしまい、ボールの手前20〜30px程度で永久に足踏みする
  // (八方向量子化のこの合成方式に内在する既知の限界、実プレイ相当のテストで発覚)。
  // ボールにこれだけ近ければホーム位置を気にする理由が薄いという前提のもと、
  // 最終接近では引力を圧倒的に優勢にすることで対処する。
  const isFinalApproach = hasChaseRight && (ballDistSq as number) <= (BALL_CLOSE_RANGE_SQ_FIXED as number);
  const ballWeight = isFinalApproach
    ? BALL_ATTRACTION_WEIGHT_CLOSE_RANGE_FIXED
    : hasChaseRight
      ? BALL_ATTRACTION_WEIGHT_FIXED
      : BALL_ATTRACTION_WEIGHT_NON_CHASER_FIXED;

  const combined = vAdd(
    vAdd(
      vScaleFixed(DIRECTION_VECTORS[homeDir], homeWeight),
      vScaleFixed(DIRECTION_VECTORS[ballDir], ballWeight),
    ),
    vScaleFixed(DIRECTION_VECTORS[offsideDir], OFFSIDE_BIAS_WEIGHT_FIXED),
  );

  // 現在向いている方向(=前tickで実際に選んだ方向)へ小さなバイアスを加える。目標方向が
  // 隣り合う2つの8方向のちょうど境界付近にある場合、バイアス無しだと選手が1tickごとに
  // 位置がわずかに動くたびargmaxの勝者が入れ替わり、2方向を永久に往復するチャタリングに
  // 陥る(境界の滑らか化だけでは解決しない、実プレイ相当のテストで発覚した別種の不具合)。
  // combinedがすでに最終deadzone未満(=実質的に静止すべき状態)の時はバイアスを加えない
  // (常に前の向きへわずかに動き続けてしまい、二度と静止できなくなるのを防ぐため)。
  const combinedMagSq = dotFixed(combined, combined) as number;
  const biased =
    combinedMagSq >= (AI_FINAL_DEADZONE_SQ_FIXED as number)
      ? vAdd(combined, vScaleFixed(DIRECTION_VECTORS[player.facing], STICKY_FACING_BIAS_FIXED))
      : combined;

  return quantizeToDirection8(biased, AI_FINAL_DEADZONE_SQ_FIXED);
}
