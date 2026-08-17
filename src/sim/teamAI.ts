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
import { computeMarkHomePosition } from './marking';
import { computeSupportHomePosition, isSupportRunner } from './supportRun';
import {
  AI_BALL_DEADZONE_PRIMARY_SQ_FIXED,
  PRIMARY_PURE_CHASE_RADIUS_SQ_FIXED,
  AI_BALL_DEADZONE_SQ_FIXED,
  AI_FINAL_DEADZONE_SQ_FIXED,
  AI_HOME_DEADZONE_SQ_FIXED,
  AI_HOME_LEASH_RAMP_FAR_SQ_FIXED,
  AI_HOME_LEASH_RAMP_NEAR_SQ_FIXED,
  BALL_ATTRACTION_WEIGHT_CLOSE_RANGE_FIXED,
  BALL_ATTRACTION_WEIGHT_COVER_FIXED,
  BALL_ATTRACTION_WEIGHT_NON_CHASER_FIXED,
  CHASE_RIGHT_HOLDERS_DEFENDING,
  CHASE_RIGHT_HOLDERS_POSSESSING,
  HOME_PULL_WEIGHT_FAR_FIXED,
  LINE_FOLLOW_GRID_FIXED,
  HOME_PULL_WEIGHT_NEAR_FIXED,
  LINE_PUSH_STANDOFF_FIXED,
  LINE_PUSH_FOLLOW_BOOST_MIN_HOME_DEPTH_FIXED,
  LINE_PUSH_FOLLOW_MIN_FIXED,
  LINE_RETREAT_DAMPING_FIXED,
  OFFSIDE_BIAS_MARGIN_FIXED,
  OFFSIDE_BIAS_WEIGHT_FIXED,
  ONSIDE_HOME_MARGIN_FIXED,
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

/** ボール追跡権の役割。primary=最寄り(ボールに直行)、cover=カバー(付かず離れず)、null=権利なし。 */
export type ChaseRole = 'primary' | 'cover';

/**
 * 「ボール追跡権」を持つ選手の players[] index → 役割 のマップを求める (毎tick1回だけ呼ぶ純関数)。
 * 各チームごとに、フィールドプレイヤー(GK除く)をボールとの距離の二乗で昇順ソートし、
 * 上位N人に役割を与える。Nはチームの立場で変える:
 * 守備側(ボール非保持)=CHASE_RIGHT_HOLDERS_DEFENDING(2人、1人目=primary/2人目=cover)、
 * 保持側=CHASE_RIGHT_HOLDERS_POSSESSING(1人=primary、パスの受け手/こぼれ球回収)、
 * 競り合い中(possessionTeam=null)=両チームとも守備側扱い。
 * 同点は小さいindexが勝つ (既存の決定論的タイブレーク方針を踏襲、argminの安定化)。
 *
 * 実プレイで発覚した「団子サッカー」(ほぼ全選手がボールへ殺到する) バグの修正。
 * 追跡権を持たない選手は computeNonControlledDirection 内で
 * BALL_ATTRACTION_WEIGHT_NON_CHASER_FIXED (弱い引力) を使い、ホームポジション
 * (チームライン調整込み) を優先してフォーメーションの形を保つ。
 * primary/coverを分けるのは観戦シミュレーターでの団子度測定に基づく調整: 2人とも
 * 全力でボール座標へ直行させると同じ点に折り重なるため、カバーは中間の引力で
 * 付かず離れずの距離を保たせる (プレス+カバーの読み合い構造は維持)。
 *
 * suppressedTeam (Phase 5、リスタート猶予): このチームには追跡権を一切割り当てない
 * (holders算出前にスキップ)。possessionTeamによる保持/守備の人数振り分け(1人/2人)とは
 * 完全に独立した抑制軸である点が重要: primaryの引力weight(3.0)は保持/守備の区別と
 * 無関係に同じ値のため、「相手を守備側(2人)に振り分ける」だけでは相手の追跡権を
 * 弱めることができない(むしろ2人目cover分だけ強めてしまう) — 実際、4周目に追加された
 * ゴールキック時の`lastTouchTeam = restartTeam`という振り分けはこの理由で効果が薄く、
 * 実プレイで「ゴールキックなのにボールを奪われる」報告が続いた。そのため
 * 「そのチームには追跡権を与えない」という別軸を新設する。デフォルト値nullは
 * 既存の全呼び出し箇所(update.ts含む)を無変更のまま動作させる。
 */
export function computeChaseRightIndices(
  players: readonly PlayerState[],
  ballPos: Vec2Fixed,
  possessionTeam: TeamId | null,
  suppressedTeam: TeamId | null = null,
): ReadonlyMap<number, ChaseRole> {
  const result = new Map<number, ChaseRole>();

  // 距離はバケットに量子化してから順位付けする (メンバーシップの安定化):
  // 生の距離で毎tickソートすると、ほぼ等距離の2人が互いに1歩動くたびに追跡権の
  // メンバー自体が入れ替わり、片方が「追跡権あり(ボールへ)/なし(ホームへ)」を毎tick
  // 往復して足踏みし続ける (観戦シミュレーターの振動検出で発覚)。同バケット内は
  // 小さいindexが常に勝つため、近接した2人の順位は完全に安定する。
  //
  // バケット幅は元48pxから64pxへ拡大した (Phase 5): リスタート猶予導入のバタフライ効果で
  // 以前踏んでいなかった経路が変わり、ゴール前の混戦(ボール・touch priorityが数tickごとに
  // 入れ替わる)でcover役のメンバーシップ(2位候補)がバケット境界をわずかに跨いで
  // 入れ替わり続ける振動が新たに発覚した。48pxでは境界付近のタイに対するマージンが
  // 薄かったため、64pxへ広げて再発を防いだ (観戦シミュレーター全マトリクスで団子度等の
  // 副作用が無いことを確認済み)。
  //
  // 注記: touch priority(実際にボールに触れている選手)を優先するタイブレークも検討したが、
  // ルーズボールの競り合いでtouchPriorityIndex自体がtickごとに入れ替わりうる
  // (DRIBBLE_RADIUS=20pxという狭い判定のため)ことが原因で、むしろ広範囲の新たな振動を
  // 誘発することが判明し不採用にした。indexという不変属性のみに紐付けた現行方式を維持する。
  const DIST_BUCKET = toFixed(64 * 64) as number; // 64px の距離二乗 (Fixedスケール)

  for (const team of [TeamId.A, TeamId.B]) {
    if (team === suppressedTeam) continue; // リスタート猶予中: このチームは追跡権ゼロ
    const holders =
      possessionTeam === team ? CHASE_RIGHT_HOLDERS_POSSESSING : CHASE_RIGHT_HOLDERS_DEFENDING;
    const candidates: Array<{ index: number; bucket: number }> = [];
    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      if (!player || player.team !== team || player.isGoalkeeper) continue;
      const distSq = distSqFixed(player.pos, ballPos) as number;
      candidates.push({ index: i, bucket: Math.floor(distSq / DIST_BUCKET) });
    }
    candidates.sort((a, b) => (a.bucket !== b.bucket ? a.bucket - b.bucket : a.index - b.index));
    const selected = candidates.slice(0, Math.min(holders, candidates.length));
    // primary/cover の役割は「選ばれた中で最小index」に固定する (距離順にしない)。
    // 距離順で決めると、2人がボールからほぼ等距離の時に毎tick役割が入れ替わり、
    // 引力の重み(0.9/0.45)が交互に切り替わって2人ともボール周りで小刻みに踊り続ける
    // (観戦シミュレーターの振動検出で発覚)。メンバー自体の入れ替わりは距離差が
    // 大きくないと起きないため自然なヒステリシスがあるが、ペア内の役割は
    // indexという不変の属性に紐付けて完全に安定させる。
    if (selected.length > 0) {
      const primaryIndex = Math.min(...selected.map((c) => c.index));
      for (const c of selected) {
        result.set(c.index, c.index === primaryIndex ? 'primary' : 'cover');
      }
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
  manualLineOffset: Fixed = ZERO_FIXED,
): Vec2Fixed {
  const home = getHomePosition(team, slotIndex, formationId, half);
  if (possessionTeam === null) return home;

  const homeDepth = depthFromOwnGoal(team, half, home.y) as number;
  // ボール深度は粗いグリッドに量子化して使う (ボールの毎tickの微小移動にライン全体が
  // 追随して全選手が小刻みに揺れるのを防ぐ — 観戦シミュレーターの振動検出で発覚)。
  const grid = LINE_FOLLOW_GRID_FIXED as number;
  const rawBallDepth = depthFromOwnGoal(team, half, ballPos.y) as number;
  const ballDepth = Math.floor(rawBallDepth / grid) * grid;
  const teamHasBall = possessionTeam === team;
  // 押し上げ時はボール深度そのものではなく、その手前 LINE_PUSH_STANDOFF (150px) を目標にする
  // (「ボールの後方に支援ラインを敷く」近似。ボール深度に密着させると同深度の味方が
  // ボール周辺に常時複数入り、団子度が悪化する — 観戦シミュレーターで発覚)。
  const pushTargetDepth = ballDepth - (LINE_PUSH_STANDOFF_FIXED as number);
  // ライン操作 (続編仕様④、STARTボタン): 人間(Team A)のみが対象。GameState.manualLineOffset
  // は符号付きのdepth値(+=ディフェンスラインを押し上げる/-=オフェンスラインを下げる、
  // 符号の決定自体はupdate.ts側が担う)で、targetDepthへそのまま加算する。
  const manualOffsetForTeam = team === TeamId.A ? (manualLineOffset as number) : 0;
  const targetDepth = ((teamHasBall
    ? Math.max(homeDepth, pushTargetDepth)
    : Math.min(homeDepth, ballDepth)) + manualOffsetForTeam) as Fixed;

  // 追従率 = このスロットのホーム深さ / ハーフの深さ (0..1にクランプ、GKはほぼ0、FWは大きい)。
  const followFraction = clampFixed(fixedDiv(homeDepth as Fixed, HALF_PITCH_DEPTH_FIXED), ZERO_FIXED, toFixed(1));
  // 被保持中(自チームが守る側)の引き下げは、保持中の押し上げよりも弱める (LINE_RETREAT_DAMPING_FIXED)。
  // 減衰無しだと、AI_HOME_LEASH_SQ_FIXEDによる「ホーム近傍でのボール追跡」との相乗効果で、
  // 守備側の選手がホームからどれだけ離れていても常にボールとほぼ同じ深さまで一斉に引き寄せられ、
  // 実質的に全員でボールを取り囲んでしまう(実プレイ相当のテストで発覚、計画時の想定を超えた過剰収束)。
  //
  // 押し上げ側の追従率の下限 (Phase 5、乖離B-2の修正、挙動仕様書1.2「キャリア周囲の
  // パスの選択肢」): ホーム深さ由来の追従率(MF≈0.5)のままでは、ボールが敵陣深くへ進むほど
  // 中盤が置いていかれ(ボール深度1400の時にMFは550px後方)、キャリアの周囲にパスの選択肢が
  // 存在しなくなる — 特にCPUキャリアは最速で前進するため近接サポートが実測0.39-0.86まで
  // 低下していた。ホーム深さがLINE_PUSH_FOLLOW_BOOST_MIN_HOME_DEPTH以上のスロット
  // (MF/FW、DFは対象外=レストディフェンス維持)に限り、押し上げ時の追従率に下限を設けて
  // 支援ライン(standoff手前)まで随伴させる。
  const boostedFollowFraction =
    teamHasBall && homeDepth >= (LINE_PUSH_FOLLOW_BOOST_MIN_HOME_DEPTH_FIXED as number)
      ? (Math.max(followFraction as number, LINE_PUSH_FOLLOW_MIN_FIXED as number) as Fixed)
      : followFraction;
  const effectiveFollowFraction = teamHasBall
    ? boostedFollowFraction
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
 * chaseRole (computeChaseRightIndices が毎tick1回だけ判定) による使い分け:
 * - 'primary' (最寄り): 圧倒的なボール引力(3.0) + リーシュ免除 = ボールへ直行。
 * - 'cover' (カバー): 中間の引力 + リーシュ免除 = 付かず離れず。
 * - null (権利なし): 弱い引力 = ホームポジション優先でスペースを守る。
 * 全員が常にフル引力だった旧実装は、リーシュ内にいる選手全員がボールへ収束してしまう
 * 「団子サッカー」を引き起こしていた (実プレイで発覚)。
 *
 * ホーム目標の差し替え (Phase 4: マーク + サポートラン)。新しい力項は追加せず、
 * ホーム復元力が収束する目標点を役割に応じて差し替える。選手ごとの優先順位:
 * 1. chaseRole あり → ライン調整ホーム (追跡が最優先、マーク/サポートは無視)
 * 2. markTargetIndex あり (守備側DF、computeMarkAssignments) → マーク対象のゴール側48px
 * 3. サポートランナー枠 (攻撃側、isSupportRunner) → ボール前方180pxの走り込み点
 * 4. それ以外 → ライン調整ホーム
 * 実プレイで判明した「マークが無い・パスを受ける動きが無い(連動性の不足)」への対応。
 * 差し替え後の目標にもオンサイドクランプ以降の既存の振動対策がすべて適用される。
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
  chaseRole: ChaseRole | null,
  markTargetIndex: number | null = null,
  manualLineOffset: Fixed = ZERO_FIXED,
): Direction8 {
  const lineHome = computeLineAdjustedHomePosition(
    player.team,
    player.slotIndex,
    teamFormations[player.team],
    half,
    ballPos,
    possessionTeam,
    manualLineOffset,
  );

  // ホーム目標の差し替え (Phase 4): 新しい力項は追加せず、ホーム復元力が収束する目標点だけを
  // 選手の役割に応じて差し替える。以降のオンサイドクランプ・ホームdeadzone・リーシュランプ等の
  // 既存の振動対策はすべてそのまま効く。優先順位:
  // 1. 追跡権保有者 → ライン調整ホームのまま (マーク/サポートより追跡が優先、分岐順で保証)
  // 2. マーク対象あり (守備側、computeMarkAssignments が毎tick1回割り当て)
  //    → マーク対象のゴール側スタンドオフ点
  // 3. サポートランナー枠 (攻撃側、isSupportRunner は静的述語)
  //    → ボール前方への走り込み点 (オフサイドは既存クランプが頭打ちにする)
  // 4. それ以外 → ライン調整ホームのまま
  const baseHome =
    chaseRole === null && markTargetIndex !== null && allPlayers[markTargetIndex]
      ? computeMarkHomePosition(allPlayers[markTargetIndex].pos, player.team, half)
      : chaseRole === null &&
          possessionTeam === player.team &&
          isSupportRunner(player.slotIndex, teamFormations[player.team])
        ? computeSupportHomePosition(player, allPlayers, lineHome, ballPos, half)
        : lineHome;

  const offsideLineY = computeOffsideLine(allPlayers, opponentOf(player.team), half);
  const attacksUp = attackingIsUpward(player.team, half);
  // マージン付きのライン超過判定 (バイアスのON/OFFがラインの微動で毎tick反転して
  // FWが小刻みに揺れ続けるのを防ぐ。マージン内のわずかな超過は許容する)。
  const margin = OFFSIDE_BIAS_MARGIN_FIXED as number;
  const beyondLine = attacksUp
    ? (player.pos.y as number) < (offsideLineY as number) - margin
    : (player.pos.y as number) > (offsideLineY as number) + margin;
  const offsideDir = beyondLine ? (attacksUp ? Direction8.Down : Direction8.Up) : Direction8.None;

  // ライン調整後のホーム目標をオンサイド側にクランプする (振動バグの修正、観戦シミュレーターで
  // 発覚): 押し上げでホームがオフサイドラインの先まで進むと、ホーム復元力(前へ)と
  // オフサイドバイアス(後ろへ)が境界を挟んで毎tick反転する押し合いになり、選手がライン上で
  // 永久に振動する。目標自体をラインの手前(ONSIDE_HOME_MARGIN)に留めれば対立は起きない。
  // クランプ位置は24pxグリッドに量子化する (相手DFが動くたびにラインが毎tick数px滑り、
  // ライン際に立つFWのホーム目標がそれに追随して延々シャッフルするのを防ぐ。
  // グリッド1段(24px)はホームdeadzone(28px)より小さいため、1段の変化では選手は動かない)。
  const CLAMP_GRID = 24 * 256; // 24px (Fixed単位)
  const quantizedLineY = (Math.floor((offsideLineY as number) / CLAMP_GRID) * CLAMP_GRID) as Fixed;
  const onsideLimitY = attacksUp
    ? (((quantizedLineY as number) + CLAMP_GRID + (ONSIDE_HOME_MARGIN_FIXED as number)) as Fixed)
    : (((quantizedLineY as number) - (ONSIDE_HOME_MARGIN_FIXED as number)) as Fixed);
  const clampedHomeY = attacksUp
    ? (Math.max(baseHome.y as number, onsideLimitY as number) as Fixed)
    : (Math.min(baseHome.y as number, onsideLimitY as number) as Fixed);
  const home = { x: baseHome.x, y: clampedHomeY };

  const homeDiff = vSub(home, player.pos);
  const homeDistSq = dotFixed(homeDiff, homeDiff);
  const homeDir = quantizeToDirection8(homeDiff, AI_HOME_DEADZONE_SQ_FIXED);
  const ballDiff = vSub(ballPos, player.pos);

  // primary追跡者は引力weightが圧倒的(3.0)なため、通常のデッドゾーン(4px)では1tick移動量
  // (3px)に対するマージンが薄く、既にボールを保持している味方へ無意味に収束しようとして
  // 極小距離で往復する振動が実プレイ相当のテストで発覚した (Phase 5、リスタート猶予導入の
  // バタフライ効果で新たに踏んだ経路)。primaryだけデッドゾーンを広げて再発を防ぐ
  // (cover/非追跡権は元の4pxのまま — 広げるとdango等の全体挙動に副作用が出るため)。
  const ballDeadzone = chaseRole === 'primary' ? AI_BALL_DEADZONE_PRIMARY_SQ_FIXED : AI_BALL_DEADZONE_SQ_FIXED;
  const ballDir = quantizeToDirection8(ballDiff, ballDeadzone);

  /**
   * ★振動の根治 (17周目)★ primary追跡者がボールのデッドゾーン内に到達したら、その場に留まる。
   *
   * 症状: 「ボール担当(primary)なのに、近づくとホーム復元力に引かれて離れ、離れると
   * ボール引力(weight 3.0)で戻る」を毎tick繰り返す2tick周期の無限往復。
   * idle試合の player2 で実測 (ゴールキックのロック中、ボール距離 7.7px ⇄ 10.6px、
   * ホームは109px先): デッドゾーン境界(9px)を1歩(2.9px)で跨ぐため構造的に収束しない。
   * どのscriptSeedでも同一に再現するため、シードの付け替えでは絶対に消せなかった。
   *
   * 修正の考え方: 「ボールに到達したprimaryはボールの担当者である」= ホームへ帰る理由が無い。
   * デッドゾーンを広げる対症療法ではなく、矛盾する2つの目標のうち片方を明確に切る。
   * これは cover/非追跡権には適用しない (彼らはホーム優先で正しい)。
   */
  if (chaseRole === 'primary' && ballDir === Direction8.None) {
    return Direction8.None;
  }

  // ★24周目サイクル②★ primaryがボールの至近 (48px) に居るなら純粋にボールへ向かう。
  // 理由と実測は PRIMARY_PURE_CHASE_RADIUS_SQ_FIXED (teamAIConstants.ts) のコメント参照。
  if (chaseRole === 'primary' && (dotFixed(ballDiff, ballDiff) as number) <= (PRIMARY_PURE_CHASE_RADIUS_SQ_FIXED as number)) {
    return ballDir;
  }

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
  // 追跡権保持者はリーシュ(遠方での強い呼び戻し)を免除し、ピッチ全域でボールを追える
  // (観戦シミュレーターで発覚した「前線からのプレスが存在しない」バグの修正: ボールが
  // 敵陣深くにあると、最寄りのFWが追跡権を持っていてもホームから離れるほど呼び戻しが
  // 強まり、リーシュ半径の先へは決して踏み込めなかった。設計方針: 追跡権=ピッチ全域での
  // 追跡許可。それ以外の選手のポジション規律はライン押し上げ/引き下げが担う)。
  const homeWeight =
    chaseRole !== null
      ? HOME_PULL_WEIGHT_NEAR_FIXED
      : lerpFixed(HOME_PULL_WEIGHT_NEAR_FIXED, HOME_PULL_WEIGHT_FAR_FIXED, leashRampFraction);
  // primary追跡者はボールへの引力を距離によらず圧倒的優勢(3.0)にする: 「追う」と決めた
  // 1人はホーム復元力等との合成で足が止まらず、単調にボールへ収束する。
  // これは2つの実測バグの構造的な解決策 (観戦シミュレーターで発覚):
  // 1. 中間の引力(0.9)だとホーム項と部分的に打ち消し合い、ボールの手前で足踏み/
  //    振動する equilibrium が距離帯ごとに発生し得る (八方向量子化の合成方式に内在)。
  // 2. 追跡権のメンバーシップがほぼ等距離の2人の間で毎tick入れ替わる場合でも、
  //    primaryになったtickで確実に距離が縮む(圧倒的引力)なら、次tickもprimaryで
  //    あり続け、入れ替わり自体が自然に止まる (自己安定化)。
  // cover(カバー役)は中間の引力で付かず離れず、非追跡権はホーム優先 — 従来どおり。
  const ballWeight =
    chaseRole === 'primary'
      ? BALL_ATTRACTION_WEIGHT_CLOSE_RANGE_FIXED
      : chaseRole === 'cover'
        ? BALL_ATTRACTION_WEIGHT_COVER_FIXED
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
  // バイアスを加えるのは以下2条件を満たす時のみ:
  // - combinedが最終deadzone以上 (静止すべき状態で向き癖により動き続けるのを防ぐ)
  // - 現在の向きがcombinedと同じ側 (内積>0)。逆向きのバイアスは「隣接方向のタイブレーク」
  //   という目的を超えて合成結果を打ち消し、弱い正味の力をdeadzone未満に押し下げて
  //   選手を不当に静止させてしまう (単体テストで発覚した境界ケース)。
  const combinedMagSq = dotFixed(combined, combined) as number;
  const facingVec = DIRECTION_VECTORS[player.facing];
  const facingAligned = (dotFixed(combined, facingVec) as number) > 0;
  const biased =
    combinedMagSq >= (AI_FINAL_DEADZONE_SQ_FIXED as number) && facingAligned
      ? vAdd(combined, vScaleFixed(facingVec, STICKY_FACING_BIAS_FIXED))
      : combined;

  return quantizeToDirection8(biased, AI_FINAL_DEADZONE_SQ_FIXED);
}
