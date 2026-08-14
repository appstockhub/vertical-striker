import { fixedMul, toFixed } from '../core/fixed';
import type { Fixed } from '../core/types';

/**
 * スライディングタックル関連の定数。すべて仮値 (要プレイテスト調整)。
 * CLAUDE.md にタックルの発動ボタン指定は無いため、Bボタンを文脈的に再利用する
 * (ボール保持中はチャージキック、非保持+ジオメトリ条件成立時はタックル)。
 */

/** 溜め(構え)フレーム数。この間ほぼ動けない。 */
export const TACKLE_WINDUP_FRAMES = 6;
/** 判定が有効なフレーム数。この間、毎tick成功判定を再評価する。 */
export const TACKLE_ACTIVE_FRAMES = 10;
/** 隙 (成功/失敗問わず発生)。この間は鈍足になる。 */
export const TACKLE_RECOVERY_FRAMES = 20;

/** 発動に必要な間合い (px, 仮値、二乗)。 */
export const TACKLE_RANGE_FIXED: Fixed = toFixed(16);
export const TACKLE_RANGE_SQ_FIXED: Fixed = fixedMul(TACKLE_RANGE_FIXED, TACKLE_RANGE_FIXED);

/** 「背後から同方向」判定のコーンしきい値 cos^2 (仮値、広めの約63°)。sqrtを使わずdot^2で判定する。 */
export const TACKLE_CONE_COS_THRESHOLD_SQ_FIXED: Fixed = toFixed(0.2);

/** Active中のスライド移動速度 (px/tick, 仮値。通常移動よりやや速い)。 */
export const TACKLE_SLIDE_SPEED_FIXED: Fixed = toFixed(3.6);
/** Recovery中の移動速度 (px/tick, 仮値。通常よりかなり遅い「鈍足」)。 */
export const TACKLE_RECOVERY_SPEED_FIXED: Fixed = toFixed(1.2);
/** 成功時にボールへ与える速度 (px/tick, 仮値)。ドリブルタッチと同じ「上書き」方式で奪う。 */
export const TACKLE_WIN_SPEED_FIXED: Fixed = toFixed(3.8);
