import { fixedMul, toFixed } from '../core/fixed';
import type { Fixed } from '../core/types';

/**
 * カーソル切替・カーソルパス関連の定数。すべて仮値 (要プレイテスト調整)。
 */

/** 自動追従の切替に必要な「僅差」の下限 (px, 仮値、二乗)。これ未満の差ではフリッカー防止のため切り替わらない。 */
export const CURSOR_HYSTERESIS_MARGIN_SQ_FIXED: Fixed = fixedMul(toFixed(5), toFixed(5));

/** カーソルパスの受け手候補として認める最大距離 (px, 仮値)。 */
export const PASS_MAX_RANGE_FIXED: Fixed = toFixed(220);
export const PASS_MAX_RANGE_SQ_FIXED: Fixed = fixedMul(PASS_MAX_RANGE_FIXED, PASS_MAX_RANGE_FIXED);

/** 前方コーンの半角60°に対応する cos^2(60°) = 0.25 (仮値)。sqrtを使わず dot^2 との比較で判定する。 */
export const PASS_CONE_COS_THRESHOLD_SQ_FIXED: Fixed = toFixed(0.25);
