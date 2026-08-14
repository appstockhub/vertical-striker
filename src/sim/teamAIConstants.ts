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

/**
 * ボール「追跡権」(computeChaseRightIndices) を持たない選手のボール引力。仮値。
 * 実プレイで「団子サッカー」(ほぼ全員がボールに殺到する) が発覚したため導入。
 * BALL_ATTRACTION_WEIGHT_FIXED(0.9)を全員に適用していた旧実装は、各チームの
 * フィールドプレイヤー全員がAI_HOME_LEASH_SQ_FIXEDのリーシュ内であればボールへ
 * 収束してしまっていた。追跡権を持つ選手(チームごとに最寄り+カバー
 * CHASE_RIGHT_HOLDERS_PER_TEAM人)だけがBALL_ATTRACTION_WEIGHT_FIXEDのフル引力を
 * 使い、それ以外はこの弱い値を使うことで、HOME_PULL_WEIGHT_NEAR_FIXED(0.5)が
 * 優位になり(ライン調整された)ホームポジション優先でスペースを守るようにする。
 */
export const BALL_ATTRACTION_WEIGHT_NON_CHASER_FIXED: Fixed = toFixed(0.15);

/** 各チームでボール追跡権を持つ人数 (最寄り+カバー)。仮値、Phase 4調整を見込んでパラメータ化。 */
export const CHASE_RIGHT_HOLDERS_PER_TEAM = 2;

/**
 * 追跡権を持つ選手がこの距離(px、仮値)以内までボールに近づいたら「最終アプローチ」とみなし、
 * ボール引力を BALL_ATTRACTION_WEIGHT_CLOSE_RANGE_FIXED まで引き上げてホーム復元力を
 * 実質無視させる。8方向に量子化した各項を重み付け合成する既存方式は、目標が斜め方向にある
 * 場合などにホーム/ボール成分が軸ごとに打ち消し合い、本来ボールに向かうべきなのに合成方向が
 * それてしまい、ボールの手前20〜30px程度で選手が永久に足踏みする問題が実プレイ相当のテストで
 * 発覚した。ボールにこれだけ近ければホームポジションを気にする理由が薄いという前提で、
 * 最終接近時のみ引力を圧倒的に優勢にすることでこれを回避する。
 */
export const BALL_CLOSE_RANGE_RADIUS_FIXED: Fixed = toFixed(80);
export const BALL_CLOSE_RANGE_SQ_FIXED: Fixed = fixedMul(BALL_CLOSE_RANGE_RADIUS_FIXED, BALL_CLOSE_RANGE_RADIUS_FIXED);
export const BALL_ATTRACTION_WEIGHT_CLOSE_RANGE_FIXED: Fixed = toFixed(3.0);

/**
 * ホーム復元力の「近傍」→「遠方」の遷移をこの2つの半径 (px、仮値) の間で線形に滑らかに行う。
 * NEAR以内は完全にHOME_PULL_WEIGHT_NEAR_FIXED、FAR以遠は完全にHOME_PULL_WEIGHT_FAR_FIXED、
 * 間は距離の二乗に対して線形補間する。
 *
 * バグ修正 (実プレイで発覚): 単一のしきい値でnear/farを瞬時に切り替える旧実装は、
 * 選手がちょうどそのしきい値の距離に留まる状況で「1tick外側にいる間はFAR判定でホームへ
 * 戻る1歩→ちょうどNEAR判定に戻る→ボール引力でまた1歩ホームから離れる→再びFAR判定…」
 * という完全な振動(チャタリング)に陥り、見た目上ボールにも家にも永久に到達できない
 * (=実質的な凍結と見分けがつかない)不具合があった。しきい値を滑らかな帯に広げることで、
 * 境界を跨いでも力の向きが急反転しないようにし、この振動を構造的に起こらなくする。
 */
export const AI_HOME_LEASH_RAMP_NEAR_RADIUS_FIXED: Fixed = toFixed(180);
export const AI_HOME_LEASH_RAMP_FAR_RADIUS_FIXED: Fixed = toFixed(280);
export const AI_HOME_LEASH_RAMP_NEAR_SQ_FIXED: Fixed = fixedMul(
  AI_HOME_LEASH_RAMP_NEAR_RADIUS_FIXED,
  AI_HOME_LEASH_RAMP_NEAR_RADIUS_FIXED,
);
export const AI_HOME_LEASH_RAMP_FAR_SQ_FIXED: Fixed = fixedMul(
  AI_HOME_LEASH_RAMP_FAR_RADIUS_FIXED,
  AI_HOME_LEASH_RAMP_FAR_RADIUS_FIXED,
);

/**
 * チームライン引き下げ(相手が保持中のホームポジション後退、computeLineAdjustedHomePosition)の
 * 追従率に掛ける減衰係数。仮値。1.0(減衰無し)だとAI_HOME_LEASH_SQ_FIXEDによる
 * 「ホーム近傍でのボール追跡」との相乗効果で、守備側の選手がどれだけホームから離れていても
 * 常にボールとほぼ同じ深さまで一斉に引き寄せられてしまい、実質的に全員でボールを取り囲む
 * 過剰収束が起きる (実プレイ相当のテストで発覚)。押し上げ側(自チーム保持中)は減衰させない
 * (要求どおりの「攻撃時はしっかり押し上げる」を保つため)。
 */
export const LINE_RETREAT_DAMPING_FIXED: Fixed = toFixed(0.45);

/**
 * 現在向いている方向(前tickで実際に選んだ方向)へ加える小さなバイアス。仮値。
 * 目標方向が隣り合う2つの8方向のちょうど境界付近にある場合、バイアス無しだと
 * 選手の位置がわずかに動くたびargmaxの勝者が入れ替わり、2方向を永久に往復する
 * チャタリング(実質的な凍結と見分けがつかない)に陥る不具合が実プレイで発覚したため導入。
 * AI_FINAL_DEADZONE_SQ_FIXEDより十分大きくし、単独では静止判定を妨げない値にすること。
 */
export const STICKY_FACING_BIAS_FIXED: Fixed = toFixed(0.15);

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
