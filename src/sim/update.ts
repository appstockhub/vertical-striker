import {
  clampFixed,
  distSqFixed,
  dotFixed,
  fixedAdd,
  fixedMul,
  fixedSub,
  toFixed,
  vAdd,
  vScaleFixed,
  vSub,
  vZero,
  ZERO_FIXED,
} from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { Direction8, emptyButtonState, type ButtonState } from '../input/types';
import type { BallState, GameState, PendingKick, PlayerState, SetPieceLock } from './state';
import { PLAYERS_PER_TEAM, TacklePhase, TeamId } from './state';
import { attackingIsUpward, getHomePosition, opponentOf, type Half } from './formations';
import { PITCH_HEIGHT } from '../config/pitch';
import { checkOffside } from './offsideRule';
import { DIRECTION_VECTORS, PLAYER_RADIUS_FIXED, PLAYER_SPEED_FIXED } from './constants';
import {
  CURVE_DURATION_TICKS,
  CURVE_INPUT_WINDOW_TICKS,
  DRIBBLE_TOUCH_MAX_HEIGHT_FIXED,
  DRIBBLE_TOUCH_SPEED_FIXED,
  KICK_INPUT_BUFFER_TICKS,
  KICK_MIN_CHARGE_FRAMES,
  KICK_REACH_FIXED,
  LONG_FEED_CHARGE_FRAMES,
  LIFT_Z_VEL_FIXED,
  LONG_DRIBBLE_PLAYER_SPEED_FIXED,
} from './ballConstants';
import { applyDribbleTouch, computeKickDribbleState, isInDribbleContact } from './dribble';
import { applyKick, updateKickCharge } from './kick';
import { clampToPitchBounds, stepBallPhysicsDetailed } from './ballPhysics';
import { findTouchPriorityPlayer } from './ballTouch';
import { computeChaseRightIndices, computeNonControlledDirection } from './teamAI';
import { computeMarkAssignments } from './marking';
import { isTeamAInPossession, resolveCursor, selectPassTarget } from './cursor';
import { quantizeToDirection8 } from './steering';
import {
  applySave,
  computeGoalkeeperAutoDirection,
  isBallApproachingOwnGoal,
  isInSaveRange,
  resolveSaveOutcome,
  shouldTakeOverGoalkeeper,
} from './goalkeeperAI';
import {
  CATCH_MAX_SPEED_FIXED,
  GK_AUTO_SPEED_FIXED,
  SAVE_CONTEXT_MIN_BALL_SPEED_SQ_FIXED,
} from './goalkeeperConstants';
import {
  GOAL_KICK_EXCLUSION_DEPTH_FIXED,
  KICKOFF_CIRCLE_RADIUS_FIXED,
  KICKOFF_KICKER_STANDOFF_FIXED,
  SET_PIECE_EXCLUSION_RADIUS_FIXED,
  SET_PIECE_LOCK_MAX_TICKS,
} from './boundsConstants';
import {
  KICKOFF_GRACE_TICKS,
  LINE_POSSESSION_SWITCH_TICKS,
  MANUAL_LINE_OFFSET_DECAY_FIXED,
  MANUAL_LINE_OFFSET_MAX_FIXED,
  MANUAL_LINE_OFFSET_STEP_FIXED,
  RESTART_GRACE_TICKS,
} from './teamAIConstants';
import {
  advanceTacklePhase,
  applyShoulderCharge,
  applyTackleWin,
  checkShoulderChargeEligibility,
  checkTackleSuccess,
  getTackleMovementOverride,
  type TackleAdvance,
} from './tackle';
import { CHARGE_RECOVERY_FRAMES, TACKLE_RECOVERY_FRAMES } from './tackleConstants';
import { getHalf, isFulltime } from './matchClock';
import { KICKOFF_TAKER_SLOT_INDEX, placeKickoffFormation } from './kickoff';
import { detectBoundaryEvent } from './bounds';
import { decideCpuAttack } from './cpuAttackAI';
import { decideCpuDefense } from './cpuDefenseAI';
import { detectFoul, type FoulEvent } from './foul';
import { placeFreeKick, placePenaltyKick } from './setPieceFormation';

/**
 * 1tick分の入力。InputFrame のサブセット (sim/ は入力の生成元を知らない)。
 * キック溜め時間などtickをまたぐ状態はすべて GameState 側 (PlayerState.kickChargeFrames、
 * GameState.prevButtons) に持たせるため、ここに edge (buttonsPressed 等) を追加する必要は無い。
 */
export interface Inputs {
  readonly direction: Direction8;
  readonly buttons: ButtonState;
}

const NO_BUTTONS = emptyButtonState();
const TEAM_A_GK_INDEX = 0;
const NO_TACKLE: TackleAdvance = { tacklePhase: TacklePhase.None, tackleFrames: 0, tackleDirection: Direction8.None };

/** オフサイド成立時のリスタート用ボール状態 (該当選手の位置へ速度0で置く、間接FK相当)。 */
function offsideRestartBall(offsidePlayer: PlayerState): BallState {
  return { pos: offsidePlayer.pos, vel: vZero(), height: ZERO_FIXED, zVel: ZERO_FIXED };
}

/**
 * 2つの方向がほぼ正反対かどうか (リフティング/続編仕様⑥の「急な方向転換」検出用)。
 * DIRECTION_VECTORSの成分の和がゼロベクトルになる組を正反対と判定する
 * (Up⇔Down、Left⇔Right、斜め4方向の組も同様)。Direction8.Noneはどちらの引数でも
 * 対象外(基準となる向き自体が無いため常にfalse)。
 */
function isOppositeDirection8(a: Direction8, b: Direction8): boolean {
  if (a === Direction8.None || b === Direction8.None) return false;
  const va = DIRECTION_VECTORS[a];
  const vb = DIRECTION_VECTORS[b];
  return (va.x as number) + (vb.x as number) === 0 && (va.y as number) + (vb.y as number) === 0;
}

/**
 * pos が center を中心とする一辺2*radiusの正方形の内側にあれば、支配的な軸(絶対値が
 * 大きい方)へ沿って境界まで押し出す (sqrtを使わない — quantizeToDirection8と同じ考え方)。
 * ピッチ境界内に収めるため最後にclampToPitchBoundsを適用する: コーナーキックの再開
 * スポットのようにピッチ端近くが除外中心になる場合、素の押し出し先が境界外になり得る
 * ため (この場合、除外半径いっぱいまでは押し出せないことを許容する — 実サッカーの
 * タッチライン際でも「規定距離」がピッチ外まで要求されないのと同じ理屈)。
 *
 * 判定を「円(距離の二乗)」ではなく「正方形(軸ごとの絶対値比較)」にしているのは意図的な
 * バグ修正: 円判定+軸方向のみの押し出しの組み合わせだと、押し出し先(片方の軸だけ境界に
 * 一致、もう片方の軸はそのまま)が円の外側でも正方形の内側になり得るため、AIが数tickかけて
 * 押し出し境界へ戻ってくるたびに再び押し出される、という数tick周期の往復(=振動検出に
 * 引っかかる境界バウンド)が実プレイ相当のテストで発覚した。判定・押し出しを同じ正方形
 * 形状に揃えることで、押し出し直後は必ず正方形の外側になり、次にその軸へ1歩でも
 * 踏み込めば即座に押し戻される(=既存のゴールキックY軸ラインクランプと同じ「毎tick
 * 即時再クランプ」の安定構造)ようにした。
 */
function pushOutsideExclusionSquare(pos: Vec2Fixed, center: Vec2Fixed, radius: Fixed): Vec2Fixed {
  const dx = fixedSub(pos.x, center.x);
  const dy = fixedSub(pos.y, center.y);
  const absDx = Math.abs(dx as number);
  const absDy = Math.abs(dy as number);
  const r = radius as number;
  if (absDx >= r || absDy >= r) return pos;

  const pushed: Vec2Fixed =
    absDx >= absDy
      ? { x: (dx as number) >= 0 ? fixedAdd(center.x, radius) : fixedSub(center.x, radius), y: pos.y }
      : { x: pos.x, y: (dy as number) >= 0 ? fixedAdd(center.y, radius) : fixedSub(center.y, radius) };
  return clampToPitchBounds(pushed, PLAYER_RADIUS_FIXED);
}

/**
 * セットプレー再開ロック中の相手押し出し。goalKindは既存(B-5(b))のY軸ライン除外を
 * そのまま踏襲する(挙動を変えない、検証済みのため)。throwIn/cornerはピッチ上の
 * 任意地点で起きるため、再開スポットからの円形(近似)除外にする。
 */
function applySetPieceExclusion(moved: PlayerState, lock: SetPieceLock): PlayerState {
  if (lock.kind === 'kickoff') {
    // 競技規則 第8条: 相手はボールがインプレーになるまでセンターサークルの外。
    // 描画しているセンターサークル(pitchMarkings.ts)と同じ半径なので、画面上でも
    // 「円の外に出されている」ことが分かる。
    const pushedPos = pushOutsideExclusionSquare(moved.pos, lock.pos, KICKOFF_CIRCLE_RADIUS_FIXED);
    return { ...moved, pos: pushedPos };
  }
  if (lock.kind === 'goalKick') {
    const limitY = lock.northEnd
      ? (GOAL_KICK_EXCLUSION_DEPTH_FIXED as number)
      : (toFixed(PITCH_HEIGHT) as number) - (GOAL_KICK_EXCLUSION_DEPTH_FIXED as number);
    const y = moved.pos.y as number;
    const needsPush = lock.northEnd ? y < limitY : y > limitY;
    if (!needsPush) return moved;
    return { ...moved, pos: { x: moved.pos.x, y: limitY as Fixed } };
  }
  const pushedPos = pushOutsideExclusionSquare(moved.pos, lock.pos, SET_PIECE_EXCLUSION_RADIUS_FIXED);
  return { ...moved, pos: pushedPos };
}

/**
 * キックオフの再開ロックを作る (競技規則 第8条)。
 * placeKickoffFormation(half, formations, kickoffTeam) と必ずセットで使うこと
 * (あちらがキッカーをボール脇へ置き、こちらが相手をセンターサークルの外へ縛る)。
 */
/**
 * キーパーがボールを手中に確保している間のロック (競技規則 第12条: 相手はキーパーが
 * 持っているボールにチャレンジできない)。
 *
 * ★実プレイで壊れて見える欠落★ 旧実装では applySave の 'secured' が「キーパーの位置に
 * 速度0で置く」だけだったため、目の前に詰めていた攻撃側が**次のtickにそのまま奪えた**
 * (テスト: tests/sim/goalkeeperPossession.test.ts で t0 に奪取を再現)。
 * セットプレーのロックと同じ「touch-priorityを1チームに制限し、ボールが動いたら解除」
 * 機構をそのまま使う。押し出しは行わない (相手はその場に居てよい)。
 */
function createGoalkeeperHoldLock(gkTeam: TeamId, ballPos: Vec2Fixed): SetPieceLock {
  return { kind: 'gkHold', restartTeam: gkTeam, pos: ballPos, northEnd: false, elapsedTicks: 0 };
}

function createKickoffLock(kickoffTeam: TeamId, ballPos: Vec2Fixed): SetPieceLock {
  return {
    kind: 'kickoff',
    restartTeam: kickoffTeam,
    pos: ballPos,
    northEnd: false, // kickoff では未使用 (円形除外のため)
    elapsedTicks: 0,
  };
}

/**
 * team に属する選手のうち pos に最も近いものの players[] index を返す (同点は小さいindex)。
 * excludeGoalkeeper=true ならGKを候補から外す (スローイン/コーナーはGKが蹴らないため)。
 */
function findNearestTeamPlayerIndex(
  players: readonly PlayerState[],
  pos: Vec2Fixed,
  team: TeamId,
  excludeGoalkeeper = false,
): number | null {
  let bestIndex: number | null = null;
  let bestDistSq = 0;
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (!player || player.team !== team) continue;
    if (excludeGoalkeeper && player.isGoalkeeper) continue;
    const distSq = distSqFixed(pos, player.pos) as number;
    if (bestIndex === null || distSq < bestDistSq) {
      bestIndex = i;
      bestDistSq = distSq;
    }
  }
  return bestIndex;
}

/**
 * セットプレーのキッカー上書き。位置(pos)・向き(facing)を、そのtickの選手移動処理の
 * 最後に強制的に適用する (AIの目標位置計算より優先させる)。
 */
interface SetPieceKickerOverride {
  readonly index: number;
  readonly facing: Direction8;
  readonly pos: Vec2Fixed;
}

/**
 * セットプレーのキッカーを決め、ボールのすぐ脇へ配置する。
 *
 * ★重要なバグ修正 (実プレイ報告「ゴールキックとかアホな動きしている」の直接原因)★
 * 旧実装はボールだけを再開位置へテレポートし、キッカーは「AIが自然にボールへ寄ってくる」
 * のを待っていた。しかし setPieceLock は touch-priority を再開チームに制限するうえ
 * 時間切れも無いため、再開チームの誰もボールの近くに居ない状況では
 * **ボールが再開位置に置かれたまま延々と誰も蹴りに来ない**停止状態が発生する
 * (トレースで再現: ゴールキック発生後19tick以上ボールが1pxも動かない)。
 * さらにゴールキックの場合、自動GKは「ゴールライン上でボールのxを追う」ステアリングしか
 * 持たないため、再開位置(深さ60px)まで前に出てくること自体が構造的に不可能だった。
 * 見た目には「守備側が誰も蹴らずウロウロする」= まさに報告どおりの挙動になる。
 *
 * ボール自体を既に瞬間移動させている設計 (試合を止めない方針) と一貫させ、キッカーも
 * 同じtickでボール脇へ配置する。ゴールキックはGK、スローイン/コーナーは最寄りの
 * フィールドプレイヤーが蹴る、という実際のサッカーの役割分担にも合う。
 */
function resolveSetPieceKicker(
  players: readonly PlayerState[],
  event: { readonly type: 'throwIn' | 'goalKick' | 'corner'; readonly restartTeam: TeamId; readonly pos: Vec2Fixed },
  half: Half,
): SetPieceKickerOverride | null {
  const attackUp = attackingIsUpward(event.restartTeam, half);
  const facing = attackUp ? Direction8.Up : Direction8.Down;
  // ゴールキックはGK、スローイン/コーナーは最寄りのフィールドプレイヤーが蹴る、という
  // 実際のサッカーの役割分担に合わせる (players[]のindex規約: team*11 が各チームのGK)。
  const index =
    event.type === 'goalKick'
      ? event.restartTeam * PLAYERS_PER_TEAM
      : findNearestTeamPlayerIndex(players, event.pos, event.restartTeam, true);
  if (index === null || !players[index]) return null;
  // キッカーをボールのすぐ後ろ (攻撃方向の逆側) へ置く。ボールが前、キッカーが後ろ、
  // 攻撃方向を向く = 実際のセットプレーの立ち位置であり、そのまま前へ蹴り出せる。
  // 距離はキックオフのキッカーと同じ 9px (ドリブル接触半径12pxの内側)。
  const standoff = attackUp ? (KICKOFF_KICKER_STANDOFF_FIXED as number) : -(KICKOFF_KICKER_STANDOFF_FIXED as number);
  const pos = clampToPitchBounds(
    { x: event.pos.x, y: ((event.pos.y as number) + standoff) as Fixed },
    PLAYER_RADIUS_FIXED,
  );
  return { index, facing, pos };
}

/**
 * 純関数: 現在の状態と1tick分の入力から次の状態を返す。
 * 既存オブジェクトを変更せず、常に新しいプレーンオブジェクトを返す。
 * Math.random() や Math.sin/cos/atan2 はここでは使用しない
 * (scripts/checkDeterminism.mjs で静的にチェックされる)。
 *
 * Phase 3 (マイルストーン1-2: 半分対応+試合時計) で追加した先頭の早期return:
 *   0a. フルタイム到達済みなら frame だけ進めて他は素通しする (試合終了、入力は実質無効)。
 *   0b. このtickで前半→後半の境界を跨ぐなら、全員をミラー配置のキックオフにリセットする。
 * それ以外は通常通り Phase 2 のパイプラインを進める (オフサイド・CPU攻撃AIは後続マイルストーンで
 * 追加、現時点ではまだ無い)。
 *   1. touch-priority を決定する。
 *   2. GK自動交代判定 (最優先、キック溜め中/タックル中はガード)。無ければ通常のカーソル解決。
 *   3. 各選手の実効入力 (操作選手=人間入力、非操作GK=専用ステアリング、その他=チームAI)。
 *   4. touch-priority選手のドリブルタッチ (この時点で lastTouchTeam を更新)。
 *   5. Bボタンの文脈分岐 (GKセーブ最優先 → カーソルパス/チャージキック → タックル)。
 *      マイルストーン5: カーソルパス発火/チャージキック解放の直前でオフサイド判定
 *      (state.offsideEnabled時のみ)。成立時はapplyKickを実行させず、間接FK相当の
 *      リスタート(該当選手の位置へ速度0でボールを置く)にする。
 *   5a. マイルストーン6: touch-priorityをTeam B(CPU)が保持している時だけ、cpuAttackAI.ts の
 *      判断(シュート/パス/ドリブル)を3で移動方向に、ここでシュート/パスの実行に使う
 *      (Team Aは必ず人間操作のため、この分岐は事実上Team B専用)。オフサイド判定はTeam Aの
 *      2箇所と同じロジックを適用する。シュート照準ノイズでRNGを消費した場合はrngStateに反映する。
 *   6. ボール物理 (マイルストーン3-4: クランプ前の仮位置で境界越えを検出する)。
 *      6a. 得点なら、その場でミラー配置のキックオフへリセットして早期returnする
 *          (後続の選手移動処理を古いボール位置のまま進めてしまわないため、計画セクションD)。
 *      6b. スローイン/ゴールキック/コーナーなら、ボールを復帰位置へ即座にテレポートし
 *          (速度・高さ0)、選手移動処理はそのまま続ける (計画セクションC、試合停止の演出は無し)。
 *   7. 全選手の移動。
 *
 * 既知の割り切り (仮定5): 得点判定はこの関数の中盤、前後半切替の早期return判定より「後」に
 * 行うため、半分境界とちょうど同じtickで得点が起きた場合は半分切替が優先され、その得点は
 * 記録されない (1/10800tickの極小確率、Phase 3ではこのまま許容する)。
 */
export function simulate(state: GameState, inputs: Inputs): GameState {
  if (isFulltime(state.frame)) {
    return { ...state, frame: state.frame + 1, prevButtons: inputs.buttons };
  }

  const half = getHalf(state.frame);
  const nextFrame = state.frame + 1;
  if (getHalf(nextFrame) !== half) {
    // 前半→後半の境界を跨ぐtick。全員をミラー配置のキックオフへリセットする。
    // 後半のキックオフは前半に蹴らなかったチーム = Team B (競技規則 第8条)。
    const kickoffTeam = TeamId.B;
    const reset = placeKickoffFormation(getHalf(nextFrame), state.teamFormations, kickoffTeam);
    return {
      frame: nextFrame,
      rngState: state.rngState,
      players: reset.players,
      ball: reset.ball,
      controlledPlayerIndex: state.controlledPlayerIndex,
      prevButtons: inputs.buttons,
      teamFormations: state.teamFormations,
      score: state.score,
      // キックオフはまだ誰も触れていない (競技規則: ボールは蹴られて動いたときインプレー)。
      // 相手を触れさせない拘束は lastTouchTeam ではなく setPieceLock.restartTeam が担う。
      lastTouchTeam: null,
      linePossessionTeam: null,
      linePossessionSwitchTicks: 0,
      lastTouchPlayerIndex: null,
      prevTouchPlayerIndex: null,
      difficulty: state.difficulty,
      offsideEnabled: state.offsideEnabled,
      cpuHandsOff: state.cpuHandsOff,
    drillMode: state.drillMode,
      pendingKick: null,
      restartGraceTeam: kickoffTeam,
      restartGraceTicksLeft: KICKOFF_GRACE_TICKS,
      lastEvent: null,
      setPieceLock: createKickoffLock(kickoffTeam, reset.ball.pos),
      manualLineOffset: ZERO_FIXED,
    };
  }

  // セットプレー再開ロック中は touch-priority も restartTeam に制限する (相手は絶対に
  // 触れられない、という保証を押し出しの幾何精度に頼らず構造的に成立させる)。
  // 練習モード (cpuHandsOff) では Team A に限定する = CPUはボールに触れない。
  const touchRestrictTeam = state.cpuHandsOff ? TeamId.A : state.setPieceLock?.restartTeam;
  const touchPriorityIndex = findTouchPriorityPlayer(
    state.players,
    state.ball.pos,
    state.lastTouchPlayerIndex,
    touchRestrictTeam,
  );
  const teamAInPossession = isTeamAInPossession(touchPriorityIndex);
  let lastTouchTeam = state.lastTouchTeam;

  // 保持者の履歴 (Phase 4、CPUの「直前に自分へ渡した選手へは返さない」判定に使う)。
  // ドリブル中の一時的な touch=null では変化せず、別の選手が touch を取った時だけ進む。
  let lastTouchPlayerIndex = state.lastTouchPlayerIndex;
  let prevTouchPlayerIndex = state.prevTouchPlayerIndex;
  if (touchPriorityIndex !== null && touchPriorityIndex !== lastTouchPlayerIndex) {
    prevTouchPlayerIndex = lastTouchPlayerIndex;
    lastTouchPlayerIndex = touchPriorityIndex;
  }

  /**
   * オフサイド判定を行うか。
   *
   * ★段階2の欠陥修正★ 操作確認モード(ドリルモード)では味方21人をゴールライン際へ退避させる。
   * その結果「味方全員が最終ラインより前」になり、**A/X/Y のパスがすべてオフサイド扱いになって
   * ボールが動かない**という状態になっていた (実機で発覚。押しても何も起きないので、
   * ボタンが壊れているようにしか見えない)。無菌室の趣旨からしてオフサイドは不要なので外す。
   */
  const offsideActive = state.offsideEnabled && !state.drillMode;

  const teamAGoalkeeper = state.players[TEAM_A_GK_INDEX];
  const currentControlled = state.players[state.controlledPlayerIndex];
  const currentLocked =
    (currentControlled?.kickChargeFrames ?? 0) > 0 ||
    (currentControlled?.tacklePhase ?? TacklePhase.None) !== TacklePhase.None;
  const gkTakeover =
    !currentLocked &&
    !!teamAGoalkeeper &&
    shouldTakeOverGoalkeeper(teamAGoalkeeper, state.ball.pos, inputs.buttons, teamAInPossession);

  const cursor = state.drillMode
    ? // ★操作確認モード★ カーソルは固定する。退避させた選手へ勝手に移ると、
      // ピッチ端に立たされた別人を操作することになり検証にならない (実機で発覚)。
      {
        controlledPlayerIndex: state.controlledPlayerIndex,
        passTriggered: inputs.buttons.Y && !state.prevButtons.Y,
        passTargetIndex: selectPassTarget(state.controlledPlayerIndex, state.players),
      }
    : gkTakeover
    ? { controlledPlayerIndex: TEAM_A_GK_INDEX, passTriggered: false, passTargetIndex: null }
    : resolveCursor(
        state.players,
        state.controlledPlayerIndex,
        touchPriorityIndex,
        state.ball.pos,
        inputs.buttons,
        state.prevButtons,
      );
  const controlledPlayerIndex = cursor.controlledPlayerIndex;
  const controlledPlayer = state.players[controlledPlayerIndex];

  // ワンツー (続編仕様⑤) の判定に使う「ボールを受けた瞬間」フラグ。touch-priorityが
  // このtickで新たに操作選手へ切り替わったかどうかを、再代入前のstate.lastTouchPlayerIndex
  // と比較して検出する(人間操作選手のみが対象。A/Yは人間入力の概念のため)。
  const justReceivedByControlled =
    touchPriorityIndex !== null &&
    touchPriorityIndex === controlledPlayerIndex &&
    touchPriorityIndex !== state.lastTouchPlayerIndex;

  // セーブ文脈は「速いボールが飛んできている」時のみ。遅い/静止ボールがGKの足元にある時は
  // 通常のキック文脈のままにする (速度条件なしだと、GKは確保したボールを永遠に蹴れず、
  // ドリブルで運ぶしかなくなる詰みがあった — 観戦シミュレーターで発覚した実プレイ直結の欠陥)。
  const ballSpeedSqForSave = dotFixed(state.ball.vel, state.ball.vel) as number;
  const inSaveRange =
    !!controlledPlayer &&
    controlledPlayer.isGoalkeeper &&
    isInSaveRange(controlledPlayer, state.ball.pos) &&
    ballSpeedSqForSave > (SAVE_CONTEXT_MIN_BALL_SPEED_SQ_FIXED as number) &&
    // 向きの条件も併用する: 自陣から遠ざかっていくボール (自分で前へ運んでいる球や、
    // 既に弾き返した球) がセーブ文脈に居座ると、人間GKがそのボールを蹴れなくなる。
    isBallApproachingOwnGoal(controlledPlayer, state.ball, half);

  // マイルストーン6: touch-priorityをTeam B(CPU)が保持している時だけ攻撃AIの判断を1回だけ計算する。
  // resolveCursorの設計上、Team Aの誰かがtouch-priorityを持てば操作対象は即座にそちらへ
  // スナップされるため (計画セクションFの前提)、Team Aがtouch-priorityを持ちながらAI操作の
  // ままになることは無い。よってこの分岐は事実上「Team Bがボールを持っている時のみ」発火する。
  const touchPlayerForCpu = touchPriorityIndex !== null ? state.players[touchPriorityIndex] : undefined;
  // 現在どちらのチームがボールを保持しているか (生の判定)。追跡権(プレス)は即応すべきなので
  // こちらを使う。
  // 重要 (観戦シミュレーターで発覚した「シュート直後にチーム全体が自陣へ一斉後退する」バグの修正):
  // touch-priorityの有無だけで判定すると、キック/シュートの瞬間にボールが足元を離れて
  // 誰の touch-priority でもなくなり (ボールが飛んでいる間ずっと)、その間 possessionTeam=null
  // = 「押し上げ無しの静的ホーム」へ全員が即座に戻ろうとしてしまう。ボールが飛行中は
  // 最後に触れたチーム (lastTouchTeam、前tickまでの値) の保持が続いているとみなす。
  const possessionTeam = touchPlayerForCpu ? touchPlayerForCpu.team : state.lastTouchTeam;

  // チームライン用の保持チームは時間ヒステリシス付き (linePossessionTeam)。瞬間的な保持の
  // 入れ替わり (GKパンチング等の数十tickの揺り戻し) ではラインを巻き戻さない。
  let linePossessionTeam = state.linePossessionTeam;
  let linePossessionSwitchTicks = state.linePossessionSwitchTicks;
  if (possessionTeam === null || possessionTeam === linePossessionTeam) {
    linePossessionSwitchTicks = 0;
  } else {
    linePossessionSwitchTicks++;
    if (linePossessionSwitchTicks >= LINE_POSSESSION_SWITCH_TICKS) {
      linePossessionTeam = possessionTeam;
      linePossessionSwitchTicks = 0;
    }
  }

  // ライン操作 (続編仕様④、STARTボタン)。人間(Team A)のみが対象。既にライン計算が
  // 使っている linePossessionTeam (ヒステリシス付き) を文脈判定にも流用し、自動ラインの
  // 動きと手動オフセットがちぐはぐにならないようにする。Team Aが保持中にSTARTを押し続けると
  // オフェンスラインを下げる(-方向)、非保持(守備)中に押し続けるとディフェンスラインを
  // 上げる(+方向)。押していない間はゆっくり中立(0)へ減衰する。
  let manualLineOffset = state.manualLineOffset;
  /**
   * ★段階2の欠陥修正★ 保持文脈を linePossessionTeam (90tickヒステリシス) だけで判定していたため、
   * 試合開始直後・競り合い中・保持が切り替わった直後の 1.5秒間は null のままで、STARTを
   * 押しても**何も起こらず何の表示も出ない**「効かないボタン」になっていた
   * (tests/sim/possessionOps.test.ts のプローブで発覚。30tick押しても manualLineOffset が 0 のまま)。
   * ラインの陣形計算にヒステリシスが要るのは「AIが一斉に行進しない」ためであって、
   * 人間の入力を受け付けるかどうかの判定には要らない。現在の接触 → 直近の接触 の順に
   * フォールバックして、押した時に必ず反応するようにする。
   */
  const possessionForLine: TeamId | null =
    linePossessionTeam ??
    (touchPriorityIndex !== null
      ? isTeamAInPossession(touchPriorityIndex)
        ? TeamId.A
        : TeamId.B
      : state.lastTouchTeam);
  const teamAAttacking = possessionForLine === TeamId.A;
  const teamADefending = possessionForLine === TeamId.B;
  if (inputs.buttons.Start && (teamAAttacking || teamADefending)) {
    const step = MANUAL_LINE_OFFSET_STEP_FIXED as number;
    const delta = (teamAAttacking ? -step : step) as Fixed;
    manualLineOffset = clampFixed(
      fixedAdd(manualLineOffset, delta),
      -(MANUAL_LINE_OFFSET_MAX_FIXED as number) as Fixed,
      MANUAL_LINE_OFFSET_MAX_FIXED,
    );
  } else {
    const decay = MANUAL_LINE_OFFSET_DECAY_FIXED as number;
    const current = manualLineOffset as number;
    if (current > 0) manualLineOffset = Math.max(0, current - decay) as Fixed;
    else if (current < 0) manualLineOffset = Math.min(0, current + decay) as Fixed;
  }

  // ドリルモードではCPUの攻撃判断も一切走らせない (「相手なし」の無菌室にするため)。
  const cpuDecision =
    !state.drillMode && touchPriorityIndex !== null && touchPlayerForCpu && !isTeamAInPossession(touchPriorityIndex)
      ? decideCpuAttack(touchPriorityIndex, state.players, half, state.difficulty, state.rngState, prevTouchPlayerIndex)
      : null;
  let rngState = cpuDecision ? cpuDecision.rngState : state.rngState;

  // リスタート猶予のカウントダウン (Phase 5、linePossessionSwitchTicksと同じ毎tick減衰の流儀)。
  // 猶予中は restartGraceTeam の相手チームの追跡権をゼロにする (下記 chaseRightIndices 参照)。
  let restartGraceTicksLeft = Math.max(0, state.restartGraceTicksLeft - 1);
  let restartGraceTeam = restartGraceTicksLeft > 0 ? state.restartGraceTeam : null;
  // 練習モードでは Team B の追跡権を丸ごと止める (陣形は保つが、ボールへは寄って来ない)。
  const suppressedTeam = state.cpuHandsOff
    ? TeamId.B
    : restartGraceTicksLeft > 0 && restartGraceTeam !== null
      ? opponentOf(restartGraceTeam)
      : null;

  // キック入力バッファの持ち越し (★17周目★)。毎tick 1 減らし、0になったら破棄する。
  // 消化 (射程に入って実際に蹴る) と登録 (射程外でBを離す) は下のキック処理で行う。
  let pendingKick: PendingKick | null =
    state.pendingKick && state.pendingKick.ticksLeft > 1
      ? { ...state.pendingKick, ticksLeft: state.pendingKick.ticksLeft - 1 }
      : null;

  // セットプレー再開ロックの持ち越し。経過tickを数え、上限を超えたら自動解除する
  // (人間側の再開でプレイヤーが操作しないと試合が永久停止するため。SET_PIECE_LOCK_MAX_TICKS
  //  のコメント参照 — 実際に1試合の74%がロック中という試合停止バグが観測されている)。
  let setPieceLock: SetPieceLock | null = state.setPieceLock
    ? { ...state.setPieceLock, elapsedTicks: state.setPieceLock.elapsedTicks + 1 }
    : null;
  if (setPieceLock && setPieceLock.elapsedTicks > SET_PIECE_LOCK_MAX_TICKS) {
    setPieceLock = null;
  }

  // 「団子サッカー」防止: 守備側は最寄り2人(プレス+カバー)、保持側は最寄り1人(受け手)だけが
  // ボール引力をフルに使う (バグ修正、実プレイ+観戦シミュレーターで発覚)。毎tick1回だけ計算する。
  // 第4引数 suppressedTeam: リスタート猶予中はこのチームの追跡権を丸ごとゼロにする。
  //
  // セットプレー再開ロック中の例外 (実プレイ相当のテストで発覚したデッドロックの修正):
  // lastTouchTeamをrestartTeamに設定しているため possessionTeam===restartTeam になり、
  // 素の判定だと「保持側」扱いでCHASE_RIGHT_HOLDERS_POSSESSING(1人)しか追跡権を持たない。
  // その1人がたまたま人間操作の選手(AI引力を一切使わず直接入力で動く)だと、restartTeam側の
  // 誰もボールへ自律的に寄って行かず、touch-priorityをrestartTeamへ制限したこととの組み合わせで
  // 「相手は触れられず、自チームも誰も取りに行かない」永久デッドロックになる。ロック中は
  // まだ誰も実際には触れていない(=真の意味でルーズボール)ため、possessionTeamをnull扱いにして
  // DEFENDING同様2人へ増やし、少なくとも1人は非操作AIが自律的に収束できるようにする。
  // gkHold は除外する: キーパーが確保している間は「本当にそのチームの保持」なので、
  // 相手の追跡権を2人に増やす上記の理屈 (=まだ誰も触っていないルーズボール扱い) は当てはまらない。
  const chasePossessionTeam =
    setPieceLock && setPieceLock.kind !== 'gkHold' && possessionTeam === setPieceLock.restartTeam
      ? null
      : possessionTeam;
  /**
   * ★17周目の重要な修正★ 再開ロック中は、どちらのチームにも追跡権を与えない。
   *
   * 理由: キッカーは必ずボール脇に配置されるようになった (restartTaken.test.ts) ので、
   * 「誰かがボールを取りに行かないと再開できない」という旧来の事情は無くなった。
   * にもかかわらず味方がボールへ群がろうとすると、ボール直近 (AI引力のデッドゾーン境界)
   * で「近づく力」と「ホームへ戻る力」が毎tick反転し、その場で永久に振動する。
   * idle試合で player2 がゴールキックのロック中に 2.9px 幅で無限に往復するのを実測した
   * (どのscriptSeedでも同一に再現する = シードの付け替えでは絶対に消せない本物のバグ)。
   * 実サッカーでも、リスタート時に味方がボールに群がることはない。
   */
  const chaseRightIndices = computeChaseRightIndices(state.players, state.ball.pos, chasePossessionTeam, suppressedTeam);

  // マーク割り当て (Phase 4): 守備側のDFライン(追跡権なし)に相手侵入者を1:1で割り当てる。
  // 追跡権(プレス、生のpossessionTeamで即応)と違い、マークは陣形挙動なのでライン押し引きと
  // 同じヒステリシス付き linePossessionTeam を使う (キック/パンチの瞬間の保持スイングで
  // 割り当てが毎回崩壊するのを防ぐ)。毎tick1回だけ計算する。
  const markAssignments = computeMarkAssignments(
    state.players,
    linePossessionTeam,
    half,
    state.teamFormations,
    state.ball.pos,
  );

  const effectiveInputs: Inputs[] = state.players.map((player, index) => {
    /**
     * ★18周目の検証記録 (あえて実装しなかったこと)★
     * 「無入力の間は操作選手もチームAIで動かす (オートパイロット)」を試したが、
     *   - 無操作試合のスコア改善は 0-44 → 0-39 とほぼ無し (=守備崩壊の主因ではなかった)
     *   - 逆に「スティックを離すと自分の選手が勝手に走り出す」操作感の劣化を招く
     * ため撤回した。無操作試合の大量失点の真因は別にある (docs/original-gap-list.md の
     * 保留項目を参照)。
     */
    if (index === controlledPlayerIndex) return inputs;
    // CPU判断はGK自動ステアリングより優先する (順序バグの修正、観戦シミュレーターで発覚):
    // CPU側のGKがボールを確保して touch-priority 保持者になった場合、GK枝が先だと
    // 「CPUはドリブルで運び出そうと判断しているのに、実際の入力はGKの左右追従(その場でNone)」
    // となり、GKがボールを抱えたまま永久に固まるデッドロックがあった。
    if (cpuDecision && index === touchPriorityIndex) {
      return { direction: cpuDecision.direction, buttons: NO_BUTTONS };
    }
    if (player.isGoalkeeper) {
      const gkHome = getHomePosition(player.team, 0, state.teamFormations[player.team], half);
      return { direction: computeGoalkeeperAutoDirection(player, state.ball.pos, gkHome.y), buttons: NO_BUTTONS };
    }
    const direction = computeNonControlledDirection(
      player,
      state.players,
      state.ball.pos,
      state.teamFormations,
      half,
      linePossessionTeam,
      chaseRightIndices.get(index) ?? null,
      markAssignments.get(index) ?? null,
      manualLineOffset,
    );
    return { direction, buttons: NO_BUTTONS };
  });

  let ball = state.ball;

  // カーブ (続編仕様③): 直前のtickまでに人間の直接キックが開いた入力受付ウィンドウ
  // (state.ball.curveWindowTicksLeft、前tickからの持ち越し値)が残っている間に、
  // このtickで方向入力があればカーブを発生させる。「キックボタンを押した瞬間に+字」を
  // 単一方向入力アーキテクチャ上「キック発動直後の短いウィンドウ」で近似したもの
  // (詳細はballConstants.tsのコメント参照)。新しいキックがこのtick中に発生した場合は
  // 後段の直接キック処理が上書きする(下記参照)ので、ここで消費しても問題ない。
  if ((state.ball.curveWindowTicksLeft ?? 0) > 0 && inputs.direction !== Direction8.None) {
    ball = { ...ball, curveDirection: inputs.direction, curveTicksLeft: CURVE_DURATION_TICKS, curveWindowTicksLeft: 0 };
  }

  let nextControlledKickChargeFrames = controlledPlayer?.kickChargeFrames ?? 0;
  let tackleAdvance: TackleAdvance = NO_TACKLE;
  // 直近の知覚可能イベント (Phase 5)。物理/AIには影響しない echo (state.ts参照)。
  let lastEvent = state.lastEvent;
  // セットプレー再開時、キッカーを攻撃方向へ向かせる (実装ギャップ1、最優先)。
  // boundaryEvent発生時にのみ設定し、players.map内で該当選手のfacingを上書きする。
  let restartKickerOverride: SetPieceKickerOverride | null = null;
  // 蹴り出しドリブル(続編仕様①②)。保持者(touch-priority)のみが対象で、他の選手は
  // players.map内で強制的にfalseへリセットする(過去に保持していた時の値が残らないように)。
  let kickDribbleCarrier: { index: number; active: boolean } | null = null;

  // ================================================================================
  // 非操作GKの自動セーブ。**ドリブルタッチより先に**評価するのが必須。
  //
  // ★重要なバグ修正 (実プレイ報告「キーパーはキャッチしない」の直接原因)★
  // 旧実装はこのブロックがドリブルタッチとキック処理の「後」にあった。飛んできたシュートは
  // GKに近づいた瞬間にまずGKへtouch-priorityが渡り、CPU攻撃AIの判断でGKが
  // **そのボールを「ドリブル」してしまい**、セーブ判定に到達する前にボールを弾き返して
  // いた (トレースで t36→t37 に再現: 距離7.5pxまで来たボールをGKが触って逆方向へ転がした)。
  // 見た目には「キーパーが軽く触るだけでキャッチしない」になる。
  // セーブは常にドリブルより優先されるべきなので、順序ごと前へ移した。
  //
  // 反応条件は「速いか」ではなく「自陣ゴールへ向かってきているか」(isBallApproachingOwnGoal)。
  // 加えて「直前にこのGK自身が最後に触ったボールではない」ことを要求する。これにより
  // 確保後/前へ運び出し中の自分のボールを毎tickキャッチし直して固まる既知のデッドロックを
  // 構造的に防ぎつつ、減速して到達したシュートにもきちんと反応できる。
  // players[] 昇順 (A GK=0 → B GK=11) で処理する決定論的順序。
  // ================================================================================
  let tackleWonBall = false;
  let gkSavedThisTick = false;
  for (const gkIndex of [TeamId.A * PLAYERS_PER_TEAM, TeamId.B * PLAYERS_PER_TEAM]) {
    if (gkIndex === controlledPlayerIndex) continue; // 人間操作中のGKは手動セーブ(下記)のみ
    if (state.lastTouchPlayerIndex === gkIndex) continue; // 自分が最後に触った=自分のボール
    const gk = state.players[gkIndex];
    if (!gk || !gk.isGoalkeeper) continue;
    if (!isInSaveRange(gk, ball.pos)) continue;
    if (!isBallApproachingOwnGoal(gk, ball, half)) continue;
    const ballSpeedSq = dotFixed(ball.vel, ball.vel) as number;
    const catchable = ballSpeedSq <= (fixedMul(CATCH_MAX_SPEED_FIXED, CATCH_MAX_SPEED_FIXED) as number);
    const outcome = resolveSaveOutcome(gk, ball, catchable ? 'catch' : 'punch');
    if (outcome !== 'missed') {
      ball = applySave(ball, gk, outcome, half);
      lastTouchTeam = gk.team;
      gkSavedThisTick = true;
      // secured (真のキャッチ) のみ知覚可能イベントとして記録する。これにより
      // CPU/非操作GKのキャッチも人間の目に見えるようになる (視認性向上、実プレイ報告への対応)。
      if (outcome === 'secured') {
        lastEvent = { kind: 'gkCatch', team: gk.team, atFrame: nextFrame };
        setPieceLock = createGoalkeeperHoldLock(gk.team, ball.pos);
      }
    }
  }

  // ワンツー (続編仕様⑤): 「ボールを受ける瞬間にA/Yを押していると、受けた選手がそのまま
  // すぐパスを出す」。ドリブルタッチ/通常のカーソルパス/チャージキックより先に判定し、
  // 発火したら以降のボール処理(このtickぶん)をスキップする。セーブ文脈(inSaveRange)とは
  // 排他 — 速いボールが飛んできている時は常にセーブ判定を優先する。
  let oneTwoFired = false;
  if (justReceivedByControlled && !inSaveRange && controlledPlayer) {
    const offside = offsideActive
      ? checkOffside(controlledPlayerIndex, controlledPlayer.team, state.players, half)
      : { offside: false, offsidePlayerIndex: null };
    const offsidePlayer =
      offside.offside && offside.offsidePlayerIndex !== null ? state.players[offside.offsidePlayerIndex] : undefined;

    if (inputs.buttons.Y) {
      // Y = パスカーソル先の選手へ。受け手が見つからなければワンツーは発火せず、
      // このtickは通常のドリブルタッチ等へフォールスルーする。
      const targetIndex = selectPassTarget(controlledPlayerIndex, state.players);
      const receiver = targetIndex !== null ? state.players[targetIndex] : undefined;
      if (receiver) {
        if (offsidePlayer) {
          ball = offsideRestartBall(offsidePlayer);
          lastTouchTeam = opponentOf(controlledPlayer.team);
        } else {
          const passDirection = quantizeToDirection8(vSub(receiver.pos, controlledPlayer.pos), ZERO_FIXED);
          ball = applyKick(ball, controlledPlayer, KICK_MIN_CHARGE_FRAMES, passDirection);
          lastTouchTeam = controlledPlayer.team;
        }
        oneTwoFired = true;
      }
    } else if (inputs.buttons.A) {
      // A = +字入力方向へ (方向が無ければ既存のapplyKickのフォールバックでfacing方向)。
      if (offsidePlayer) {
        ball = offsideRestartBall(offsidePlayer);
        lastTouchTeam = opponentOf(controlledPlayer.team);
      } else {
        ball = applyKick(ball, controlledPlayer, KICK_MIN_CHARGE_FRAMES, inputs.direction);
        lastTouchTeam = controlledPlayer.team;
      }
      oneTwoFired = true;
    }
  }

  const touchInputs = touchPriorityIndex !== null ? effectiveInputs[touchPriorityIndex] : undefined;
  // gkSavedThisTick / inSaveRange のときはドリブルタッチを行わない。セーブしたボールを
  // 同じtickで「ドリブル」して弾き飛ばしてしまうと、キャッチが成立しないため
  // (上記の自動セーブブロックのコメント参照。人間GKも同じ理由で除外する)。
  if (!oneTwoFired && !gkSavedThisTick && !inSaveRange && touchInputs && touchPriorityIndex !== null) {
    const touchPlayer = state.players[touchPriorityIndex];
    const prevKickDribbleActive = touchPlayer?.kickDribbleActive ?? false;
    const kickDribbleActive = computeKickDribbleState(prevKickDribbleActive, true, touchInputs.buttons);
    kickDribbleCarrier = { index: touchPriorityIndex, active: kickDribbleActive };
    // ★重要★ 蹴り出しは「プレー可能な間合い(20px)」ではなく「接触距離(12px)」でのみ行う。
    // ここに true (=常に接触) を渡していたのが、ボールが永久に逃げ続けて
    // 「走りながらキックできない」実プレイ不具合の直接原因だった (ballConstants.ts参照)。
    const inContact = !!touchPlayer && isInDribbleContact(touchPlayer.pos, ball.pos);
    // 第6引数に選手位置を渡すと「足元の少し前へ引き寄せる」追従モデルになる
    // (18周目、ユーザー指示「ドリブル中は足から離れないようにして。LR同時押以外」)。
    ball = applyDribbleTouch(
      ball,
      true,
      inContact,
      touchInputs.direction,
      kickDribbleActive,
      touchPlayer?.pos,
    );
    // 接触距離の内外に関わらず、プレー可能な間合いで実際にボールを動かしたなら「触れた」。
    // inContact だけで判定すると、12〜20px で押している選手が lastTouchTeam に反映されず、
    // 支配率・スローイン相手判定・ライン押し引きがすべてズレる。
    if (touchPlayer) lastTouchTeam = touchPlayer.team;
  }

  if (oneTwoFired) {
    // ワンツーが発火済みなので、この後のセーブ/カーソルパス/チャージキック分岐は
    // 一切通さない (二重処理防止)。tackleAdvance/nextControlledKickChargeFramesは
    // 初期値(NO_TACKLE/現状維持)のまま players.map へ渡る。
  } else if (inSaveRange && controlledPlayer) {
    // セーブ文脈: Y=キャッチ/B=パンチングのみを処理する (カーソルパス/キック溜め/タックルは行わない)。
    const yEdge = inputs.buttons.Y && !state.prevButtons.Y;
    const bEdge = inputs.buttons.B && !state.prevButtons.B;
    if (yEdge) {
      const outcome = resolveSaveOutcome(controlledPlayer, ball, 'catch');
      ball = applySave(ball, controlledPlayer, outcome, half);
      if (outcome !== 'missed') lastTouchTeam = controlledPlayer.team;
      // secured (真のキャッチ) のみ知覚可能イベントとして記録する (視認性向上、実プレイ報告への対応)。
      if (outcome === 'secured') {
        lastEvent = { kind: 'gkCatch', team: controlledPlayer.team, atFrame: nextFrame };
        setPieceLock = createGoalkeeperHoldLock(controlledPlayer.team, ball.pos);
      }
    } else if (bEdge) {
      const outcome = resolveSaveOutcome(controlledPlayer, ball, 'punch');
      ball = applySave(ball, controlledPlayer, outcome, half);
      if (outcome !== 'missed') lastTouchTeam = controlledPlayer.team;
    }
  } else {
    if (cursor.passTriggered && cursor.passTargetIndex !== null && controlledPlayer) {
      const receiver = state.players[cursor.passTargetIndex];
      if (receiver) {
        const offside = offsideActive
          ? checkOffside(controlledPlayerIndex, controlledPlayer.team, state.players, half)
          : { offside: false, offsidePlayerIndex: null };
        const offsidePlayer =
          offside.offside && offside.offsidePlayerIndex !== null ? state.players[offside.offsidePlayerIndex] : undefined;
        if (offsidePlayer) {
          // オフサイド成立: パスを実行させず、間接FK相当のリスタートにする。
          ball = offsideRestartBall(offsidePlayer);
          lastTouchTeam = opponentOf(controlledPlayer.team);
        } else {
          // 確定パス: 溜め不要・低い弾道の速いグラウンダー。方向だけ受け手に向けて上書きする
          // (既存applyKickの速度軸/弾道軸をそのまま再利用、新しい物理モデルは作らない)。
          const passDirection = quantizeToDirection8(vSub(receiver.pos, controlledPlayer.pos), ZERO_FIXED);
          ball = applyKick(ball, controlledPlayer, KICK_MIN_CHARGE_FRAMES, passDirection);
        }
      }
    }

    if (controlledPlayer) {
      const isCarryingBall = touchPriorityIndex === controlledPlayerIndex;
      /**
       * ★17周目: キックの射程★ 旧実装は「touch-priorityを保持しているtickだけ」蹴れたため、
       * ボールが足元から少し離れただけでBが完全に無反応になっていた (実戦相当の計測で
       * ドリブル中の22%のtickがキック不能)。KICK_REACH まで広げる。
       * 相手が保持しているボールは対象外 (それはタックル/チャージの領分)。
       */
      const holder = touchPriorityIndex !== null ? state.players[touchPriorityIndex] : null;
      const kickReachSq = fixedMul(KICK_REACH_FIXED, KICK_REACH_FIXED) as number;
      const kickable =
        (distSqFixed(controlledPlayer.pos, ball.pos) as number) <= kickReachSq &&
        !(holder && holder.team !== controlledPlayer.team) &&
        !(setPieceLock && setPieceLock.restartTeam !== controlledPlayer.team);

      if (kickable) {
        // リフティング (続編仕様⑥): 「急な方向転換(ターンアクション)中にキックボタンを
        // 押すと、保持を継続したまま頭上へ軽く浮かせる」。CLAUDE.mdの実装方針どおり、
        // 専用のターンアクション停止状態は実装せず(選手の移動自体は通常どおり進む)、
        // 「直前の向き(facing)と今回の入力方向がほぼ正反対」を検出条件として使う。
        // Bのedge(フレッシュな押下)を要求することで、既にB長押し中(通常のチャージキック
        // 進行中)の途中で反転しても誤発火しない。
        // リフティングは「足元に置いている」状態の技なので、キック射程の拡張とは切り離し、
        // 従来どおり touch-priority 保持中のみに限定する。
        const isReversal = isOppositeDirection8(inputs.direction, controlledPlayer.facing);
        const bEdge = inputs.buttons.B && !state.prevButtons.B;
        const liftEligible =
          isCarryingBall && isReversal && bEdge && (ball.height as number) <= (DRIBBLE_TOUCH_MAX_HEIGHT_FIXED as number);

        if (liftEligible) {
          // 水平速度は「新しい入力方向へ通常のドリブルタッチと同じ速さ」にしておく
          // (浮いている間も選手についてくるように近似。着地後は通常のドリブルタッチへ
          // 自然に戻る、DRIBBLE_TOUCH_MAX_HEIGHT_FIXED以下になった時点でapplyDribbleTouch
          // が再び作用するため)。
          const liftVel = vScaleFixed(DIRECTION_VECTORS[inputs.direction], DRIBBLE_TOUCH_SPEED_FIXED);
          ball = { ...ball, vel: liftVel, zVel: LIFT_Z_VEL_FIXED };
          lastTouchTeam = controlledPlayer.team;
        } else if (
          // ★A = 進行方向へのパス (キープ時) / ボールへのスライディング (ルーズボール時)★
          // ★X = ロングフィード・センタリング / ロビングのパス★
          // CLAUDE.md 続編仕様のボタン表。17周目まで A はどこにも繋がっておらず、X も
          // キック文脈では未実装だった (ユーザー報告「Aボタン(〇ボタン)反応しない」)。
          (inputs.buttons.A && !state.prevButtons.A) ||
          (inputs.buttons.X && !state.prevButtons.X)
        ) {
          const isA = inputs.buttons.A && !state.prevButtons.A;
          if (isA && !isCarryingBall) {
            // ルーズボール + A = ボールへ飛び込むスライディング。
            const slideDirection = inputs.direction !== Direction8.None ? inputs.direction : controlledPlayer.facing;
            tackleAdvance = advanceTacklePhase(controlledPlayer, true, slideDirection);
          } else {
            const offside = offsideActive
              ? checkOffside(controlledPlayerIndex, controlledPlayer.team, state.players, half)
              : { offside: false, offsidePlayerIndex: null };
            const offsidePlayer =
              offside.offside && offside.offsidePlayerIndex !== null
                ? state.players[offside.offsidePlayerIndex]
                : undefined;
            if (offsidePlayer) {
              ball = offsideRestartBall(offsidePlayer);
              lastTouchTeam = opponentOf(controlledPlayer.team);
            } else {
              // A = 溜め無しの速いグラウンダー / X = 溜め済み相当の高い弾道 (ロングフィード)。
              const chargeFrames = isA ? KICK_MIN_CHARGE_FRAMES : LONG_FEED_CHARGE_FRAMES;
              ball = applyKick(ball, controlledPlayer, chargeFrames, inputs.direction, inputs.buttons);
              lastTouchTeam = controlledPlayer.team;
            }
          }
        } else {
          // 既存のチャージキック (タックル状態は自然にNoneへ収束させる)。
          const charge = updateKickCharge(controlledPlayer.kickChargeFrames, inputs.buttons.B);
          nextControlledKickChargeFrames = charge.nextFrames;

          // ★入力バッファの消化★ 射程外で押されたBを覚えてあり、いま射程に入ったので蹴る
          // (「押したのに無反応」の解消)。Bを離した後の予約なので、押しっぱなしの
          // チャージ進行とは競合しない。
          const buffered = pendingKick && !inputs.buttons.B ? pendingKick : null;
          if (buffered) {
            pendingKick = null;
            ball = applyKick(ball, controlledPlayer, KICK_MIN_CHARGE_FRAMES, buffered.direction, {
              L: buffered.shiftL,
              R: buffered.shiftR,
            });
            ball = {
              ...ball,
              curveDirection: Direction8.None,
              curveTicksLeft: 0,
              curveWindowTicksLeft: CURVE_INPUT_WINDOW_TICKS,
            };
            lastTouchTeam = controlledPlayer.team;
          } else if (charge.releasedFrames > 0) {
            const offside = offsideActive
              ? checkOffside(controlledPlayerIndex, controlledPlayer.team, state.players, half)
              : { offside: false, offsidePlayerIndex: null };
            const offsidePlayer =
              offside.offside && offside.offsidePlayerIndex !== null ? state.players[offside.offsidePlayerIndex] : undefined;
            if (offsidePlayer) {
              ball = offsideRestartBall(offsidePlayer);
              lastTouchTeam = opponentOf(controlledPlayer.team);
            } else {
              ball = applyKick(ball, controlledPlayer, charge.releasedFrames, inputs.direction, inputs.buttons);
              // カーブ(続編仕様③)の入力受付ウィンドウを新たに開く。このキック自体には
              // カーブは掛からない(このtickの方向入力は既にショットの照準に使われているため)。
              // 直前に別のカーブが効いていた場合はこの新しいキックで上書きする。
              ball = {
                ...ball,
                curveDirection: Direction8.None,
                curveTicksLeft: 0,
                curveWindowTicksLeft: CURVE_INPUT_WINDOW_TICKS,
              };
            }
          }
        }
        tackleAdvance = advanceTacklePhase(controlledPlayer, false, Direction8.None);
      } else {
        // 非保持: キック溜め中にボールを失った(奪われた/転がって離れた)場合、溜めを即座に
        // 破棄する。破棄しないとkickChargeFramesが非ゼロのまま永久に固定され、
        // resolveCursor/gkTakeoverの「操作選手がキック溜め中は切替禁止」ガードが
        // 恒久的にtrueになり、ボールを持っていない選手にカーソルが永遠に固定されて
        // 二度と切り替わらなくなる不具合があった (実プレイで発覚)。
        nextControlledKickChargeFrames = 0;

        // ★入力バッファの登録★ 射程外でBを離した = 「蹴りたかったが届かなかった」。
        // 短時間だけ意図を覚えておき、射程に入った瞬間に蹴る (上記の消化側を参照)。
        // 相手が保持している時は登録しない (それはタックルの入力であってキックではない)。
        const bRelease = !inputs.buttons.B && state.prevButtons.B;
        if (bRelease && !(holder && holder.team !== controlledPlayer.team)) {
          pendingKick = {
            ticksLeft: KICK_INPUT_BUFFER_TICKS,
            direction: inputs.direction,
            shiftL: inputs.buttons.L,
            shiftR: inputs.buttons.R,
          };
        }

        // ロック中 (キーパーの保持・セットプレー再開待ち) は相手チームからのボールへの
        // チャレンジを一切通さない。touch-priority制限だけでは、タックル/チャージが
        // ボール速度を直接書き換える経路を通ってすり抜けてしまう
        // (キーパーの手中のボールを次のtickで奪えるバグとして実測、競技規則 第12条)。
        const challengeBlockedByLock =
          setPieceLock !== null && controlledPlayer.team !== setPieceLock.restartTeam;

        /**
         * ★スライディング = Y または A★ (CLAUDE.md 続編仕様のボタン表)
         *
         * 17周目の修正: 旧実装は B に割り当てており、しかも A はどこにも繋がっていなかった。
         * ユーザー報告「スライディングしないしAボタン(〇ボタン)反応しない」の直接原因。
         *
         * あわせて発動条件から「相手保持者への背後コーン判定」を外した。旧実装は
         * checkTackleEligibility を発動条件にしていたため、条件を満たさない限り
         * **押しても一切何も起きない**(足を出す動作すら出ない)。原作はいつでも滑れる。
         * 奪えるかどうかは従来どおり checkTackleSuccess (背後+間合い) が決めるので、
         * 「読み勝ちで奪える」設計は変わらない。空振りのリスク(Recovery 20frame)と
         * ファウルのリスクが、乱発への抑止として働く。
         */
        const slideEdge =
          (inputs.buttons.Y && !state.prevButtons.Y) || (inputs.buttons.A && !state.prevButtons.A);
        const wantsTackle =
          slideEdge && !challengeBlockedByLock && controlledPlayer.tacklePhase === TacklePhase.None;
        const slideDirection = inputs.direction !== Direction8.None ? inputs.direction : controlledPlayer.facing;
        tackleAdvance = advanceTacklePhase(controlledPlayer, wantsTackle, slideDirection);

        if (tackleAdvance.tacklePhase === TacklePhase.Active && !challengeBlockedByLock) {
          if (checkTackleSuccess(controlledPlayer, state.players, touchPriorityIndex)) {
            ball = applyTackleWin(ball, tackleAdvance.tackleDirection);
            lastTouchTeam = controlledPlayer.team;
            tackleWonBall = true;
            // 成功した瞬間にRecoveryへ短絡する (Activeの残り時間を待たない)。
            tackleAdvance = {
              tacklePhase: TacklePhase.Recovery,
              tackleFrames: TACKLE_RECOVERY_FRAMES,
              tackleDirection: tackleAdvance.tackleDirection,
            };
          }
        }

        // ★ショルダーチャージ = B または X★ (CLAUDE.md 続編仕様のボタン表)。
        // 17周目の修正: 旧実装は Y または X で、表 (B/X) と食い違っていた。
        // スライディングと違い溜めが無く、押した瞬間に判定して即座に短い隙へ入る。
        // タックル進行中(None以外)は発動しない = 両者を同時に出すことはできない。
        const chargeEdge =
          (inputs.buttons.B && !state.prevButtons.B) || (inputs.buttons.X && !state.prevButtons.X);
        if (
          chargeEdge &&
          !challengeBlockedByLock &&
          tackleAdvance.tacklePhase === TacklePhase.None &&
          checkShoulderChargeEligibility(controlledPlayer, state.players, touchPriorityIndex)
        ) {
          const chargeDirection =
            inputs.direction !== Direction8.None ? inputs.direction : controlledPlayer.facing;
          ball = applyShoulderCharge(ball, chargeDirection);
          lastTouchTeam = controlledPlayer.team;
          tackleAdvance = {
            tacklePhase: TacklePhase.Recovery,
            tackleFrames: CHARGE_RECOVERY_FRAMES,
            tackleDirection: chargeDirection,
          };
        }
      }
    }
  }

  if (
    !gkSavedThisTick &&
    cpuDecision &&
    touchPriorityIndex !== null &&
    (cpuDecision.action === 'shoot' || cpuDecision.action === 'pass')
  ) {
    // CPU(Team B)のシュート/パス実行。オフサイド判定はTeam Aの2箇所(カーソルパス/チャージキック)と
    // 同じ扱いにする (計画セクションF、offsideフックをCPUのキックにも適用)。溜め無し・
    // 即座グラウンダー固定 (計画の仮定8、弾道バリエーションはPhase 4に先送り)。
    const carrier = state.players[touchPriorityIndex];
    if (carrier) {
      const offside = offsideActive
        ? checkOffside(touchPriorityIndex, carrier.team, state.players, half)
        : { offside: false, offsidePlayerIndex: null };
      const offsidePlayer =
        offside.offside && offside.offsidePlayerIndex !== null ? state.players[offside.offsidePlayerIndex] : undefined;
      if (offsidePlayer) {
        ball = offsideRestartBall(offsidePlayer);
        lastTouchTeam = opponentOf(carrier.team);
      } else {
        ball = applyKick(ball, carrier, KICK_MIN_CHARGE_FRAMES, cpuDecision.direction);
      }
    }
  }

  // ★ファウル判定 (競技規則 第12条、sim/foul.ts)★
  // 「ボールに行っていないスライディングが相手に当たった」ときだけファウルにする。
  // 現状スライディングの状態機械を持つのは人間の操作選手のみ (CPUはショルダーチャージのみ)
  // なので、実質的に人間側の反則判定になる。CPU側のファウルは選手個性/カード実装時に拡張する。
  let foulEvent: FoulEvent | null = null;
  if (controlledPlayer && tackleAdvance.tacklePhase === TacklePhase.Active) {
    // 位置は「このtickでスライドした後」で判定する必要がある (Active中は毎tick6px滑るため、
    // tick開始時の位置だと接触を1tick取りこぼす)。
    const slid = getTackleMovementOverride(tackleAdvance.tacklePhase, tackleAdvance.tackleDirection);
    const slidPlayer = updatePlayer(
      controlledPlayer,
      slid.direction ?? Direction8.None,
      false,
      slid.speed ?? undefined,
    );
    foulEvent = detectFoul(controlledPlayerIndex, slidPlayer, state.players, tackleWonBall, half);
  }

  // CPU守備チャレンジ (cpuDefenseAI.ts)。相手保持者に密着したCPU守備者が確率でショルダー
  // チャージを仕掛ける。これが無いと、人間が静止しているだけでCPUは至近距離で永久に何も
  // せず試合が停止する (観戦シミュレーターで実測、cpuDefenseAI.ts のコメント参照)。
  // セットプレー再開ロック中は発火させない (「蹴られるまで相手は触れない」を守る)。
  // GKのセーブが起きたtickも二重にボール速度を上書きしないよう見送る。
  if (!gkSavedThisTick && !setPieceLock && !state.cpuHandsOff && !state.drillMode) {
    const defense = decideCpuDefense(
      touchPriorityIndex,
      controlledPlayerIndex,
      state.players,
      state.difficulty,
      rngState,
    );
    rngState = defense.rngState;
    if (defense.chargerIndex !== null) {
      const charger = state.players[defense.chargerIndex];
      if (charger) {
        ball = applyShoulderCharge(ball, defense.direction);
        lastTouchTeam = charger.team;
        lastTouchPlayerIndex = defense.chargerIndex;
      }
    }
  }

  /**
   * ★ファウル成立時の再開 (競技規則 第13条 FK / 第14条 PK)★
   * ボール物理より前に確定させ、このtickはボールを動かさず「笛が鳴って止まった」状態にする。
   * 配置はセットプレー共通の方針 (ボールもキッカーも即座に置く) に合わせる。
   */
  let foulPlacement: { players: PlayerState[]; kickerIndex: number } | null = null;
  if (foulEvent) {
    const isPenalty = foulEvent.isPenalty;
    if (isPenalty) {
      const pk = placePenaltyKick(state.players, foulEvent.restartTeam, half);
      foulPlacement = pk.placement;
      ball = { pos: pk.ballPos, vel: vZero(), height: ZERO_FIXED, zVel: ZERO_FIXED };
    } else {
      foulPlacement = placeFreeKick(state.players, foulEvent.pos, foulEvent.restartTeam, half);
      ball = { pos: foulEvent.pos, vel: vZero(), height: ZERO_FIXED, zVel: ZERO_FIXED };
    }
    setPieceLock = {
      kind: isPenalty ? 'penalty' : 'freeKick',
      restartTeam: foulEvent.restartTeam,
      pos: ball.pos,
      northEnd: (ball.pos.y as number) < (toFixed(PITCH_HEIGHT / 2) as number),
      elapsedTicks: 0,
    };
    // 反則した側はその場で規定距離まで下がる (第13条「9.15m」)。以後のtickは通常の
    // applySetPieceExclusion が毎tick押し戻すが、笛が鳴ったtickにも適用しておかないと
    // 「壁が近すぎるまま蹴れる」1tickが生まれる。
    const lockForPush = setPieceLock;
    foulPlacement = {
      ...foulPlacement,
      players: foulPlacement.players.map((p) =>
        p.team === lockForPush.restartTeam || p.isGoalkeeper ? p : applySetPieceExclusion(p, lockForPush),
      ),
    };
    lastTouchTeam = foulEvent.restartTeam;
    restartGraceTeam = foulEvent.restartTeam;
    restartGraceTicksLeft = RESTART_GRACE_TICKS;
    lastEvent = { kind: isPenalty ? 'penalty' : 'foul', team: foulEvent.restartTeam, atFrame: nextFrame };
    // 反則した選手のタックルは即座に終了させる (滑り続けたまま再開しない)。
    tackleAdvance = NO_TACKLE;
  }

  const ballStep = stepBallPhysicsDetailed(ball);
  const boundaryEvent = detectBoundaryEvent(ballStep.tentativePos, ballStep.ball.height, half, lastTouchTeam);

  if (boundaryEvent?.type === 'goal') {
    // 得点: 選手移動処理まで進めず、その場でミラー配置のキックオフへリセットして完結させる
    // (計画セクションD。古いボール位置ベースのAI目標が1tickだけ混ざるのを防ぐ)。
    // 競技規則 第8条: 得点されたチームがキックオフを行う。
    const kickoffTeam = opponentOf(boundaryEvent.scoringTeam);
    const reset = placeKickoffFormation(half, state.teamFormations, kickoffTeam);
    const kickerIndex = kickoffTeam * PLAYERS_PER_TEAM + KICKOFF_TAKER_SLOT_INDEX;
    const score: readonly [number, number] =
      boundaryEvent.scoringTeam === TeamId.A
        ? [state.score[0] + 1, state.score[1]]
        : [state.score[0], state.score[1] + 1];
    return {
      frame: nextFrame,
      rngState,
      players: reset.players,
      ball: reset.ball,
      // カーソルをキッカーへ乗せる (Team Aのキックオフなら人間がそのまま蹴れる)。
      // Team Bのキックオフでは resolveCursor が守備側の自動追従へ戻す。
      controlledPlayerIndex: kickoffTeam === TeamId.A ? kickerIndex : state.controlledPlayerIndex,
      prevButtons: inputs.buttons,
      teamFormations: state.teamFormations,
      score,
      // キックオフはまだ誰も触れていない (競技規則: ボールは蹴られて動いたときインプレー)。
      // 相手を触れさせない拘束は lastTouchTeam ではなく setPieceLock.restartTeam が担う。
      lastTouchTeam: null,
      linePossessionTeam: null,
      linePossessionSwitchTicks: 0,
      lastTouchPlayerIndex: null,
      prevTouchPlayerIndex: null,
      difficulty: state.difficulty,
      offsideEnabled: state.offsideEnabled,
      cpuHandsOff: state.cpuHandsOff,
    drillMode: state.drillMode,
      pendingKick: null,
      restartGraceTeam: kickoffTeam,
      restartGraceTicksLeft: KICKOFF_GRACE_TICKS,
      lastEvent: null,
      setPieceLock: createKickoffLock(kickoffTeam, reset.ball.pos),
      manualLineOffset: ZERO_FIXED,
    };
  }

  if (boundaryEvent) {
    // スローイン/ゴールキック/コーナー: 即座にテレポートするのみ (試合停止の演出は無し)。
    // 選手移動処理はこのまま続ける (Team Aはカーソルスナップ、Team Bはボール引力AIが
    // 自然にリスタート位置へ収束する、計画セクションC)。
    ball = { pos: boundaryEvent.pos, vel: vZero(), height: ZERO_FIXED, zVel: ZERO_FIXED };
    // リスタートのボールは再開するチームのものとして扱う (観戦シミュレーターで発覚した
    // リスタート・キャンプ問題の修正の一部: lastTouchTeam=nullだと「競り合い」扱いになり
    // 両チームの追跡権保持者が同数でスポットに殺到する。再開チームに帰属させることで、
    // 相手側は守備側の追跡権(2人)、再開側は回収役(1人)という自然な役割になる)。
    lastTouchTeam = boundaryEvent.restartTeam;
    // 新しいリスタートが最優先: 古いロックを上書きする。3種類すべてに適用する
    // (旧実装はゴールキックのみだったため、スローイン/コーナーは相手が即座に触れられる
    // 不具合があった — CLAUDE.md「実装ギャップ」1を参照)。時間切れは無く、
    // 「ボールが再開スポットから動く」ことで解除する (下記参照)。
    setPieceLock = {
      kind: boundaryEvent.type,
      restartTeam: boundaryEvent.restartTeam,
      pos: boundaryEvent.pos,
      northEnd: (boundaryEvent.pos.y as number) < (toFixed(PITCH_HEIGHT / 2) as number),
      elapsedTicks: 0,
    };
    // キッカーを決めてボール脇へ配置し、攻撃方向を向かせる。
    // ボールだけをテレポートしてキッカーの到着をAI任せにしていた旧実装は、再開チームの誰も
    // 近くに居ない時にボールが置き去りのまま試合が停止した (resolveSetPieceKicker のコメント参照)。
    restartKickerOverride = resolveSetPieceKicker(state.players, boundaryEvent, half);
    // リスタート猶予 (Phase 5): この再開チームの相手の追跡権をRESTART_GRACE_TICKSの間ゼロにする
    // (上記setPieceLockと併用、後退させない)。同じtickで上の通常減衰(restartGraceTicksLeft--)を
    // 上書きする — 新しいリスタートが最優先。
    restartGraceTeam = boundaryEvent.restartTeam;
    restartGraceTicksLeft = RESTART_GRACE_TICKS;
    // 知覚可能イベントとして記録する (スローイン/ゴールキック/コーナーの視認性向上、
    // 実プレイ報告への対応。goalは既にscoreの変化で検出可能なため対象外)。
    lastEvent = { kind: boundaryEvent.type, team: boundaryEvent.restartTeam, atFrame: nextFrame };
  } else {
    ball = ballStep.ball;
  }

  // セットプレー再開ロックの解除判定 (CLAUDE.md「実装ギャップ」1、
  // 「キッカーが蹴るまで解除されない」方式)。ボールが再開スポットから動いた
  // (速度が付いた、またはオフサイド間接FKで別位置へ移された) ら、キッカーが実際に
  // ボールを動かしたとみなして即座に解除する。touch-priorityがrestartTeamに制限されて
  // いるため、この移動を起こせるのは常にrestartTeam自身のみ (相手は物理的に触れられない)。
  // 時間切れによる自動解除は無い(実サッカーに持ち時間制限が無いのと同じ)。
  if (
    setPieceLock &&
    (ball.vel.x !== ZERO_FIXED ||
      ball.vel.y !== ZERO_FIXED ||
      ball.pos.x !== setPieceLock.pos.x ||
      ball.pos.y !== setPieceLock.pos.y)
  ) {
    setPieceLock = null;
  }

  const players = state.players.map((player, index) => {
    // ★操作確認モード (ドリルモード)★ 操作選手以外は完全に静止させ、「自分1人とボールだけ」の
    // 無菌室にする。AIのステアリングもタックルも一切走らない (GameState.drillMode 参照)。
    if (state.drillMode && index !== controlledPlayerIndex) {
      return { ...player, vel: vZero(), tacklePhase: TacklePhase.None, tackleFrames: 0, kickDribbleActive: false };
    }
    const playerInputs = effectiveInputs[index] ?? { direction: Direction8.None, buttons: NO_BUTTONS };
    // 蹴り出しドリブル中かどうかはtouch-priority保持者のみが対象。それ以外の選手は
    // 過去に保持していた時の値を持ち越さないよう常にfalseへ強制する。
    const kickDribbleActive =
      index === touchPriorityIndex && kickDribbleCarrier ? kickDribbleCarrier.active : false;
    const isAutoGoalkeeper = player.isGoalkeeper && index !== controlledPlayerIndex;

    let effectiveDirection = playerInputs.direction;
    let speedOverride = isAutoGoalkeeper ? GK_AUTO_SPEED_FIXED : undefined;

    if (index === controlledPlayerIndex && tackleAdvance.tacklePhase !== TacklePhase.None) {
      const movementOverride = getTackleMovementOverride(tackleAdvance.tacklePhase, tackleAdvance.tackleDirection);
      if (movementOverride.direction !== undefined) effectiveDirection = movementOverride.direction;
      if (movementOverride.speed !== undefined) speedOverride = movementOverride.speed;
    }

    let moved = updatePlayer(player, effectiveDirection, kickDribbleActive, speedOverride);
    moved = { ...moved, kickDribbleActive };

    // セットプレー再開ロック中の相手押し出し (観戦シミュレーターで発覚した「リスタート・
    // キャンプ」問題の修正、CLAUDE.md「実装ギャップ」1でスローイン/コーナーにも拡大)。
    // 即時テレポート復帰+ピッチ全域プレスの組み合わせでは、相手の追跡権保持者が再開
    // スポットに張り付き、再開した瞬間に奪う→シュートのループが成立してしまう。
    // gkHold は「触れないだけ」で位置の拘束は無い (実サッカーでも相手はその場に居てよい)。
    if (
      setPieceLock &&
      setPieceLock.kind !== 'gkHold' &&
      player.team !== setPieceLock.restartTeam &&
      !player.isGoalkeeper
    ) {
      moved = applySetPieceExclusion(moved, setPieceLock);
    }

    // キッカーをボール脇へ置き、攻撃方向を向かせる (このtickの再開処理でのみ発火、上記参照)。
    // 位置まで上書きするのが試合停止バグの本丸: facingだけ変えていた旧実装では、
    // 再開チームの誰もボールに到達できず、ロックが無期限のためボールが数千tick静止した。
    if (restartKickerOverride && index === restartKickerOverride.index) {
      moved = { ...moved, pos: restartKickerOverride.pos, vel: vZero(), facing: restartKickerOverride.facing };
    }

    if (index !== controlledPlayerIndex) return moved;
    return {
      ...moved,
      kickChargeFrames: nextControlledKickChargeFrames,
      tacklePhase: tackleAdvance.tacklePhase,
      tackleFrames: tackleAdvance.tackleFrames,
      tackleDirection: tackleAdvance.tackleDirection,
    };
  });

  // ファウル成立tickは、そのtickの通常移動を破棄して「笛で止まった」配置に置き換える
  // (得点時のキックオフリセットと同じ扱い)。
  const finalPlayers = foulPlacement ? foulPlacement.players : players;

  // Team A (人間側) の再開では、次のtickからカーソルをキッカーへ乗せる。
  // キッカーをボール脇へ置いてもカーソルが別の選手に乗ったままだと、人間は
  // 「自分のスローインなのに蹴れない」状態になる (キックオフのカーソルスナップと同じ理屈)。
  const nextControlledPlayerIndex =
    foulPlacement && finalPlayers[foulPlacement.kickerIndex]?.team === TeamId.A
      ? foulPlacement.kickerIndex
      : restartKickerOverride && state.players[restartKickerOverride.index]?.team === TeamId.A
        ? restartKickerOverride.index
        : controlledPlayerIndex;

  return {
    frame: nextFrame,
    rngState,
    players: finalPlayers,
    ball,
    controlledPlayerIndex: nextControlledPlayerIndex,
    prevButtons: inputs.buttons,
    teamFormations: state.teamFormations,
    score: state.score,
    lastTouchTeam,
    linePossessionTeam,
    linePossessionSwitchTicks,
    lastTouchPlayerIndex,
    prevTouchPlayerIndex,
    difficulty: state.difficulty,
    offsideEnabled: state.offsideEnabled,
    cpuHandsOff: state.cpuHandsOff,
    drillMode: state.drillMode,
    pendingKick,
    restartGraceTeam,
    restartGraceTicksLeft,
    lastEvent,
    setPieceLock,
    manualLineOffset,
  };
}

function updatePlayer(
  player: PlayerState,
  direction: Direction8,
  kickDribbleActive: boolean,
  speedOverride?: Fixed,
): PlayerState {
  // dir は「Fixed スケールでの単位ベクトル成分」(1.0 = FIXED_ONE)、
  // 速度定数は px 単位の Fixed 値。両者とも FIXED_ONE スケールなので
  // 通常の fixedMul (a*b / FIXED_ONE) でそのまま「速度(px)」が得られる。
  const dir = DIRECTION_VECTORS[direction];
  const speed = speedOverride ?? (kickDribbleActive ? LONG_DRIBBLE_PLAYER_SPEED_FIXED : PLAYER_SPEED_FIXED);
  const vel: Vec2Fixed = {
    x: fixedMul(dir.x, speed),
    y: fixedMul(dir.y, speed),
  };
  const nextPos = clampToPitchBounds(vAdd(player.pos, vel), PLAYER_RADIUS_FIXED);
  const facing = direction === Direction8.None ? player.facing : direction;
  return { ...player, pos: nextPos, vel, facing };
}
