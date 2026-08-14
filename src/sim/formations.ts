import { fixedSub, toFixed } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';

export enum TeamId {
  A = 0,
  B = 1,
}

/** 1チームあたりの人数 (GK含む)。他モジュールからも参照する共通定数。 */
export const PLAYERS_PER_TEAM = 11;
/** 1チームあたりのフィールドプレイヤー数 (GK除く)。 */
export const OUTFIELD_PER_TEAM = 10;

/** 前半=1、後半=2。Phase 3 でサイドチェンジ(攻守交代)を表現するために導入。 */
export type Half = 1 | 2;

/**
 * フォーメーション定義。CLAUDE.md には「4-4-2, 4-3-3, 3-5-2, 5-3-2 など」と名称のみ
 * 記載があり、数値レイアウトの指定は無いため、以下はすべて仮値 (要プレイテスト調整)。
 *
 * 座標系: xFrac は 0..1 でピッチ幅を横断 (両チーム共通、鏡合わせしない)。
 * depthFrac は 0=自陣ゴールライン、1=自陣ハーフのハーフウェーライン側。
 * どちらのチームがどちらの端 (y=0側="北" / y=PITCH_HEIGHT側="南") を守るかは
 * `teamDefendsNorth(team, half)` に一本化する。前半はTeam Aが南(y大きい)側、
 * Team Bが北側を守る (Phase 0-2 の固定配置と同じ)。後半はこれが入れ替わる。
 */
export enum FormationId {
  F442 = '4-4-2',
  F433 = '4-3-3',
  F352 = '3-5-2',
  F532 = '5-3-2',
}

export interface FormationSlot {
  readonly xFrac: number;
  readonly depthFrac: number;
}

export interface Formation {
  readonly gk: FormationSlot;
  /** 必ず10要素、DF→MF→FW の順。 */
  readonly outfieldSlots: readonly FormationSlot[];
}

const GK_SLOT: FormationSlot = { xFrac: 0.5, depthFrac: 0.04 };

const FORMATIONS: Readonly<Record<FormationId, Formation>> = {
  [FormationId.F442]: {
    gk: GK_SLOT,
    outfieldSlots: [
      { xFrac: 0.15, depthFrac: 0.18 },
      { xFrac: 0.38, depthFrac: 0.18 },
      { xFrac: 0.62, depthFrac: 0.18 },
      { xFrac: 0.85, depthFrac: 0.18 },
      { xFrac: 0.15, depthFrac: 0.55 },
      { xFrac: 0.38, depthFrac: 0.55 },
      { xFrac: 0.62, depthFrac: 0.55 },
      { xFrac: 0.85, depthFrac: 0.55 },
      { xFrac: 0.35, depthFrac: 0.85 },
      { xFrac: 0.65, depthFrac: 0.85 },
    ],
  },
  [FormationId.F433]: {
    gk: GK_SLOT,
    outfieldSlots: [
      { xFrac: 0.15, depthFrac: 0.18 },
      { xFrac: 0.38, depthFrac: 0.18 },
      { xFrac: 0.62, depthFrac: 0.18 },
      { xFrac: 0.85, depthFrac: 0.18 },
      { xFrac: 0.25, depthFrac: 0.5 },
      { xFrac: 0.5, depthFrac: 0.5 },
      { xFrac: 0.75, depthFrac: 0.5 },
      { xFrac: 0.15, depthFrac: 0.85 },
      { xFrac: 0.5, depthFrac: 0.85 },
      { xFrac: 0.85, depthFrac: 0.85 },
    ],
  },
  [FormationId.F352]: {
    gk: GK_SLOT,
    outfieldSlots: [
      { xFrac: 0.25, depthFrac: 0.18 },
      { xFrac: 0.5, depthFrac: 0.18 },
      { xFrac: 0.75, depthFrac: 0.18 },
      { xFrac: 0.1, depthFrac: 0.5 },
      { xFrac: 0.3, depthFrac: 0.5 },
      { xFrac: 0.5, depthFrac: 0.5 },
      { xFrac: 0.7, depthFrac: 0.5 },
      { xFrac: 0.9, depthFrac: 0.5 },
      { xFrac: 0.35, depthFrac: 0.85 },
      { xFrac: 0.65, depthFrac: 0.85 },
    ],
  },
  [FormationId.F532]: {
    gk: GK_SLOT,
    outfieldSlots: [
      { xFrac: 0.1, depthFrac: 0.15 },
      { xFrac: 0.3, depthFrac: 0.15 },
      { xFrac: 0.5, depthFrac: 0.15 },
      { xFrac: 0.7, depthFrac: 0.15 },
      { xFrac: 0.9, depthFrac: 0.15 },
      { xFrac: 0.25, depthFrac: 0.5 },
      { xFrac: 0.5, depthFrac: 0.5 },
      { xFrac: 0.75, depthFrac: 0.5 },
      { xFrac: 0.35, depthFrac: 0.85 },
      { xFrac: 0.65, depthFrac: 0.85 },
    ],
  },
};

/**
 * このチームが「北」(y=0側) を守るかどうか。team→陣地のハードコードをここに一本化する。
 * 前半: Team A が南(y大きい)側、Team B が北側 (Phase 0-2 の固定配置と同じ)。後半は入れ替わる。
 */
export function teamDefendsNorth(team: TeamId, half: Half): boolean {
  return half === 1 ? team === TeamId.B : team === TeamId.A;
}

function slotToWorld(team: TeamId, half: Half, slot: FormationSlot): Vec2Fixed {
  const x = toFixed(slot.xFrac * PITCH_WIDTH);
  // 北を守るチーム: depthFrac 0 -> y=0 (自陣ゴールライン), 1 -> y=PITCH_HEIGHT/2 (ハーフウェー)
  // 南を守るチーム: depthFrac 0 -> y=PITCH_HEIGHT,          1 -> y=PITCH_HEIGHT/2
  const y = teamDefendsNorth(team, half)
    ? slot.depthFrac * (PITCH_HEIGHT / 2)
    : PITCH_HEIGHT - slot.depthFrac * (PITCH_HEIGHT / 2);
  return { x, y: toFixed(y) };
}

/**
 * 選手のホームポジションを求める純関数。GameState には持たず毎tick再計算する
 * (team + slotIndex + formationId + half から一意に決まるため、キャッシュ不要な軽さ)。
 * slotIndex: 0=GK, 1..10=outfieldSlots[0..9]。
 */
export function getHomePosition(
  team: TeamId,
  slotIndex: number,
  formationId: FormationId,
  half: Half,
): Vec2Fixed {
  const formation = FORMATIONS[formationId];
  const slot = slotIndex === 0 ? formation.gk : formation.outfieldSlots[slotIndex - 1];
  if (!slot) {
    throw new Error(`invalid slotIndex ${slotIndex} for formation ${formationId}`);
  }
  return slotToWorld(team, half, slot);
}

/** チームの攻撃方向 (自陣→相手陣への単位ベクトルの向き、Direction8 表現)。オフサイドライン計算等で使う。 */
export function attackingIsUpward(team: TeamId, half: Half): boolean {
  return !teamDefendsNorth(team, half); // 北を守るチームは南(下)へ攻める、その逆は北(上)へ攻める
}

/**
 * 自陣ゴールからの深さ (小さいほど自陣ゴールに近い)。オフサイドライン計算 (teamAI.ts) で使う。
 */
export function depthFromOwnGoal(team: TeamId, half: Half, y: Fixed): Fixed {
  return teamDefendsNorth(team, half) ? y : fixedSub(toFixed(PITCH_HEIGHT), y);
}
