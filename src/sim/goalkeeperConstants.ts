import { fixedMul, toFixed } from '../core/fixed';
import type { Fixed } from '../core/types';

/**
 * キーパーAI関連の定数。すべて仮値 (要プレイテスト調整)。
 * 得点処理を伴わない最小限のゴールマウス幾何参照 (Phase 3のルール実装を前倒ししない、
 * GKの位置取り判定にのみ使う座標参照)。
 */
export const GOAL_WIDTH_FIXED: Fixed = toFixed(80);

/** 自動モードでのゴールライン上の左右可動範囲 (px, 仮値。ゴール幅の半分よりやや広め)。 */
export const GK_COVERAGE_RADIUS_FIXED: Fixed = toFixed(45);

/** 自動モードでのキーパー移動速度 (px/tick, 仮値)。PLAYER_SPEED(3.0)よりやや遅く「反応速度」を表現する。 */
export const GK_AUTO_SPEED_FIXED: Fixed = toFixed(2.2);

/** ボールがこの範囲に入ると Team A GK へ自動的に手動操作が移る (px, 仮値)。 */
export const GK_AUTO_TAKEOVER_RADIUS_FIXED: Fixed = toFixed(120);
export const GK_AUTO_TAKEOVER_RADIUS_SQ_FIXED: Fixed = fixedMul(
  GK_AUTO_TAKEOVER_RADIUS_FIXED,
  GK_AUTO_TAKEOVER_RADIUS_FIXED,
);

/** キャッチ (Y) が届く範囲 (px, 仮値。短い)。 */
export const CATCH_RANGE_FIXED: Fixed = toFixed(14);
export const CATCH_RANGE_SQ_FIXED: Fixed = fixedMul(CATCH_RANGE_FIXED, CATCH_RANGE_FIXED);

/** キャッチで確保できる上限速度 (px/tick, 仮値)。これを超える速いボールは弾いてしまう。 */
export const CATCH_MAX_SPEED_FIXED: Fixed = toFixed(7);

/** パンチング (B) が届く範囲 (px, 仮値。キャッチより長い)。この範囲=セーブ文脈に入る外縁でもある。 */
export const PUNCH_RANGE_FIXED: Fixed = toFixed(24);
export const PUNCH_RANGE_SQ_FIXED: Fixed = fixedMul(PUNCH_RANGE_FIXED, PUNCH_RANGE_FIXED);

/** Y/Bがキャッチ/パンチングの文脈になる外縁 (パンチング届く範囲と同じにする)。 */
export const GK_SAVE_RANGE_SQ_FIXED: Fixed = PUNCH_RANGE_SQ_FIXED;
