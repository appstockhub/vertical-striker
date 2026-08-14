import { distSqFixed, toFixed } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { PITCH_WIDTH } from '../config/pitch';
import { depthFromOwnGoal, depthToY, getOutfieldSlotDepthFrac, type FormationId, type Half } from './formations';
import type { PlayerState } from './state';
import {
  LINE_FOLLOW_GRID_FIXED,
  SUPPORT_AHEAD_STANDOFF_FIXED,
  SUPPORT_MAX_DEPTH_FIXED,
  SUPPORT_RUNNER_COUNT,
  SUPPORT_SPACING_SQ_FIXED,
  SUPPORT_SPREAD_OFFSET_FIXED,
  SUPPORT_X_GRID_FIXED,
} from './teamAIConstants';

/**
 * サポートラン (オフザボールの攻撃的な位置取り)。Phase 4 で導入。
 *
 * 実プレイで「ボール保持者以外がパスを受ける動きを一切しない (ライン押し上げはボールの
 * 後方150pxに留まるため、前方の受け手が存在しない)」ことが判明したため、攻撃側の
 * 前線ランナーに「ボールより前方のスペースへ走り込む」目標を与える。
 * マークと同様、新しい力項は追加せず、ホーム復元力が収束する目標点を差し替えるだけ
 * (computeNonControlledDirection 側の分岐参照)。オフサイドラインへの配慮は、
 * 既存のオンサイドクランプが差し替え後の目標に適用されることで自動的に成立する。
 */

/** 距離二乗の量子化バケット (48px相当、追跡権・マークと同じ値)。判定の毎tick反転防止。 */
const DIST_BUCKET_SQ = toFixed(48 * 48) as number;

/**
 * このスロットがサポートランナーかどうかの静的な純述語。
 * フォーメーションの外野スロットのうち depthFrac が最大の SUPPORT_RUNNER_COUNT 人
 * (同値は小さい slotIndex 優先)。フォーメーションごとの定数なので毎tickの割り当て計算も
 * 変動も一切ない (churn の構造的排除)。キャリアの除外は不要: キャリアは human/CPU 分岐が
 * 先勝ちして teamAI 駆動にならないため、ランナー枠のキャリアの分だけ自然に減る
 * (3枠なので非キャリア2人以上が常に保証される)。
 */
export function isSupportRunner(slotIndex: number, formationId: FormationId): boolean {
  if (slotIndex <= 0 || slotIndex > 10) return false; // GK・範囲外は対象外
  const myDepth = getOutfieldSlotDepthFrac(formationId, slotIndex);
  // 自分より「深い(depthFracが大きい)」または「同深度でindexが小さい」スロットの数を数え、
  // 自分がその順位で SUPPORT_RUNNER_COUNT 以内に入るかを判定する (ソート不要、O(10))。
  let ahead = 0;
  for (let s = 1; s <= 10; s++) {
    if (s === slotIndex) continue;
    const d = getOutfieldSlotDepthFrac(formationId, s);
    if (d > myDepth || (d === myDepth && s < slotIndex)) ahead++;
  }
  return ahead < SUPPORT_RUNNER_COUNT;
}

/**
 * サポートランナーのホーム目標点。
 * - 深度(Y): max(ラインホームの深度, 量子化ボール深度 + SUPPORT_AHEAD_STANDOFF)。
 *   ライン押し上げの「ボール後方150px」をランナーだけ反転し「ボール前方100px」を狙う。
 *   max() により「ラインホームより後ろには行かない」を保証 (押し上げの前進不変条件を維持)。
 *   ボール深度は LINE_FOLLOW_GRID(32px) で量子化 (ラインと同じ、毎tick追随の防止)。
 * - 幅(X): 最寄りの味方 (48px²バケット距離、同値index小) が SUPPORT_SPACING_RADIUS 以内なら
 *   その味方と逆側へ SUPPORT_SPREAD_OFFSET ずらす (密集の解消)。最終Xは
 *   SUPPORT_X_GRID(24px、< ホームdeadzone 28px) に量子化してピッチ内にクランプする。
 */
export function computeSupportHomePosition(
  player: PlayerState,
  players: readonly PlayerState[],
  lineHome: Vec2Fixed,
  ballPos: Vec2Fixed,
  half: Half,
): Vec2Fixed {
  const team = player.team;

  // --- 深度: ボール前方への走り込み ---
  const grid = LINE_FOLLOW_GRID_FIXED as number;
  const rawBallDepth = depthFromOwnGoal(team, half, ballPos.y) as number;
  const ballDepth = Math.floor(rawBallDepth / grid) * grid;
  const lineHomeDepth = depthFromOwnGoal(team, half, lineHome.y) as number;
  // 上限クランプ: 相手ボックス縁より先へは走り込まない (ピッチ外目標とゴール前密集の防止)
  const supportDepth = Math.min(
    Math.max(lineHomeDepth, ballDepth + (SUPPORT_AHEAD_STANDOFF_FIXED as number)),
    SUPPORT_MAX_DEPTH_FIXED as number,
  ) as Fixed;

  // --- 幅: 最寄り味方からの離隔 ---
  let nearestIdx: number | null = null;
  let nearestBucket = Infinity;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p || p === player || p.team !== team) continue;
    const bucket = Math.floor((distSqFixed(p.pos, player.pos) as number) / DIST_BUCKET_SQ);
    if (bucket < nearestBucket) {
      nearestBucket = bucket; // 昇順走査 + strict < なので同バケットはindex小が勝つ
      nearestIdx = i;
    }
  }

  let targetX = lineHome.x as number;
  // バケット下端の距離二乗としきい値の比較 (量子化してから比較、実効半径 ≈ 68px)
  if (nearestIdx !== null && nearestBucket * DIST_BUCKET_SQ < (SUPPORT_SPACING_SQ_FIXED as number)) {
    const xGrid = SUPPORT_X_GRID_FIXED as number;
    const myQx = Math.floor((player.pos.x as number) / xGrid);
    const otherQx = Math.floor((players[nearestIdx]!.pos.x as number) / xGrid);
    // 味方と逆側へずらす。量子化X座標が同一なら、ホームがピッチ中央より左なら左へ、右なら右へ
    // (どちらの選手から見ても同じ答えになる、位置に依存しない決定論的タイブレーク)。
    const away =
      myQx !== otherQx
        ? Math.sign(myQx - otherQx)
        : (lineHome.x as number) < toFixed(PITCH_WIDTH / 2)
          ? -1
          : 1;
    targetX = (lineHome.x as number) + away * (SUPPORT_SPREAD_OFFSET_FIXED as number);
  }

  // 最終Xを量子化し、ピッチ内 (両端24pxマージン) にクランプする
  const xGrid = SUPPORT_X_GRID_FIXED as number;
  const quantizedX = Math.floor(targetX / xGrid) * xGrid;
  const minX = toFixed(24) as number;
  const maxX = toFixed(PITCH_WIDTH - 24) as number;
  const clampedX = Math.min(Math.max(quantizedX, minX), maxX) as Fixed;

  return { x: clampedX, y: depthToY(team, half, supportDepth) };
}
