import { fixedMul, toFixed } from '../core/fixed';
import type { Fixed } from '../core/types';

/**
 * Phase 1 のボール物理・ドリブル・キック関連の定数。
 * すべてプレイテスト前提の仮値 (Phase 0 の PLAYER_SPEED_FIXED 等と同じ扱い)。
 * 実機確認・手触り調整で見直す想定 (CLAUDE.md「要検証仕様」と同種)。
 */

/** ボールの当たり半径 (px, 仮値)。描画スプライトの見た目半径(7px)に合わせた。 */
export const BALL_RADIUS_FIXED: Fixed = toFixed(7);

/**
 * 「このボールに対してプレーできる」間合い (px)。キック/パス/タックル対象判定など、
 * touch-priority 全般の判定半径。
 */
export const DRIBBLE_RADIUS_FIXED: Fixed = toFixed(20);
export const DRIBBLE_RADIUS_SQ_FIXED: Fixed = fixedMul(DRIBBLE_RADIUS_FIXED, DRIBBLE_RADIUS_FIXED);

/**
 * ★重要なバグ修正 (実プレイ報告「キックの反応しない」の主因)★
 * 実際に足がボールに当たって蹴り出す接触半径 (px)。上の DRIBBLE_RADIUS (プレー可能な間合い)
 * より内側にする、という2段構えが必須。
 *
 * 旧実装は「DRIBBLE_RADIUS(20px)以内なら毎tickボール速度を3.6へ上書き」だった。選手速度は
 * 3.0なので、ドリブル中はボールが毎tick 0.6pxずつ確実に前へ逃げていき、約33tick(0.55秒)で
 * 20pxを越えて touch-priority を失う。その結果:
 *   - 走りながらBを押しても「保持していない」判定になりキックが出ない
 *   - キック溜め中に見失うと、update.ts が溜めを無言で破棄する (nextControlledKickChargeFrames=0)
 * という「ボタンが効かない」体験になっていた (計測: 120tickの前進ドリブル中68tickで保持喪失)。
 *
 * 接触半径を内側に置くと「触れる→少し前に転がる→転がり摩擦で減速→選手が追いつく→また触れる」
 * という実際のドリブルのサイクルになり、ボールは 12〜16px の範囲で往復して 20px を越えない。
 * CLAUDE.md「ボールが足元に吸着しすぎない。触れると少し前に転がる」も満たす。
 */
export const DRIBBLE_CONTACT_RADIUS_FIXED: Fixed = toFixed(12);
export const DRIBBLE_CONTACT_RADIUS_SQ_FIXED: Fixed = fixedMul(
  DRIBBLE_CONTACT_RADIUS_FIXED,
  DRIBBLE_CONTACT_RADIUS_FIXED,
);

/**
 * 接触距離より外・プレー可能な間合いの内 (12〜20px) でボールに触れた時に与える速度 (px/tick)。
 *
 * PLAYER_SPEED_FIXED(3.0) より意図的に「わずかに遅く」する。これが
 * 「ボールが永久に逃げる」バグの本質的な修正:
 *   - 足元 (<12px) では 3.6 で前へ転がる → CLAUDE.md「触れると少し前に転がる」を満たす
 *   - 離れかけ (12〜20px) では 2.8 に落ちる → 選手 (3.0) が必ず追いつき、20px を越えない
 * 結果、ボールは 12〜15px の帯を往復し、touch-priority を失わない。
 *
 * 「12px以内でしか触れない」方式(初回の修正案)にしなかった理由: AI選手は
 * AI_BALL_DEADZONE_PRIMARY (9px) で足を止めるため、12px以内に入らないまま静止して
 * **AIがボールを運べなくなり、CPUのシュートが 34本→2本 に崩壊した** (観戦シミュレーターで計測)。
 * 旧実装の「ボールが逃げ続ける」挙動が、皮肉にもAIの推進力として機能していた。
 * 距離で速度を variable にする本方式なら、ボールは常に押され続けるのでAIは追い続けられ、
 * かつ人間のボールは足元から離れない。
 */
export const DRIBBLE_KEEP_SPEED_FIXED: Fixed = toFixed(2.8);

/** これ以下の高さのボールのみドリブルタッチの対象とする (px, 仮値)。浮き球はキックのみで触れる。 */
export const DRIBBLE_TOUCH_MAX_HEIGHT_FIXED: Fixed = toFixed(2.0);

/** ドリブルタッチ時にボールへ与える速度 (px/tick, 仮値)。PLAYER_SPEED(3.0)よりわずかに速い。 */
export const DRIBBLE_TOUCH_SPEED_FIXED: Fixed = toFixed(3.6);

/** ロングドリブル(L/R押し続け)時のプレイヤー速度 (px/tick, 仮値。通常の約1.4倍、要実機検証)。 */
export const LONG_DRIBBLE_PLAYER_SPEED_FIXED: Fixed = toFixed(4.2);

/** ロングドリブル時にボールへ与える速度 (px/tick, 仮値。ドリブル半径外まで蹴り出す想定、要実機検証)。 */
export const LONG_DRIBBLE_TOUCH_SPEED_FIXED: Fixed = toFixed(6.0);

/** キック溜め時間の下限/上限 (tick、60fps基準。上限は約0.5秒、仮値)。 */
export const KICK_MIN_CHARGE_FRAMES = 1;
export const KICK_MAX_CHARGE_FRAMES = 30;

/** 弱キック (方向入力無しで解放) の基準速度 (px/tick, 仮値)。 */
export const WEAK_KICK_SPEED_FIXED: Fixed = toFixed(4.0);
/** 強キック (方向入力ありで解放) の基準速度 (px/tick, 仮値)。 */
export const STRONG_KICK_SPEED_FIXED: Fixed = toFixed(9.0);

/** 弾道軸: 溜め時間0→最大 で zVel をこの範囲に線形補間する (仮値)。 */
export const KICK_Z_VEL_MIN_FIXED: Fixed = toFixed(0);
export const KICK_Z_VEL_MAX_FIXED: Fixed = toFixed(6.0);

/** 最大溜め時に水平速度へ掛かる係数 (仮値)。高弾道シュートほど球速が落ちる表現。 */
export const HIGH_ARC_SPEED_MULTIPLIER_FIXED: Fixed = toFixed(0.7);

/** 重力加速度 (px/tick^2, 仮値)。 */
export const GRAVITY_FIXED: Fixed = toFixed(0.35);
/** バウンド時に残る垂直速度の割合 (仮値)。 */
export const BOUNCE_DAMPING_FIXED: Fixed = toFixed(0.5);
/** これ未満の着地速度はバウンドさせず静止させる (px/tick, 仮値)。無限微小バウンド防止。 */
export const BOUNCE_MIN_VEL_FIXED: Fixed = toFixed(0.5);
/**
 * 接地中、毎tick水平速度に掛ける減衰係数。
 *
 * ★重要なバグ修正 (実プレイ報告「キーパーがキャッチしない」の主因の一つ)★
 * 旧値0.96は減衰が強すぎた。転がるボールの総移動距離は v*f/(1-f) なので、
 * 強キック(9px/tick)でも 9*0.96/0.04 = **216px しか転がらない**。ピッチ全長1800px、
 * ペナルティエリア外からのシュートは物理的にゴールへ到達できず、到達しても速度が
 * セーブ文脈の下限(4.5px/tick)を割っていてキーパーが反応対象とすら認識しない、
 * という二重の破綻を起こしていた。
 *
 * 0.985 なら 9*0.985/0.015 ≈ **591px** 転がる。ミドルシュート・サイドチェンジの
 * ロングパスが成立する現実的な範囲になる。
 * (ドリブル制御への影響は DRIBBLE_CONTACT_RADIUS_FIXED 側で吸収済み:
 *  接触半径12pxから押し出されたボールは約16pxで選手に追いつかれ、20pxを越えない)
 */
export const ROLLING_FRICTION_FIXED: Fixed = toFixed(0.985);

/**
 * カーブ(続編仕様③)関連の定数。すべて仮値(実機データ無し、プレイフィールで調整する対象。
 * CLAUDE.md「独自仕様」節のバックスピンと同様の扱い)。
 *
 * 入力受付ウィンドウ: 公式説明書は「キックボタンを押した"瞬間に"+字を入れる」と記述するが、
 * この実装は1tickにつき方向入力を1つしか読めず、キック発動tickの方向入力は既に
 * ショット自体の照準(シフトキック含む)に使われている。そのため「同時」を「キック発動
 * tickの直後から始まる短いウィンドウ」で近似する。初代CLAUDE.mdが計画していた
 * 「キック後Nフレーム(仮値20f)」より大幅に短くしてある(「同時」に近づける意図)。
 */
export const CURVE_INPUT_WINDOW_TICKS = 6;
/** カーブが実際に効いている持続tick数 (仮値)。 */
export const CURVE_DURATION_TICKS = 24;
/**
 * カーブによる毎tickの側方加速度 (px/tick、仮値)。CURVE_DURATION_TICKS(24)分
 * 累積すると側方速度が最大で約2.4px/tick増える計算 (STRONG_KICK_SPEED=9.0の
 * 約27%相当)。軌道を明確に曲げつつ直進性を完全には殺さない、上限側の初期値として
 * 選んだ(要プレイテスト調整。初期実装値0.35は最大8.4px/tickまで積み上がり
 * ショットを完全に横へねじ曲げてしまい、観戦シミュレーターで新規の振動を誘発したため
 * 大幅に下げた)。
 */
export const CURVE_ACCEL_FIXED: Fixed = toFixed(0.04);

/**
 * リフティング(続編仕様⑥)で頭上へ蹴り上げる際の垂直初速 (px/tick、仮値)。
 * KICK_Z_VEL_MAX_FIXED(6.0、キック弾道軸の最大)の約半分にし、「強いキックの浮き球」
 * ではなく「軽く浮かせて保持を継続する」動作であることを表現した。
 */
export const LIFT_Z_VEL_FIXED: Fixed = toFixed(3.0);
