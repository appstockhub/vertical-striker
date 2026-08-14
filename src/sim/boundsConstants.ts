import { toFixed } from '../core/fixed';
import type { Fixed } from '../core/types';

/**
 * 境界越え(スローイン/ゴールキック/コーナーキック/得点)関連の定数。すべて仮値
 * (要プレイテスト調整)。sim/bounds.ts から使う。
 */

/** スローイン復帰位置の、サイドラインからのx方向の余白 (px)。 */
export const THROW_IN_INSET_FIXED: Fixed = toFixed(15);

/** スローイン復帰位置の、ゴールライン際を避けるためのyのクランプ余白 (px)。 */
export const THROW_IN_Y_MARGIN_FIXED: Fixed = toFixed(40);

/** ゴールキック復帰位置の、自陣ゴールラインからの深さ (px)。xはゴール中央固定。 */
export const GOAL_KICK_DEPTH_FIXED: Fixed = toFixed(60);

/** コーナーキック復帰位置の、コーナーフラッグからのx/y余白 (px)。 */
export const CORNER_INSET_FIXED: Fixed = toFixed(12);

/** クロスバー相当の高さ (px)。ボールの height がこれ以下でゴール幅内を通過した場合のみ得点。 */
export const CROSSBAR_HEIGHT_FIXED: Fixed = toFixed(5);

/**
 * ゴールキック時、相手フィールドプレイヤーが再開側ゴールラインからこれ未満の距離にいる場合、
 * この距離まで押し出す (px、仮値)。実サッカーの「ゴールキック時は相手はペナルティエリア外」の
 * 最小近似。即時テレポート復帰の設計では、これが無いと相手のプレスが再開スポットに張り付いて
 * ゴールキックを毎回奪う「リスタート・キャンプ」が成立してしまう (観戦シミュレーターで発覚)。
 */
export const GOAL_KICK_EXCLUSION_DEPTH_FIXED: Fixed = toFixed(250);
