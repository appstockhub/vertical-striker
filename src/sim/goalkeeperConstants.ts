import { fixedMul, toFixed } from '../core/fixed';
import type { Fixed } from '../core/types';
import { PITCH_WIDTH } from '../config/pitch';
import { BALL_TEMPO, RUN_TEMPO } from './tempo';

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
export const GK_AUTO_SPEED_FIXED: Fixed = toFixed(2.2 * RUN_TEMPO);

/** ボールがこの範囲に入ると Team A GK へ自動的に手動操作が移る (px, 仮値)。 */
export const GK_AUTO_TAKEOVER_RADIUS_FIXED: Fixed = toFixed(120);
export const GK_AUTO_TAKEOVER_RADIUS_SQ_FIXED: Fixed = fixedMul(
  GK_AUTO_TAKEOVER_RADIUS_FIXED,
  GK_AUTO_TAKEOVER_RADIUS_FIXED,
);

/**
 * キャッチ (Y) が届く範囲 (px)。
 * 旧値14pxは、強シュート(9px/tick)が範囲内に居るのが実質1〜2tickしかなく、
 * 「反応する隙が無いうちに通過する」状態だった。ボール半径(7)+GKの腕のリーチ、として
 * 20pxに広げる (パンチングの30pxより短い、という関係は維持)。
 */
export const CATCH_RANGE_FIXED: Fixed = toFixed(20);
export const CATCH_RANGE_SQ_FIXED: Fixed = fixedMul(CATCH_RANGE_FIXED, CATCH_RANGE_FIXED);

/**
 * キャッチで確保できる上限速度 (px/tick)。これを超える速いボールは弾いてしまう。
 *
 * ★重要なバグ修正 (実プレイ報告「キーパーはキャッチしない」の直接原因)★
 * 旧値7は STRONG_KICK_SPEED_FIXED(9) より小さかった。つまり**まともなシュートは
 * 100%「弾く」に分岐し、キャッチという操作が構造的に一度も成立しない**状態だった。
 * CLAUDE.mdの「速いボールはキャッチを試みても弾いてしまう」という意図自体は正しいが、
 * その閾値は強キック速度より「上」に置かないと、意図した読み合いではなく単なる死に機能になる。
 *
 * 9.5 = 強キック(9)をわずかに上回る値。これにより:
 * - 素の強シュート/減速したシュート → キャッチできる (確保して攻撃に移れる)
 * - 至近距離からの強シュートや、カーブ/シフトで速度が乗ったボール → 弾く
 * という「ギリギリなら弾く」設計本来の読み合いが実際に発生する。
 */
export const CATCH_MAX_SPEED_FIXED: Fixed = toFixed(9.5 * BALL_TEMPO);

/**
 * パンチング (B) が届く範囲 (px。キャッチより長い)。この範囲=セーブ文脈に入る外縁でもある。
 * 旧値24pxは、9px/tickのシュートに対し反応可能時間が短すぎたため30pxへ広げた。
 */
export const PUNCH_RANGE_FIXED: Fixed = toFixed(30);
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
export const SAVE_CONTEXT_MIN_BALL_SPEED_FIXED: Fixed = toFixed(4.5 * BALL_TEMPO);
export const SAVE_CONTEXT_MIN_BALL_SPEED_SQ_FIXED: Fixed = fixedMul(
  SAVE_CONTEXT_MIN_BALL_SPEED_FIXED,
  SAVE_CONTEXT_MIN_BALL_SPEED_FIXED,
);
