import { fixedMul, toFixed } from '../core/fixed';
import type { Fixed } from '../core/types';

/**
 * カーソル切替・カーソルパス関連の定数。すべて仮値 (要プレイテスト調整)。
 */

/** 自動追従の切替に必要な「僅差」の下限 (px, 仮値、二乗)。これ未満の差ではフリッカー防止のため切り替わらない。 */
export const CURSOR_HYSTERESIS_MARGIN_SQ_FIXED: Fixed = fixedMul(toFixed(5), toFixed(5));

/**
 * 自動追従の切替に必要な「相対的な近さ」の比 (二乗距離で candidate*NUM < current*DEN、
 * 36:25 = 距離比 5:6 ≈ 候補が17%以上ボールに近いこと)。仮値。
 *
 * バグ修正 (Phase 4、観戦シミュレーターの振動検出で発覚): 上の絶対マージン(5px²)だけでは
 * ボールから遠い時にヒステリシスとして機能しない — 距離200pxでは選手の1tick移動(3px)で
 * 二乗距離が~1200px²も変わり、マージンを毎tick軽々と跨げてしまう。その結果、
 * 「操作中の選手が(守備位置取りで)ボールから離れる方向へ動き、AIの味方がボールへ寄る」
 * という自然な状況で、ほぼ等距離の2人の間をカーソルが毎tick往復し、両者とも
 * 人間入力(離れる)とAI入力(寄る)を交互に受けてその場で振動する限界サイクルに陥っていた
 * (実プレイでは「守備時にカーソルが2人の間で暴れて両方動かなくなる」として体感される)。
 * 距離に比例するこの相対比を追加条件にすることで、切替に必要な差がスケールに追従する。
 */
export const CURSOR_SWITCH_DOMINANCE_NUM = 36;
export const CURSOR_SWITCH_DOMINANCE_DEN = 25;

/** カーソルパスの受け手候補として認める最大距離 (px, 仮値)。 */
export const PASS_MAX_RANGE_FIXED: Fixed = toFixed(220);
export const PASS_MAX_RANGE_SQ_FIXED: Fixed = fixedMul(PASS_MAX_RANGE_FIXED, PASS_MAX_RANGE_FIXED);

/** 前方コーンの半角60°に対応する cos^2(60°) = 0.25 (仮値)。sqrtを使わず dot^2 との比較で判定する。 */
export const PASS_CONE_COS_THRESHOLD_SQ_FIXED: Fixed = toFixed(0.25);
