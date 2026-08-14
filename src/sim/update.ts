import { dotFixed, fixedMul, toFixed, vAdd, vSub, vZero, ZERO_FIXED } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { Direction8, emptyButtonState, type ButtonState } from '../input/types';
import type { BallState, GameState, PlayerState } from './state';
import { PLAYERS_PER_TEAM, TacklePhase, TeamId } from './state';
import { getHomePosition, opponentOf } from './formations';
import { PITCH_HEIGHT } from '../config/pitch';
import { checkOffside } from './offsideRule';
import { DIRECTION_VECTORS, PLAYER_RADIUS_FIXED, PLAYER_SPEED_FIXED } from './constants';
import { KICK_MIN_CHARGE_FRAMES, LONG_DRIBBLE_PLAYER_SPEED_FIXED } from './ballConstants';
import { applyDribbleTouch, isLongDribbleActive } from './dribble';
import { applyKick, updateKickCharge } from './kick';
import { clampToPitchBounds, stepBallPhysicsDetailed } from './ballPhysics';
import { findTouchPriorityPlayer } from './ballTouch';
import { computeChaseRightIndices, computeNonControlledDirection } from './teamAI';
import { computeMarkAssignments } from './marking';
import { isTeamAInPossession, resolveCursor } from './cursor';
import { quantizeToDirection8 } from './steering';
import {
  applySave,
  computeGoalkeeperAutoDirection,
  isInSaveRange,
  resolveSaveOutcome,
  shouldTakeOverGoalkeeper,
} from './goalkeeperAI';
import {
  CATCH_MAX_SPEED_FIXED,
  GK_AUTO_SPEED_FIXED,
  SAVE_CONTEXT_MIN_BALL_SPEED_SQ_FIXED,
} from './goalkeeperConstants';
import { GOAL_KICK_EXCLUSION_DEPTH_FIXED } from './boundsConstants';
import { KICKOFF_GRACE_TICKS, LINE_POSSESSION_SWITCH_TICKS, RESTART_GRACE_TICKS } from './teamAIConstants';
import {
  advanceTacklePhase,
  applyTackleWin,
  checkTackleEligibility,
  checkTackleSuccess,
  getTackleMovementOverride,
  type TackleAdvance,
} from './tackle';
import { TACKLE_RECOVERY_FRAMES } from './tackleConstants';
import { getHalf, isFulltime } from './matchClock';
import { placeKickoffFormation } from './kickoff';
import { detectBoundaryEvent } from './bounds';
import { decideCpuAttack } from './cpuAttackAI';

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
    const reset = placeKickoffFormation(getHalf(nextFrame), state.teamFormations);
    return {
      frame: nextFrame,
      rngState: state.rngState,
      players: reset.players,
      ball: reset.ball,
      controlledPlayerIndex: state.controlledPlayerIndex,
      prevButtons: inputs.buttons,
      teamFormations: state.teamFormations,
      score: state.score,
      lastTouchTeam: null,
      linePossessionTeam: null,
      linePossessionSwitchTicks: 0,
      lastTouchPlayerIndex: null,
      prevTouchPlayerIndex: null,
      difficulty: state.difficulty,
      offsideEnabled: state.offsideEnabled,
      // 前後半キックオフの猶予チームは半分で交代する (実サッカーの「前半にキックオフした
      // チームは後半にキックオフしない」ルールと同じ。前半はTeam Aが既にcreateInitialStateで
      // 猶予を得ているため、後半はTeam B)。
      restartGraceTeam: getHalf(nextFrame) === 1 ? TeamId.A : TeamId.B,
      restartGraceTicksLeft: KICKOFF_GRACE_TICKS,
      lastEvent: null,
    };
  }

  const touchPriorityIndex = findTouchPriorityPlayer(state.players, state.ball.pos);
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

  const teamAGoalkeeper = state.players[TEAM_A_GK_INDEX];
  const currentControlled = state.players[state.controlledPlayerIndex];
  const currentLocked =
    (currentControlled?.kickChargeFrames ?? 0) > 0 ||
    (currentControlled?.tacklePhase ?? TacklePhase.None) !== TacklePhase.None;
  const gkTakeover =
    !currentLocked &&
    !!teamAGoalkeeper &&
    shouldTakeOverGoalkeeper(teamAGoalkeeper, state.ball.pos, inputs.buttons, teamAInPossession);

  const cursor = gkTakeover
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

  // セーブ文脈は「速いボールが飛んできている」時のみ。遅い/静止ボールがGKの足元にある時は
  // 通常のキック文脈のままにする (速度条件なしだと、GKは確保したボールを永遠に蹴れず、
  // ドリブルで運ぶしかなくなる詰みがあった — 観戦シミュレーターで発覚した実プレイ直結の欠陥)。
  const ballSpeedSqForSave = dotFixed(state.ball.vel, state.ball.vel) as number;
  const inSaveRange =
    !!controlledPlayer &&
    controlledPlayer.isGoalkeeper &&
    isInSaveRange(controlledPlayer, state.ball.pos) &&
    ballSpeedSqForSave > (SAVE_CONTEXT_MIN_BALL_SPEED_SQ_FIXED as number);

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
  const cpuDecision =
    touchPriorityIndex !== null && touchPlayerForCpu && !isTeamAInPossession(touchPriorityIndex)
      ? decideCpuAttack(touchPriorityIndex, state.players, half, state.difficulty, state.rngState, prevTouchPlayerIndex)
      : null;
  let rngState = cpuDecision ? cpuDecision.rngState : state.rngState;

  // リスタート猶予のカウントダウン (Phase 5、linePossessionSwitchTicksと同じ毎tick減衰の流儀)。
  // 猶予中は restartGraceTeam の相手チームの追跡権をゼロにする (下記 chaseRightIndices 参照)。
  let restartGraceTicksLeft = Math.max(0, state.restartGraceTicksLeft - 1);
  let restartGraceTeam = restartGraceTicksLeft > 0 ? state.restartGraceTeam : null;
  const suppressedTeam =
    restartGraceTicksLeft > 0 && restartGraceTeam !== null ? opponentOf(restartGraceTeam) : null;

  // 「団子サッカー」防止: 守備側は最寄り2人(プレス+カバー)、保持側は最寄り1人(受け手)だけが
  // ボール引力をフルに使う (バグ修正、実プレイ+観戦シミュレーターで発覚)。毎tick1回だけ計算する。
  // 第4引数 suppressedTeam: リスタート猶予中はこのチームの追跡権を丸ごとゼロにする。
  const chaseRightIndices = computeChaseRightIndices(state.players, state.ball.pos, possessionTeam, suppressedTeam);

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
    );
    return { direction, buttons: NO_BUTTONS };
  });

  let ball = state.ball;
  let nextControlledKickChargeFrames = controlledPlayer?.kickChargeFrames ?? 0;
  let tackleAdvance: TackleAdvance = NO_TACKLE;
  // 直近の知覚可能イベント (Phase 5)。物理/AIには影響しない echo (state.ts参照)。
  let lastEvent = state.lastEvent;

  const touchInputs = touchPriorityIndex !== null ? effectiveInputs[touchPriorityIndex] : undefined;
  if (touchInputs) {
    ball = applyDribbleTouch(ball, true, touchInputs.direction, touchInputs.buttons);
    const touchPlayer = touchPriorityIndex !== null ? state.players[touchPriorityIndex] : undefined;
    if (touchPlayer) lastTouchTeam = touchPlayer.team;
  }

  if (inSaveRange && controlledPlayer) {
    // セーブ文脈: Y=キャッチ/B=パンチングのみを処理する (カーソルパス/キック溜め/タックルは行わない)。
    const yEdge = inputs.buttons.Y && !state.prevButtons.Y;
    const bEdge = inputs.buttons.B && !state.prevButtons.B;
    if (yEdge) {
      const outcome = resolveSaveOutcome(controlledPlayer, ball, 'catch');
      ball = applySave(ball, controlledPlayer, outcome, half);
      if (outcome !== 'missed') lastTouchTeam = controlledPlayer.team;
      // secured (真のキャッチ) のみ知覚可能イベントとして記録する (視認性向上、実プレイ報告への対応)。
      if (outcome === 'secured') lastEvent = { kind: 'gkCatch', team: controlledPlayer.team, atFrame: nextFrame };
    } else if (bEdge) {
      const outcome = resolveSaveOutcome(controlledPlayer, ball, 'punch');
      ball = applySave(ball, controlledPlayer, outcome, half);
      if (outcome !== 'missed') lastTouchTeam = controlledPlayer.team;
    }
  } else {
    if (cursor.passTriggered && cursor.passTargetIndex !== null && controlledPlayer) {
      const receiver = state.players[cursor.passTargetIndex];
      if (receiver) {
        const offside = state.offsideEnabled
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

      if (isCarryingBall) {
        // ボール保持中: 既存のチャージキック (タックル状態は自然にNoneへ収束させる)。
        const charge = updateKickCharge(controlledPlayer.kickChargeFrames, inputs.buttons.B);
        nextControlledKickChargeFrames = charge.nextFrames;
        if (charge.releasedFrames > 0) {
          const offside = state.offsideEnabled
            ? checkOffside(controlledPlayerIndex, controlledPlayer.team, state.players, half)
            : { offside: false, offsidePlayerIndex: null };
          const offsidePlayer =
            offside.offside && offside.offsidePlayerIndex !== null ? state.players[offside.offsidePlayerIndex] : undefined;
          if (offsidePlayer) {
            ball = offsideRestartBall(offsidePlayer);
            lastTouchTeam = opponentOf(controlledPlayer.team);
          } else {
            ball = applyKick(ball, controlledPlayer, charge.releasedFrames, inputs.direction);
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

        // Bのedgeでタックルを新規発動できる (既にNoneの時のみ)。
        const bEdge = inputs.buttons.B && !state.prevButtons.B;
        const wantsTackle =
          bEdge &&
          controlledPlayer.tacklePhase === TacklePhase.None &&
          checkTackleEligibility(controlledPlayer, state.players, touchPriorityIndex, inputs.direction);
        tackleAdvance = advanceTacklePhase(controlledPlayer, wantsTackle, inputs.direction);

        if (tackleAdvance.tacklePhase === TacklePhase.Active) {
          if (checkTackleSuccess(controlledPlayer, state.players, touchPriorityIndex)) {
            ball = applyTackleWin(ball, tackleAdvance.tackleDirection);
            lastTouchTeam = controlledPlayer.team;
            // 成功した瞬間にRecoveryへ短絡する (Activeの残り時間を待たない)。
            tackleAdvance = {
              tacklePhase: TacklePhase.Recovery,
              tackleFrames: TACKLE_RECOVERY_FRAMES,
              tackleDirection: tackleAdvance.tackleDirection,
            };
          }
        }
      }
    }
  }

  // 非操作GKの自動セーブ (観戦シミュレーターで発覚したギャップの修正): applySaveは従来
  // 「人間が操作しているGK」の Y/B 入力からしか呼ばれず、AI制御のGK (Team BのGKは常時、
  // Team AのGKも自動交代が発動していない間) はシュートに一切反応できなかった。
  // CLAUDE.mdのキーパーAI仕様「シュートコースへの反応」に沿い、非操作GKはセーブ範囲に
  // ボールが入ったら自動でセーブを試みる: キャッチ可能な遅さならキャッチ、速ければ
  // パンチング (人間の Y/B の使い分けと同じリスクリターン構造を決定論的に適用)。
  // players[] 昇順 (A GK=0 → B GK=11) で処理する決定論的順序。
  for (const gkIndex of [TeamId.A * PLAYERS_PER_TEAM, TeamId.B * PLAYERS_PER_TEAM]) {
    if (gkIndex === controlledPlayerIndex) continue; // 人間操作中のGKは従来どおり手動セーブのみ
    const gk = state.players[gkIndex];
    if (!gk || !gk.isGoalkeeper) continue;
    if (!isInSaveRange(gk, ball.pos)) continue;
    const ballSpeedSq = dotFixed(ball.vel, ball.vel) as number;
    // 人間のセーブ文脈と同じ速度ゲート: 遅い/静止ボールは「セーブ対象」ではなく「拾って
    // プレーするボール」。ゲート無しだと、自動GKが自分でドリブルし始めたボールや
    // 確保済みのボールを毎tickキャッチし直し、その場で永久に固まる (観戦シミュレーターで発覚)。
    if (ballSpeedSq <= (SAVE_CONTEXT_MIN_BALL_SPEED_SQ_FIXED as number)) continue;
    const catchable = ballSpeedSq <= (fixedMul(CATCH_MAX_SPEED_FIXED, CATCH_MAX_SPEED_FIXED) as number);
    const outcome = resolveSaveOutcome(gk, ball, catchable ? 'catch' : 'punch');
    if (outcome !== 'missed') {
      ball = applySave(ball, gk, outcome, half);
      lastTouchTeam = gk.team;
      // secured (真のキャッチ) のみ知覚可能イベントとして記録する。これにより
      // CPU/非操作GKのキャッチも人間の目に見えるようになる (視認性向上、実プレイ報告への対応)。
      if (outcome === 'secured') lastEvent = { kind: 'gkCatch', team: gk.team, atFrame: nextFrame };
    }
  }

  if (cpuDecision && touchPriorityIndex !== null && (cpuDecision.action === 'shoot' || cpuDecision.action === 'pass')) {
    // CPU(Team B)のシュート/パス実行。オフサイド判定はTeam Aの2箇所(カーソルパス/チャージキック)と
    // 同じ扱いにする (計画セクションF、offsideフックをCPUのキックにも適用)。溜め無し・
    // 即座グラウンダー固定 (計画の仮定8、弾道バリエーションはPhase 4に先送り)。
    const carrier = state.players[touchPriorityIndex];
    if (carrier) {
      const offside = state.offsideEnabled
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

  const ballStep = stepBallPhysicsDetailed(ball);
  const boundaryEvent = detectBoundaryEvent(ballStep.tentativePos, ballStep.ball.height, half, lastTouchTeam);

  if (boundaryEvent?.type === 'goal') {
    // 得点: 選手移動処理まで進めず、その場でミラー配置のキックオフへリセットして完結させる
    // (計画セクションD。古いボール位置ベースのAI目標が1tickだけ混ざるのを防ぐ)。
    const reset = placeKickoffFormation(half, state.teamFormations);
    const score: readonly [number, number] =
      boundaryEvent.scoringTeam === TeamId.A
        ? [state.score[0] + 1, state.score[1]]
        : [state.score[0], state.score[1] + 1];
    return {
      frame: nextFrame,
      rngState,
      players: reset.players,
      ball: reset.ball,
      controlledPlayerIndex: state.controlledPlayerIndex,
      prevButtons: inputs.buttons,
      teamFormations: state.teamFormations,
      score,
      lastTouchTeam: null,
      linePossessionTeam: null,
      linePossessionSwitchTicks: 0,
      lastTouchPlayerIndex: null,
      prevTouchPlayerIndex: null,
      difficulty: state.difficulty,
      offsideEnabled: state.offsideEnabled,
      // 得点後キックオフの猶予チームは「得点されたチームの相手」(実サッカーのルールと同じ)。
      restartGraceTeam: opponentOf(boundaryEvent.scoringTeam),
      restartGraceTicksLeft: KICKOFF_GRACE_TICKS,
      lastEvent: null,
    };
  }

  let goalKickExclusion: { readonly restartTeam: TeamId; readonly northEnd: boolean } | null = null;
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
    if (boundaryEvent.type === 'goalKick') {
      goalKickExclusion = {
        restartTeam: boundaryEvent.restartTeam,
        northEnd: (boundaryEvent.pos.y as number) < (toFixed(PITCH_HEIGHT / 2) as number),
      };
    }
    // リスタート猶予 (Phase 5): この再開チームの相手の追跡権をRESTART_GRACE_TICKSの間ゼロにする
    // (既存のgoalKickExclusion一発押し出しと併用、後退させない)。同じtickで上の
    // 通常減衰(restartGraceTicksLeft--)を上書きする — 新しいリスタートが最優先。
    restartGraceTeam = boundaryEvent.restartTeam;
    restartGraceTicksLeft = RESTART_GRACE_TICKS;
    // 知覚可能イベントとして記録する (スローイン/ゴールキック/コーナーの視認性向上、
    // 実プレイ報告への対応。goalは既にscoreの変化で検出可能なため対象外)。
    lastEvent = { kind: boundaryEvent.type, team: boundaryEvent.restartTeam, atFrame: nextFrame };
  } else {
    ball = ballStep.ball;
  }

  const players = state.players.map((player, index) => {
    const playerInputs = effectiveInputs[index] ?? { direction: Direction8.None, buttons: NO_BUTTONS };
    const longDribble =
      index === touchPriorityIndex && isLongDribbleActive(true, playerInputs.direction, playerInputs.buttons);
    const isAutoGoalkeeper = player.isGoalkeeper && index !== controlledPlayerIndex;

    let effectiveDirection = playerInputs.direction;
    let speedOverride = isAutoGoalkeeper ? GK_AUTO_SPEED_FIXED : undefined;

    if (index === controlledPlayerIndex && tackleAdvance.tacklePhase !== TacklePhase.None) {
      const movementOverride = getTackleMovementOverride(tackleAdvance.tacklePhase, tackleAdvance.tackleDirection);
      if (movementOverride.direction !== undefined) effectiveDirection = movementOverride.direction;
      if (movementOverride.speed !== undefined) speedOverride = movementOverride.speed;
    }

    let moved = updatePlayer(player, effectiveDirection, longDribble, speedOverride);

    // ゴールキック時の退避ルール (観戦シミュレーターで発覚した「リスタート・キャンプ」問題の修正):
    // 即時テレポート復帰+ピッチ全域プレスの組み合わせでは、相手の追跡権保持者がゴールキックの
    // スポットに張り付き、再開した瞬間に奪う→シュートのループが成立してしまう。実サッカーの
    // 「ゴールキック時は相手はペナルティエリア外」に相当する最小ルールとして、再開側のゴール
    // ラインから一定距離未満にいる相手選手をその距離まで軸方向に押し出す (sqrt不要のyクランプ)。
    if (goalKickExclusion && player.team !== goalKickExclusion.restartTeam && !player.isGoalkeeper) {
      const limitY = goalKickExclusion.northEnd
        ? (GOAL_KICK_EXCLUSION_DEPTH_FIXED as number)
        : ((toFixed(PITCH_HEIGHT) as number) - (GOAL_KICK_EXCLUSION_DEPTH_FIXED as number));
      const y = moved.pos.y as number;
      const needsPush = goalKickExclusion.northEnd ? y < limitY : y > limitY;
      if (needsPush) {
        moved = { ...moved, pos: { x: moved.pos.x, y: limitY as Fixed } };
      }
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

  return {
    frame: nextFrame,
    rngState,
    players,
    ball,
    controlledPlayerIndex,
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
    restartGraceTeam,
    restartGraceTicksLeft,
    lastEvent,
  };
}

function updatePlayer(
  player: PlayerState,
  direction: Direction8,
  longDribble: boolean,
  speedOverride?: Fixed,
): PlayerState {
  // dir は「Fixed スケールでの単位ベクトル成分」(1.0 = FIXED_ONE)、
  // 速度定数は px 単位の Fixed 値。両者とも FIXED_ONE スケールなので
  // 通常の fixedMul (a*b / FIXED_ONE) でそのまま「速度(px)」が得られる。
  const dir = DIRECTION_VECTORS[direction];
  const speed = speedOverride ?? (longDribble ? LONG_DRIBBLE_PLAYER_SPEED_FIXED : PLAYER_SPEED_FIXED);
  const vel: Vec2Fixed = {
    x: fixedMul(dir.x, speed),
    y: fixedMul(dir.y, speed),
  };
  const nextPos = clampToPitchBounds(vAdd(player.pos, vel), PLAYER_RADIUS_FIXED);
  const facing = direction === Direction8.None ? player.facing : direction;
  return { ...player, pos: nextPos, vel, facing };
}
