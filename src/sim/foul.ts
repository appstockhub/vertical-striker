import { distSqFixed, fixedMul, toFixed } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';
import { opponentOf, teamDefendsNorth, TeamId, type Half } from './formations';
import type { PlayerState } from './state';

/**
 * ファウル判定 (競技規則 第12条) と、そこから決まる再開種別 (第13条 FK / 第14条 PK)。
 *
 * ★経緯★ 当プロジェクトは長らく「ファウル無し」を意図的な設計として採用していた
 * (原作のスライディングにファウル判定が無いことの継承)。その結果、第13条(FK)・第14条(PK)が
 * 丸ごと成立しない状態だった (docs/soccer-rules-audit.md)。ユーザー指示により実装する。
 *
 * ★判定の原則 (このゲームの読み合いを壊さないための線引き)★
 *   ファウル = 「スライディングがボールを奪えないまま相手競技者に当たった」
 * 具体的には Active 中のスライディングが
 *   (a) 相手選手の当たり判定に接触し、
 *   (b) かつ、そのtickにボールを奪えていない
 * を満たしたときファウルとする。
 *
 * この線引きの理由 (実装を計測してから決めた):
 *   - タックルはそもそも「ボール保持者に対してのみ」発動できる (checkTackleEligibility)。
 *     つまり「ボールに関係ない選手にいきなり滑る」操作は存在しない。
 *   - 読み勝ちの背後タックルは成功して即 Recovery へ短絡するため、接触判定に到達しない。
 *     = CLAUDE.mdの設計思想「読み勝ちで奪える」は無傷。
 *   - 実際にファウルになるのは「遠くから飛び込んで奪えず人に当たった」
 *     「保持者を狙って滑ったが別の相手に突っ込んだ」という、現実でも反則になるケース。
 *
 * カード/退場は実装しない (ユーザー指示の範囲は「ファウル/FK/PK」。原作の
 * レッドカード・退場4名までの仕様は docs/soccer-rules-audit.md に記録済み)。
 */

/** 選手同士が「接触した」とみなす距離 (px)。選手の当たり半径(10px)の合計より少し内側。 */
export const FOUL_CONTACT_RADIUS_FIXED: Fixed = toFixed(17);
const FOUL_CONTACT_RADIUS_SQ = fixedMul(FOUL_CONTACT_RADIUS_FIXED, FOUL_CONTACT_RADIUS_FIXED) as number;

/** ペナルティエリアの寸法 (render/pitchGeometry.ts の描画と一致させること)。 */
export const PENALTY_AREA_WIDTH_FIXED: Fixed = toFixed(288);
export const PENALTY_AREA_DEPTH_FIXED: Fixed = toFixed(168);
/** ペナルティスポットのゴールラインからの深さ (同上)。 */
export const PENALTY_SPOT_DEPTH_FIXED: Fixed = toFixed(110);

export interface FoulEvent {
  /** 反則を犯した選手の players[] index。 */
  readonly offenderIndex: number;
  /** 反則された (再開する) チーム。 */
  readonly restartTeam: TeamId;
  /** 反則地点 (FKのボール設置位置。PKの場合はスポットへ置き換える)。 */
  readonly pos: Vec2Fixed;
  /** true なら守備側のペナルティエリア内 = PK。 */
  readonly isPenalty: boolean;
}

/** pos が team の守るペナルティエリア内か。 */
export function isInsidePenaltyArea(pos: Vec2Fixed, defendingTeam: TeamId, half: Half): boolean {
  const halfWidth = (PENALTY_AREA_WIDTH_FIXED as number) / 2;
  const centerX = (toFixed(PITCH_WIDTH / 2) as number);
  if (Math.abs((pos.x as number) - centerX) > halfWidth) return false;

  const depth = PENALTY_AREA_DEPTH_FIXED as number;
  const y = pos.y as number;
  return teamDefendsNorth(defendingTeam, half) ? y <= depth : y >= (toFixed(PITCH_HEIGHT) as number) - depth;
}

/** team のペナルティスポットのワールド座標。 */
export function penaltySpot(defendingTeam: TeamId, half: Half): Vec2Fixed {
  const x = toFixed(PITCH_WIDTH / 2);
  const y = teamDefendsNorth(defendingTeam, half)
    ? PENALTY_SPOT_DEPTH_FIXED
    : (((toFixed(PITCH_HEIGHT) as number) - (PENALTY_SPOT_DEPTH_FIXED as number)) as Fixed);
  return { x, y };
}

/**
 * このtickにファウルが発生したかを判定する純関数。
 *
 * @param tacklerIndex スライディング中の選手 (呼び出し側で Active フェーズを保証すること)。
 * @param wonBall このtickにタックルがボールを奪えたか。奪えていればファウルにしない。
 */
export function detectFoul(
  tacklerIndex: number,
  tackler: PlayerState,
  players: readonly PlayerState[],
  wonBall: boolean,
  half: Half,
): FoulEvent | null {
  if (wonBall) return null; // ボールを奪えた = 正当なタックル

  // 相手競技者に接触したか (最も近い1人だけを見る)。
  let victimIndex: number | null = null;
  let victimDistSq = 0;
  for (let i = 0; i < players.length; i++) {
    const other = players[i];
    if (!other || other.team === tackler.team) continue;
    const d = distSqFixed(tackler.pos, other.pos) as number;
    if (d > FOUL_CONTACT_RADIUS_SQ) continue;
    if (victimIndex === null || d < victimDistSq) {
      victimIndex = i;
      victimDistSq = d;
    }
  }
  if (victimIndex === null) return null;

  const restartTeam = opponentOf(tackler.team);
  // 反則地点は「反則された側の選手の位置」= 実際に倒された場所。
  const pos = players[victimIndex]!.pos;
  return {
    offenderIndex: tacklerIndex,
    restartTeam,
    pos,
    // 反則した側が守っているエリア内か = PK。
    isPenalty: isInsidePenaltyArea(pos, tackler.team, half),
  };
}
