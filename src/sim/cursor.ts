import { dotFixed, fixedAdd, fixedMul, fixedSub } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import type { ButtonState } from '../input/types';
import { DIRECTION_VECTORS } from './constants';
import type { PlayerState } from './state';
import { PLAYERS_PER_TEAM } from './state';
import {
  CURSOR_HYSTERESIS_MARGIN_SQ_FIXED,
  PASS_CONE_COS_THRESHOLD_SQ_FIXED,
  PASS_MAX_RANGE_SQ_FIXED,
} from './cursorConstants';

/** Team A の outfield 選手の index 範囲 (0=GK は自動追従/手動切替の対象外)。 */
const TEAM_A_OUTFIELD_START = 1;
const TEAM_A_OUTFIELD_END = PLAYERS_PER_TEAM - 1; // 10

function squaredDistance(a: Vec2Fixed, b: Vec2Fixed): Fixed {
  const dx = fixedSub(a.x, b.x);
  const dy = fixedSub(a.y, b.y);
  return fixedAdd(fixedMul(dx, dx), fixedMul(dy, dy));
}

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
    const distSq = squaredDistance(player.pos, ballPos) as number;
    if (bestIndex === null || distSq < bestDistSq) {
      bestIndex = i;
      bestDistSq = distSq;
    }
  }
  return bestIndex;
}

/**
 * カーソルパスの受け手選択。操作選手(carrier)の前方コーン内 かつ PASS_MAX_RANGE 以内の
 * Team A 選手のうち最も近い1人。sqrtを使わず、dot^2 とのしきい値比較でコーン判定する
 * (dot(facing,toReceiver) > 0 で背後を除外した上で、
 *  dot^2 >= cosThresholdSq * |facing|^2 * |toReceiver|^2 で角度をチェック)。
 * 該当者が無ければ null。
 */
export function selectPassTarget(carrierIndex: number, players: readonly PlayerState[]): number | null {
  const carrier = players[carrierIndex];
  if (!carrier) return null;
  const facingVec = DIRECTION_VECTORS[carrier.facing];
  const facingMagSq = dotFixed(facingVec, facingVec);

  let bestIndex: number | null = null;
  let bestDistSq = 0;
  for (let i = 0; i < PLAYERS_PER_TEAM; i++) {
    if (i === carrierIndex) continue;
    const receiver = players[i];
    if (!receiver) continue;

    const toReceiver = { x: fixedSub(receiver.pos.x, carrier.pos.x), y: fixedSub(receiver.pos.y, carrier.pos.y) };
    const distSq = fixedAdd(fixedMul(toReceiver.x, toReceiver.x), fixedMul(toReceiver.y, toReceiver.y)) as number;
    if (distSq > (PASS_MAX_RANGE_SQ_FIXED as number)) continue;

    const dot = dotFixed(facingVec, toReceiver);
    if ((dot as number) <= 0) continue; // 背後は除外

    const dotSq = fixedMul(dot, dot);
    const threshold = fixedMul(fixedMul(PASS_CONE_COS_THRESHOLD_SQ_FIXED, facingMagSq), distSq as Fixed);
    if ((dotSq as number) < (threshold as number)) continue; // コーン角外

    if (bestIndex === null || distSq < bestDistSq) {
      bestIndex = i;
      bestDistSq = distSq;
    }
  }
  return bestIndex;
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

  // 操作選手がキック溜め中 (将来的にはタックル中も) は、いかなる自動/手動カーソル変更も
  // 発火させない。この tick はカーソル的には何もしない (溜めているBはそのまま継続する)。
  const currentPlayer = players[currentControlledIndex];
  const locked = (currentPlayer?.kickChargeFrames ?? 0) > 0;
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

  // Team A がボールを保持していない (守備文脈)
  if (yEdge) {
    // 手動切替: 現在の操作選手以外で最も近い候補へヒステリシス無視で強制切替する
    const manualTarget = findNearestTeamAOutfield(players, ballPos, currentControlledIndex);
    return manualTarget !== null
      ? { controlledPlayerIndex: manualTarget, passTriggered: false, passTargetIndex: null }
      : noSwitch;
  }

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

  const currentDistSq = squaredDistance(currentPlayer.pos, ballPos) as number;
  const candidatePlayer = players[candidate];
  if (!candidatePlayer) return noSwitch;
  const candidateDistSq = squaredDistance(candidatePlayer.pos, ballPos) as number;

  if (candidateDistSq < currentDistSq - (CURSOR_HYSTERESIS_MARGIN_SQ_FIXED as number)) {
    return { controlledPlayerIndex: candidate, passTriggered: false, passTargetIndex: null };
  }
  return noSwitch;
}
