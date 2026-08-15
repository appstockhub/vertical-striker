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

/**
 * スローイン/コーナーキック時、相手フィールドプレイヤーが再開スポットからこれ未満の
 * 距離にいる場合、この距離まで押し出す (px、仮値)。ゴールキックのY軸ライン除外
 * (GOAL_KICK_EXCLUSION_DEPTH_FIXED) と違い、スローイン/コーナーはピッチ上の任意の
 * 地点で起きるため、円形(の正方形近似、sqrtを使わない)の除外ゾーンにする。
 * 実サッカーの「相手は9.15m離れる」ルールの近似値。
 */
export const SET_PIECE_EXCLUSION_RADIUS_FIXED: Fixed = toFixed(130);

/**
 * キックオフ時のセンターサークル半径 (px)。競技規則 第8条:
 * 「キックオフを行うチームの相手competitorは、ボールがインプレーになるまで
 *   センターサークル(半径9.15m)の外にいなければならない」。
 *
 * ★16周目に新設★ それまでキックオフには**ルールが一つも実装されておらず**、
 * 得点された側のキックオフでも相手が自由にボールへ突っ込めた (ユーザーの実プレイ報告
 * 「点を決められてこちらのキックオフなのに敵が奪取できる。破綻しているでしょ」)。
 * 値は render/pitchMarkings.ts が描くセンターサークルの半径と一致させてあり、
 * 「描かれている円の外に相手がいる」ことが画面で確認できる。
 */
export const KICKOFF_CIRCLE_RADIUS_FIXED: Fixed = toFixed(68);

/**
 * キックオフのキッカーがボールの手前 (自陣側) に立つ距離 (px)。
 * 競技規則の「すべての競技者は自分のハーフ内に」を満たすため、センターマークより
 * わずかに自陣側へ置く。ドリブル接触距離(12px)より内側なので、そのまま蹴り出せる。
 */
export const KICKOFF_KICKER_STANDOFF_FIXED: Fixed = toFixed(9);

/**
 * セットプレー再開ロックが自動解除されるまでの上限tick数 (180tick = 3秒)。
 *
 * ★観戦シミュレーターで発覚した試合停止バグへの安全網★
 * 旧実装のロックは「ボールが動くまで無期限」だった。キッカーがボールの位置に置かれて
 * いなかった時代は、これが直接「1試合10800tickのうち8045tickがロック中、うち1件の
 * スローインは7466tick(約2分)ボールが1pxも動かない」という試合の死につながっていた
 * (tests/sim/restartTaken.test.ts)。キッカー配置を実装した今でも、人間側の再開で
 * プレイヤーが操作しない場合は同じ停止が起き得るため、上限を設けて必ず試合を再開させる。
 */
export const SET_PIECE_LOCK_MAX_TICKS = 180;
