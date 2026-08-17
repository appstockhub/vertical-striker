import { distSqFixed, dotFixed, fixedMul, fixedSub } from '../core/fixed';
import type { Vec2Fixed } from '../core/types';
import type { ButtonState } from '../input/types';
import { DIRECTION_VECTORS } from './constants';
import { TacklePhase, type PlayerState } from './state';
import { PLAYERS_PER_TEAM } from './state';
import {
  CURSOR_HYSTERESIS_MARGIN_SQ_FIXED,
  CURSOR_SWITCH_DOMINANCE_DEN,
  CURSOR_SWITCH_DOMINANCE_NUM,
  PASS_MAX_RANGE_SQ_FIXED,
} from './cursorConstants';
import { KICK_REACH_FIXED } from './ballConstants';

/** Team A の outfield 選手の index 範囲 (0=GK は自動追従/手動切替の対象外)。 */
const TEAM_A_OUTFIELD_START = 1;
const TEAM_A_OUTFIELD_END = PLAYERS_PER_TEAM - 1; // 10

/**
 * Team A がボールの touch-priority を保持しているか (=攻撃中かどうかのYボタン文脈判定)。
 * touchPriorityIndex は players[] のインデックス。0..10 が Team A。
 */
export function isTeamAInPossession(touchPriorityIndex: number | null): boolean {
  return touchPriorityIndex !== null && touchPriorityIndex >= 0 && touchPriorityIndex < PLAYERS_PER_TEAM;
}

/**
 * Team A の outfield 候補 (index 1..10、GK除く) の中で、excludeIndex を除いてボールに
 * 最も近い選手の index を返す。同点は小さいindexが勝つ。候補が無ければ null。
 */
function findNearestTeamAOutfield(
  players: readonly PlayerState[],
  ballPos: Vec2Fixed,
  excludeIndex: number | null,
): number | null {
  let bestIndex: number | null = null;
  let bestDistSq = 0;
  for (let i = TEAM_A_OUTFIELD_START; i <= TEAM_A_OUTFIELD_END; i++) {
    if (i === excludeIndex) continue;
    const player = players[i];
    if (!player) continue;
    const distSq = distSqFixed(player.pos, ballPos) as number;
    if (bestIndex === null || distSq < bestDistSq) {
      bestIndex = i;
      bestDistSq = distSq;
    }
  }
  return bestIndex;
}

/**
 * カーソルパスの受け手選択。操作選手(carrier)の前方コーン内 かつ PASS_MAX_RANGE 以内の
 * 「carrierと同じチーム」の選手のうち最も近い1人。sqrtを使わず、dot^2 とのしきい値比較で
 * コーン判定する (dot(facing,toReceiver) > 0 で背後を除外した上で、
 *  dot^2 >= cosThresholdSq * |facing|^2 * |toReceiver|^2 で角度をチェック)。
 * 該当者が無ければ null。
 *
 * 検索範囲は carrier.team から導出する (Phase 3 マイルストーン6: CPU(Team B)の
 * パス判断にも同じ関数を使い回すための汎用化)。Team A では teamStart=0 になり、
 * Phase 2 までの挙動と完全に同一のまま変わらない。
 */
export function selectPassTarget(
  carrierIndex: number,
  players: readonly PlayerState[],
  excludeIndex: number | null = null,
): number | null {
  const carrier = players[carrierIndex];
  if (!carrier) return null;
  const facingVec = DIRECTION_VECTORS[carrier.facing];

  const teamStart = carrier.team * PLAYERS_PER_TEAM;
  const teamEnd = teamStart + PLAYERS_PER_TEAM;

  /**
   * ★24周目サイクル③ (不具合#2-①の修正)★ 2段選抜へ再設計。
   *
   * 旧実装は「facing前方±60°かつ220px以内」のみで、実戦の陣形ではフォーメーションの
   * 選手間隔 (150〜250px) とコーンの狭さが重なって**該当者ゼロ = Yが完全に無反応**が
   * 頻発していた (実プレイ報告)。原作のカーソルパスは常に「↓」マーカーの受け手が居る
   * 仕様 (居ないのは仕様上ありえない) なので、候補は必ず出す:
   *   1段目: 前方半平面 (facingとの内積 > 0) かつ射程内で最近傍 — 攻撃の流れを優先
   *   2段目: 該当者が居なければ、向きを問わず射程内の最近傍 — 逃げ道 (バックパス) を保証
   * GKは候補に含める (原作にバックパス制限は無い)。
   */
  let bestForward: number | null = null;
  let bestForwardDistSq = 0;
  let bestAny: number | null = null;
  let bestAnyDistSq = 0;
  for (let i = teamStart; i < teamEnd; i++) {
    if (i === carrierIndex) continue;
    // CPUの相互パスピンポン防止用の除外 (cpuAttackAI.ts から指定される。人間のカーソルパスでは未使用)
    if (i === excludeIndex) continue;
    const receiver = players[i];
    if (!receiver) continue;

    const toReceiver = { x: fixedSub(receiver.pos.x, carrier.pos.x), y: fixedSub(receiver.pos.y, carrier.pos.y) };
    const distSq = dotFixed(toReceiver, toReceiver) as number; // |toReceiver|^2
    if (distSq > (PASS_MAX_RANGE_SQ_FIXED as number)) continue;

    if (bestAny === null || distSq < bestAnyDistSq) {
      bestAny = i;
      bestAnyDistSq = distSq;
    }
    const dot = dotFixed(facingVec, toReceiver);
    if ((dot as number) > 0 && (bestForward === null || distSq < bestForwardDistSq)) {
      bestForward = i;
      bestForwardDistSq = distSq;
    }
  }
  return bestForward ?? bestAny;
}

export interface CursorResolution {
  /** このtickで実際に人間の入力を受け取るべき players[] index。 */
  readonly controlledPlayerIndex: number;
  /** Yボタンがこのtickでカーソルパスを発火させたか (Team A保持中 かつ Y edge かつ 受け手あり)。 */
  readonly passTriggered: boolean;
  readonly passTargetIndex: number | null;
}

/**
 * Yボタンの文脈依存解決 + カーソル自動追従/手動切替。
 * (GKのセーブ文脈によるY上書きは goalkeeperAI 側で別途最優先される想定。ここでは扱わない。)
 *
 * - Team A の**誰か**(操作選手とは限らない。パスの受け手や、偶発的にボールに触れた
 *   AI選手も含む)が touch-priority を保持している場合、操作選手を即座にその選手へ
 *   スナップする (ヒステリシス無し。「今ボールを持っている選手を操作できない」状態を
 *   作らないため)。これにより「カーソルパス完了→受け手へ自動追従」も
 *   「AI選手が偶発的にボールに触れた→そちらへ自動追従」も同じ1本のルールで扱える。
 *   スナップ後、Y edge でその選手からカーソルパスを発火する。
 * - Team A が誰も保持していない (守備文脈) -> 毎tick、ボールに最も近い Team A outfield
 *   選手へヒステリシス付きで自動追従。Y edge は「現在の操作選手以外で最も近い候補」へ
 *   ヒステリシス無視で強制的に手動切替する。
 * - 操作選手が kickChargeFrames>0 の間はどちらの自動/手動切替も発火させない
 *   (意図しない操作奪取を防ぐ)。
 */
export function resolveCursor(
  players: readonly PlayerState[],
  currentControlledIndex: number,
  touchPriorityIndex: number | null,
  ballPos: Vec2Fixed,
  buttons: ButtonState,
  prevButtons: ButtonState,
): CursorResolution {
  const yEdge = buttons.Y && !prevButtons.Y;
  const noSwitch: CursorResolution = {
    controlledPlayerIndex: currentControlledIndex,
    passTriggered: false,
    passTargetIndex: null,
  };

  // 操作選手がキック溜め中またはタックル中は、いかなる自動/手動カーソル変更も
  // 発火させない。この tick はカーソル的には何もしない (進行中の動作を継続する)。
  const currentPlayer = players[currentControlledIndex];
  const locked = (currentPlayer?.kickChargeFrames ?? 0) > 0 || (currentPlayer?.tacklePhase ?? TacklePhase.None) !== TacklePhase.None;
  if (locked) {
    return noSwitch;
  }

  if (isTeamAInPossession(touchPriorityIndex) && touchPriorityIndex !== null) {
    // 誰がボールを持っていても、操作対象は必ずその選手にスナップする
    // (カーソルパス完了→受け手へ自動追従、AI選手が偶発的にボールに触れた場合、どちらもこの1本で扱える)。
    const carrierIndex = touchPriorityIndex;
    if (yEdge) {
      const passTarget = selectPassTarget(carrierIndex, players);
      if (passTarget !== null) {
        return { controlledPlayerIndex: carrierIndex, passTriggered: true, passTargetIndex: passTarget };
      }
    }
    return { controlledPlayerIndex: carrierIndex, passTriggered: false, passTargetIndex: null };
  }

  // ★24周目サイクル③ (不具合#2-②の修正)★ ルーズボールでも、操作選手がキック射程
  // (KICK_REACH=30px) 内ならYパスを発火させる。旧実装はYだけ touch-priority (20px) を
  // 要求しており、Bキック(30px)より間合いが狭い分「Bは出るのにYは無反応」の帯が
  // 存在した (離散タッチではボールが最大13px先を転がるため、この帯を頻繁に踏む)。
  if (touchPriorityIndex === null && currentPlayer && yEdge) {
    const reachSq = fixedMul(KICK_REACH_FIXED, KICK_REACH_FIXED) as number;
    if ((distSqFixed(currentPlayer.pos, ballPos) as number) <= reachSq) {
      const passTarget = selectPassTarget(currentControlledIndex, players);
      if (passTarget !== null) {
        return { controlledPlayerIndex: currentControlledIndex, passTriggered: true, passTargetIndex: passTarget };
      }
    }
  }

  // Team A がボールを保持していない (守備文脈)。
  //
  // ★バグ修正 (実プレイ報告「チャージもない」の直接原因)★
  // 旧実装はここで「Y edge = 操作選手の手動切替」を行っていた。しかしこれは
  // Phase 2 時点の仮実装であり、公式説明書では **守備時のYはショルダータックル** で、
  // ボタンによる手動の選手切替は存在しない (ゼッケン表示選手への自動追従のみ) と
  // 判明していた (CLAUDE.md「実装ギャップ」4)。この仮実装が残っていたため、守備中に
  // Yを押すとチャージが出る代わりに操作選手がすり替わり、
  // 「Yを押しても何も起きない(どころか操作対象が飛ぶ)」体験になっていた。
  // 手動切替を廃止し、Yを守備アクションへ明け渡す。

  // 自動追従: 最も近い候補がヒステリシス閾値を超えて現在より近い場合のみ切り替える
  const candidate = findNearestTeamAOutfield(players, ballPos, null);
  if (candidate === null || candidate === currentControlledIndex) {
    return noSwitch;
  }
  if (!currentPlayer) {
    // 現在のindexが不正 (通常起きない異常系)。有効な候補へ復帰する。
    return { controlledPlayerIndex: candidate, passTriggered: false, passTargetIndex: null };
  }

  const isCurrentOutfieldCandidate =
    currentControlledIndex >= TEAM_A_OUTFIELD_START && currentControlledIndex <= TEAM_A_OUTFIELD_END;
  if (!isCurrentOutfieldCandidate) {
    // 現在GK等、outfield候補ではない (Phase 2 時点ではGK自動交代が未実装のため通常起きないが念のため)
    return { controlledPlayerIndex: candidate, passTriggered: false, passTargetIndex: null };
  }

  const currentDistSq = distSqFixed(currentPlayer.pos, ballPos) as number;
  const candidatePlayer = players[candidate];
  if (!candidatePlayer) return noSwitch;
  const candidateDistSq = distSqFixed(candidatePlayer.pos, ballPos) as number;

  // 切替条件は2つのAND (どちらもヒステリシス):
  // - 絶対マージン: 至近距離での僅差フリッカー防止 (Phase 2 から)。
  // - 相対比 (candidate*36 < current*25 = 候補が距離比で17%以上近い): ボールから遠い時は
  //   絶対マージンが1tickの移動量より小さくなり機能しないため、距離に比例する条件を追加
  //   (Phase 4 バグ修正、詳細は cursorConstants.ts の CURSOR_SWITCH_DOMINANCE_* 参照)。
  if (
    candidateDistSq < currentDistSq - (CURSOR_HYSTERESIS_MARGIN_SQ_FIXED as number) &&
    candidateDistSq * CURSOR_SWITCH_DOMINANCE_NUM < currentDistSq * CURSOR_SWITCH_DOMINANCE_DEN
  ) {
    return { controlledPlayerIndex: candidate, passTriggered: false, passTargetIndex: null };
  }
  return noSwitch;
}
