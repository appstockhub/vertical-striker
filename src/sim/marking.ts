import { distSqFixed, toFixed } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import {
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
  LINE_FOLLOW_GRID_FIXED,
  MARK_BALL_EXCLUSION_SQ_FIXED,
  MARK_MAX_MARKERS,
  MARK_STANDOFF_FIXED,
  MARK_TARGET_GRID_FIXED,
  MARK_ZONE_DEPTH_FIXED,
  MARKER_MAX_HOME_DEPTH_FIXED,
} from './teamAIConstants';

/**
 * マーク (マンマーク守備) の割り当て。Phase 4 で導入。
 *
 * 実プレイで「守備側の非追跡権選手には『ホームに留まる』以上の目的が無く、侵入してきた
 * 相手FWを誰も見ていない」ことが判明したため、追跡権(computeChaseRightIndices)を持たない
 * DFライン選手に「マークすべき相手」を割り当てる。マークは既存の力学に新しい項を追加せず、
 * ホーム復元力が収束する目標点をマーク対象のゴール側スタンドオフ点に差し替えるだけで実現する
 * (computeNonControlledDirection 側の分岐参照)。
 *
 * 決定論と安定性の設計 (このコードベースの既存慣行の踏襲):
 * - マーカー適格は「静的ホーム深度」(試合中不変) で判定 → マーカー集合は絶対に変動しない。
 * - 候補適格の深度判定は LINE_FOLLOW_GRID(32px) 量子化、ボール除外は48px²バケット →
 *   境界上の微動でメンバーシップが毎tick反転しない。
 * - 距離順位は48px²バケット + index昇順タイブレーク (computeChaseRightIndices と同じ)。
 * - すべて昇順走査 + 厳密比較。Math.random/sqrt/三角関数は不使用。
 */

/** 距離二乗の量子化バケット (48px相当、追跡権と同じ値)。順位の毎tick入れ替わり防止。 */
const DIST_BUCKET_SQ = toFixed(48 * 48) as number;

/**
 * マーク割り当てを求める (毎tick1回だけ呼ぶ純関数)。
 * 返り値: マーカーの players[] index → マーク対象の players[] index。
 *
 * - linePossessionTeam が null (競り合い中) なら空Map (どちらのチームもマークしない)。
 * - マークを行うのは linePossessionTeam の相手チーム (守備側) のみ。
 * - マーカー: 守備側の外野のうち静的ホーム深度 <= MARKER_MAX_HOME_DEPTH (=DFライン)。
 * - 候補: 攻撃側の外野のうち、守備側から見た量子化深度 < MARK_ZONE_DEPTH (自陣内) かつ
 *   ボールから MARK_BALL_EXCLUSION 以上離れている選手 (ボール近傍は追跡権の仕事)。
 * - 割り当て: 候補を危険度順 (量子化深度昇順 → index昇順) に走査し、それぞれに
 *   未割り当てマーカーの最寄り (バケット距離、同値はindex小) を1:1で割り当てる。
 *   最大 MARK_MAX_MARKERS 件。
 */
export function computeMarkAssignments(
  players: readonly PlayerState[],
  linePossessionTeam: TeamId | null,
  half: Half,
  teamFormations: readonly [FormationId, FormationId],
  ballPos: Vec2Fixed,
): ReadonlyMap<number, number> {
  const result = new Map<number, number>();
  if (linePossessionTeam === null) return result;
  const defendingTeam = opponentOf(linePossessionTeam);

  // マーカー適格 (静的ホーム深度ベース、昇順index)
  const markers: number[] = [];
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p || p.team !== defendingTeam || p.isGoalkeeper) continue;
    const home = getHomePosition(p.team, p.slotIndex, teamFormations[p.team], half);
    const staticDepth = depthFromOwnGoal(p.team, half, home.y) as number;
    if (staticDepth <= (MARKER_MAX_HOME_DEPTH_FIXED as number)) markers.push(i);
  }
  if (markers.length === 0) return result;

  // 候補適格 + 危険度順ソート
  const grid = LINE_FOLLOW_GRID_FIXED as number;
  const exclusionBucket = Math.floor((MARK_BALL_EXCLUSION_SQ_FIXED as number) / DIST_BUCKET_SQ);
  const candidates: Array<{ index: number; depthBucket: number }> = [];
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p || p.team !== linePossessionTeam || p.isGoalkeeper) continue;
    const depth = depthFromOwnGoal(defendingTeam, half, p.pos.y) as number;
    const depthBucket = Math.floor(depth / grid);
    if (depthBucket * grid >= (MARK_ZONE_DEPTH_FIXED as number)) continue; // 自陣外
    const ballBucket = Math.floor((distSqFixed(p.pos, ballPos) as number) / DIST_BUCKET_SQ);
    if (ballBucket < exclusionBucket) continue; // ボール近傍は追跡権の仕事
    candidates.push({ index: i, depthBucket });
  }
  candidates.sort((a, b) => (a.depthBucket !== b.depthBucket ? a.depthBucket - b.depthBucket : a.index - b.index));

  // 貪欲1:1割り当て (危険な候補から順に最寄りの未割り当てマーカーを付ける)
  const assigned = new Set<number>();
  for (const cand of candidates) {
    if (result.size >= MARK_MAX_MARKERS) break;
    let bestMarker: number | null = null;
    let bestBucket = Infinity;
    for (const m of markers) {
      if (assigned.has(m)) continue;
      const bucket = Math.floor((distSqFixed(players[m]!.pos, players[cand.index]!.pos) as number) / DIST_BUCKET_SQ);
      if (bucket < bestBucket) {
        bestBucket = bucket;
        bestMarker = m; // markers は昇順なので同バケットは最初に見つけた小indexが勝つ (strict <)
      }
    }
    if (bestMarker === null) break; // マーカーが尽きた
    assigned.add(bestMarker);
    result.set(bestMarker, cand.index);
  }

  return result;
}

/**
 * マーク対象に対するマーカーのホーム目標点。
 * 対象位置を MARK_TARGET_GRID(24px) に量子化し、深度軸に沿って自ゴール側へ
 * MARK_STANDOFF(48px) ずらす (ゴールとの間に立つ、現実のマークの基本位置)。
 * 24pxグリッドはホームdeadzone(28px)より小さいため、対象がグリッド1段動いても
 * 到着済みのマーカーは動かない (振動の構造的排除、オンサイドクランプと同じ理屈)。
 */
export function computeMarkHomePosition(targetPos: Vec2Fixed, markingTeam: TeamId, half: Half): Vec2Fixed {
  const grid = MARK_TARGET_GRID_FIXED as number;
  const qx = (Math.floor((targetPos.x as number) / grid) * grid) as Fixed;
  const qy = (Math.floor((targetPos.y as number) / grid) * grid) as Fixed;
  const depth = depthFromOwnGoal(markingTeam, half, qy) as number;
  const standoffDepth = Math.max(0, depth - (MARK_STANDOFF_FIXED as number)) as Fixed;
  return { x: qx, y: depthToY(markingTeam, half, standoffDepth) };
}
