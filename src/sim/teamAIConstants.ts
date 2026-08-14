import { fixedMul, toFixed } from '../core/fixed';
import type { Fixed } from '../core/types';

/**
 * 非操作選手AIの重み付きベクトル合成に使う定数。すべて仮値 (要プレイテスト調整)。
 * 「ホームポジションへの復元力 + ボール位置への引力 + オフサイドライン意識」の3項を
 * それぞれ8方向に量子化してから重み付けする (CLAUDE.md Phase 2 箇条書き参照)。
 *
 * ホームポジションへの復元力は距離に応じた2段階 (near/far) にする (バグ修正、下記参照)。
 * 旧実装は距離によらず常にHOME_PULL_WEIGHT=1.0固定 (deadzone外は常にフル強度) だったため、
 * ボールがホームと反対方向にある場合、ホーム項(weight 1.0)がボール項(weight 0.6)を
 * ほぼ常に上回り、非操作選手がホームのすぐ外側(deadzone半径付近)で実質的に凍結し、
 * ボールを追いかけられない不具合があった (実プレイで発覚、Phase 3で確認・修正)。
 * ホーム近傍ではホームの復元力を弱くしてボール引力を優位にし (追跡を許可)、
 * リーシュ半径を越えて離れた場合のみホームの復元力を強くして呼び戻す、という
 * 2段階のヒステリシス無し閾値で対処する (sqrt/三角関数は使わず距離の二乗のみで判定)。
 */
export const HOME_PULL_WEIGHT_NEAR_FIXED: Fixed = toFixed(0.5);
export const HOME_PULL_WEIGHT_FAR_FIXED: Fixed = toFixed(2.5);
export const BALL_ATTRACTION_WEIGHT_FIXED: Fixed = toFixed(0.9);
export const OFFSIDE_BIAS_WEIGHT_FIXED: Fixed = toFixed(0.8);

/** ホームポジションからのこの距離(px、仮値)以内なら「近傍」= 復元力を弱めてボール追跡を許可する。
 * 越えると「遠方」= 復元力を強めて呼び戻す (チーム全体がボールへ収束するのを防ぐ)。 */
export const AI_HOME_LEASH_RADIUS_FIXED: Fixed = toFixed(220);
export const AI_HOME_LEASH_SQ_FIXED: Fixed = fixedMul(AI_HOME_LEASH_RADIUS_FIXED, AI_HOME_LEASH_RADIUS_FIXED);

/** ホームポジションにこの距離以内なら「到着済み」とみなし復元力を0にする (px, 仮値、二乗)。 */
export const AI_HOME_DEADZONE_SQ_FIXED: Fixed = fixedMul(toFixed(4), toFixed(4));
/** ボールにこの距離以内なら引力を0にする (px, 仮値、二乗)。 */
export const AI_BALL_DEADZONE_SQ_FIXED: Fixed = fixedMul(toFixed(2), toFixed(2));
/**
 * 合成後ベクトルの最終量子化デッドゾーン (仮値、二乗)。ほぼ全項が打ち消し合った場合にのみ
 * 静止させる、という「打ち消し合い検知」専用の閾値であるべき。HOME_PULL_WEIGHT_NEAR_FIXED
 * 単独 (他項がdeadzoneでNoneの場合) でもこの閾値を必ず上回るよう、十分小さい値にすること
 * (バグ修正: 旧値0.5はHOME_PULL_WEIGHT_NEAR_FIXED=0.3を上回ってしまい、ホーム項が唯一の
 * 有効項でも静止扱いになり、非操作選手がホームへ戻れなくなる不具合があった)。
 */
export const AI_FINAL_DEADZONE_SQ_FIXED: Fixed = fixedMul(toFixed(0.05), toFixed(0.05));
