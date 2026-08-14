import { fixedSub, toFixed } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';

export enum TeamId {
  A = 0,
  B = 1,
}

/**
 * フォーメーション定義。CLAUDE.md には「4-4-2, 4-3-3, 3-5-2, 5-3-2 など」と名称のみ
 * 記載があり、数値レイアウトの指定は無いため、以下はすべて仮値 (要プレイテスト調整)。
 *
 * 座標系: xFrac は 0..1 でピッチ幅を横断 (両チーム共通、鏡合わせしない)。
 * depthFrac は 0=自陣ゴールライン、1=自陣ハーフのハーフウェーライン側。
 * Team A は y の大きい側 (Phase 1 初期配置 y=PITCH_HEIGHT*0.75, facing Up と整合) を守り
 * y=0 方向に攻める。Team B はその鏡像 (y の小さい側を守り、y=PITCH_HEIGHT 方向に攻める)。
 * この対応は状態に持たず、コード上の固定規約とする (前後半の攻守交代は Phase 3 以降)。
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

function slotToWorld(team: TeamId, slot: FormationSlot): Vec2Fixed {
  const x = toFixed(slot.xFrac * PITCH_WIDTH);
  // Team A: depthFrac 0 -> y=PITCH_HEIGHT (自陣ゴールライン), 1 -> y=PITCH_HEIGHT/2 (ハーフウェー)
  // Team B: depthFrac 0 -> y=0,             1 -> y=PITCH_HEIGHT/2
  const y =
    team === TeamId.A
      ? PITCH_HEIGHT - slot.depthFrac * (PITCH_HEIGHT / 2)
      : slot.depthFrac * (PITCH_HEIGHT / 2);
  return { x, y: toFixed(y) };
}

/**
 * 選手のホームポジションを求める純関数。GameState には持たず毎tick再計算する
 * (team + slotIndex + formationId から一意に決まるため、キャッシュ不要な軽さ)。
 * slotIndex: 0=GK, 1..10=outfieldSlots[0..9]。
 */
export function getHomePosition(team: TeamId, slotIndex: number, formationId: FormationId): Vec2Fixed {
  const formation = FORMATIONS[formationId];
  const slot = slotIndex === 0 ? formation.gk : formation.outfieldSlots[slotIndex - 1];
  if (!slot) {
    throw new Error(`invalid slotIndex ${slotIndex} for formation ${formationId}`);
  }
  return slotToWorld(team, slot);
}

/** チームの攻撃方向 (自陣→相手陣への単位ベクトルの向き、Direction8 表現)。オフサイドライン計算等で使う。 */
export function attackingIsUpward(team: TeamId): boolean {
  return team === TeamId.A; // Team A は y=0 方向 (上) へ攻める
}

/**
 * 自陣ゴールからの深さ (小さいほど自陣ゴールに近い)。オフサイドライン計算 (teamAI.ts) で使う。
 * Team A の自陣ゴールは y=PITCH_HEIGHT 側、Team B は y=0 側。
 */
export function depthFromOwnGoal(team: TeamId, y: Fixed): Fixed {
  return team === TeamId.A ? fixedSub(toFixed(PITCH_HEIGHT), y) : y;
}
