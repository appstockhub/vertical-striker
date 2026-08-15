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

/**
 * 発動/成功に必要な間合い (px、二乗も保存)。
 *
 * ★重要なバグ修正 (実プレイ報告「スライディングもない」の主因)★
 * 旧値16pxは選手の当たり半径(10px)の2倍未満、つまり**2人が重なるほど密着していないと
 * 成立しない**距離だった。さらに旧スライド速度3.6に対し逃げる相手は3.0で、詰められるのは
 * 0.6px/tick。Active(10tick)では6pxしか詰まらず、少しでも離れていると構造的に絶対届かない。
 * 計測でも「発動はするが一度も奪えない」が再現した。
 *
 * 36px = 選手直径(20px)+スライドで足を伸ばす距離、という現実的なリーチにする。
 * あわせてスライド速度を上げ(下記)、Active中に実際に追いつけるようにした。
 */
export const TACKLE_RANGE_FIXED: Fixed = toFixed(36);
export const TACKLE_RANGE_SQ_FIXED: Fixed = fixedMul(TACKLE_RANGE_FIXED, TACKLE_RANGE_FIXED);

/** 「背後から同方向」判定のコーンしきい値 cos^2 (仮値、広めの約63°)。sqrtを使わずdot^2で判定する。 */
export const TACKLE_CONE_COS_THRESHOLD_SQ_FIXED: Fixed = toFixed(0.2);

/**
 * Active中のスライド移動速度 (px/tick)。旧値3.6は通常移動(3.0)とほぼ同じで、
 * 逃げる相手に追いつけなかった (上記TACKLE_RANGE_FIXEDのコメント参照)。
 * 滑り込みは走るより明確に速い、という実感が出る6.0にする。
 */
export const TACKLE_SLIDE_SPEED_FIXED: Fixed = toFixed(6.0);
/** Recovery中の移動速度 (px/tick, 仮値。通常よりかなり遅い「鈍足」)。 */
export const TACKLE_RECOVERY_SPEED_FIXED: Fixed = toFixed(1.2);
/** 成功時にボールへ与える速度 (px/tick, 仮値)。ドリブルタッチと同じ「上書き」方式で奪う。 */
export const TACKLE_WIN_SPEED_FIXED: Fixed = toFixed(3.8);

// ============================================================================
// ショルダーチャージ (続編仕様、Y または X)。実プレイ報告「チャージもない」への対応で新設。
// 12周目までは完全に未実装だった (相手保持中のYは何にも割り当てられていなかった)。
//
// スライディング(B)との設計上の対比:
//   スライディング = 溜め6f/判定10f/隙20f、リーチ長い、外すと大きな隙 = ハイリスク
//   ショルダーチャージ = 溜め無しで即時判定、リーチ短い、隙も小さい = 低リスク低リターン
// これにより「間合いが遠いならスライディング、密着しているならチャージ」の使い分けが生まれる。
// ============================================================================

/**
 * チャージが届く間合い (px、二乗も保存)。肩で当たる距離なのでスライディング(36px)より短い。
 * 選手の当たり半径が10pxなので、肩を並べた状態=中心間20px。そこから少し踏み込んで
 * ぶつかれる範囲として30pxにする (24pxだと「密着して初めて出る」に近く、実プレイで
 * 押しても出ないことが多い)。
 */
export const CHARGE_RANGE_FIXED: Fixed = toFixed(30);
export const CHARGE_RANGE_SQ_FIXED: Fixed = fixedMul(CHARGE_RANGE_FIXED, CHARGE_RANGE_FIXED);

/** チャージ成功時にボールへ与える速度 (px/tick)。押し出す動作なのでスライディングより弱め。 */
export const CHARGE_WIN_SPEED_FIXED: Fixed = toFixed(3.0);

/** チャージ後の隙 (フレーム)。スライディングの隙(20f)よりずっと短い = 連打はできるが低リターン。 */
export const CHARGE_RECOVERY_FRAMES = 8;
