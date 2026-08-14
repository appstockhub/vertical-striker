import { fixedMul, toFixed } from '../core/fixed';
import type { Fixed } from '../core/types';
import { PITCH_WIDTH } from '../config/pitch';

/**
 * キーパーAI関連の定数。すべて仮値 (要プレイテスト調整)。
 * ゴールマウス幾何参照 (GKの位置取り判定・sim/bounds.tsの得点判定の両方から使う)。
 */
export const GOAL_WIDTH_FIXED: Fixed = toFixed(80);
export const GOAL_HALF_WIDTH_FIXED: Fixed = fixedMul(GOAL_WIDTH_FIXED, toFixed(0.5));

/** ゴールマウス中心のx座標 (ピッチ幅の中央、両ゴール共通)。 */
export const GOAL_CENTER_X_FIXED: Fixed = toFixed(PITCH_WIDTH / 2);

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

/**
 * セーブ文脈が発動する最低ボール速度 (px/tick, 仮値)。これ以下の遅い/静止したボールが
 * GKの足元にある時は通常のキック文脈のままにする。
 *
 * バグ修正 (観戦シミュレーターで発覚): 速度条件なしだと、GKが確保した/足元に転がってきた
 * ボールに対して B=パンチング(速度0なので何も起きない)・Y=キャッチ(再確保)しか
 * できず、**GKは静止ボールを永遠に蹴れない** (チャージキックはセーブ文脈に奪われる)。
 * 人間プレイヤーがGKでボールを拾うと詰む、実プレイに直結する欠陥だった。
 * ドリブルタッチ速度(3.6)より上・強シュート(9)より下の4.5に設定し、
 * 「飛んでくるボールにはセーブ、収めたボールにはキック」を自然に切り分ける。
 */
export const SAVE_CONTEXT_MIN_BALL_SPEED_FIXED: Fixed = toFixed(4.5);
export const SAVE_CONTEXT_MIN_BALL_SPEED_SQ_FIXED: Fixed = fixedMul(
  SAVE_CONTEXT_MIN_BALL_SPEED_FIXED,
  SAVE_CONTEXT_MIN_BALL_SPEED_FIXED,
);
