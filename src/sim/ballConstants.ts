import { fixedMul, toFixed } from '../core/fixed';
import type { Fixed } from '../core/types';
import { BALL_TEMPO, BALL_TEMPO_SQ, RUN_TEMPO, ballTicks } from './tempo';

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
// ★24周目サイクル② (離散タッチ化) で 12 → 7★ 原作実測 D1 (ボール〜足元距離 med 0.51身長
// ≈ 7.5px) に合わせ、タッチが発火する距離を縮めた。ボールはこの半径のすぐ外
// (7〜13px ≈ 0.5〜0.9身長) を転がって往復する。
// 制約: AI_BALL_DEADZONE_PRIMARY (6px) より大きいこと。AIはデッドゾーンで足を止めるため、
// これを下回るとAIが永久にタッチできず「CPUがボールを運べない」20周目の崩壊が再発する。
export const DRIBBLE_CONTACT_RADIUS_FIXED: Fixed = toFixed(7);
export const DRIBBLE_CONTACT_RADIUS_SQ_FIXED: Fixed = fixedMul(
  DRIBBLE_CONTACT_RADIUS_FIXED,
  DRIBBLE_CONTACT_RADIUS_FIXED,
);

/**
 * ★24周目サイクル②: ドリブルを「離散タッチ」方式へ全面再設計★
 * (旧: 18周目の追従サーボモデル。ユーザー指示と原作実測 D2「原作は蹴る→追う→蹴るの
 *  離散リズム、自作は毎tickサーボで質的に別物」を受けて置き換えた)
 *
 * 新モデル:
 *  1. 接触半径 (7px) に入った時だけ、入力方向へ DRIBBLE_TOUCH_SPEED で押し出す
 *  2. 触れていない間はボールに一切干渉しない (転がり摩擦だけが効く)
 *  3. ニュートラル入力では足元の遅いボールを「トラップ」して殺す (DRIBBLE_TRAP_DAMPING)
 *  4. L+R蹴り出しは接触時に KICKOUT_IMPULSE_SPEED のインパルス (不具合#6の修正)
 *
 * 設計値の導出 (60fps、選手0.525px/tick、低速域減衰0.85):
 *  - 成立条件: クールダウン(9tick)中にボールが進む距離 ≥ 選手の移動量(4.7px)。
 *    これを割ると選手がボールを追い越して置き去りにする (タッチ1.0以下で実測した失敗)
 *  - タッチ速度1.2 + 減衰0.85 → プローブ実測: ギャップmed 6.1px(0.42身長)・周期10tick。
 *    原作実測 D1 (med 0.51、IQR 0.29〜0.78) / D2 (8〜12tick) と整合
 */
/**
 * タッチとタッチの間の最小間隔 (tick)。「蹴る→追う→蹴る」のリズムの実体で、
 * 原作実測 D2 (タッチ周期 med 9.6tick、IQR 6.4〜11.2) に合わせた。これが無いと、
 * 接触半径内に留まるボールが数tickごとに再タッチされて実質サーボに戻る (実測で確認)。
 * 選手の「歩幅」(次の蹴り足が出るまでの時間) の近似。
 */
export const DRIBBLE_TOUCH_COOLDOWN_TICKS = 9;

export const DRIBBLE_TRAP_DAMPING_FIXED: Fixed = toFixed(0.85);
/** トラップが作用するボール速度の上限 (px/tick)。キック直後の速いボールは殺さない。 */
export const DRIBBLE_TRAP_MAX_SPEED_FIXED: Fixed = toFixed(1.0);

/** これ以下の高さのボールのみドリブルタッチの対象とする (px, 仮値)。浮き球はキックのみで触れる。 */
export const DRIBBLE_TOUCH_MAX_HEIGHT_FIXED: Fixed = toFixed(2.0);

/** ドリブルタッチ時にボールへ与える速度 (px/tick)。選手(0.525)の約2.3倍で蹴り出し、
 * 低速減衰帯(<1.25、0.85/tick)が数tickで殺す = 「蹴る→追う」の離散リズム。
 * 値のスイープ実測: 1.0では置き去り発生 / 1.2でギャップmed0.42身長・周期10tick /
 * 1.4は周期22tickに伸びすぎ → 1.2 を採用。 */
export const DRIBBLE_TOUCH_SPEED_FIXED: Fixed = toFixed(1.2);

/** 蹴り出しドリブル(L/R)時のプレイヤー速度 (px/tick)。通常の1.4倍。
 * 「走力の高い選手は通常ドリブルより速くボールを運べる」(続編公式) の速度アップ側。 */
export const LONG_DRIBBLE_PLAYER_SPEED_FIXED: Fixed = toFixed(4.2 * RUN_TEMPO);

/**
 * ★24周目サイクル②: 蹴り出しドリブル (L+R) のインパルス速度 (px/tick)★ 不具合#6の修正。
 * 旧実装の蹴り出しコードは追従モデルの分岐が必ず先にreturnするデッドコードだった。
 * 新実装は接触時に1回のインパルスとして発火する (dribble.ts)。
 *
 * 値の導出 (原作実測 D3: 押し出し0.8〜1.8身長=12〜26px / D4: 追いつき18〜54tick):
 * 2.0px/tick + 摩擦0.968/低速帯0.85 + 追走速度0.735(LONG_DRIBBLE) のプローブ実測で
 * 最大ギャップ19.7px・追いつき19tick。どちらもゲート範囲内。
 * L/Rを押し続けている間は接触のたびに再蹴り出しされる (公式の「繰り返し」記述どおり)。
 */
export const KICKOUT_IMPULSE_SPEED_FIXED: Fixed = toFixed(2.0);

/**
 * X (ロングフィード/センタリング/ロビング) の狙い飛距離と水平速度 (24周目サイクル④)。
 *
 * 旧実装 (LONG_FEED_CHARGE_FRAMES=22 で applyKick に委譲) は溜め22相当の
 * 高弾道+速度倍率で**第一飛行だけで577px (約79m) 飛ぶ**ことがプローブ実測で判明した。
 * ロングフィードは「FWライン(前線)へ浮かせて送る」ボタンであり、ゴールからゴールへ
 * 届く距離は用途に合わない。そこで applyAimedPass のロビングと同じ物理
 * (zVel = dist·g/(2·vx) の逆算) を方向キック版として使い、飛距離を定数で固定する。
 *
 * 180px ≈ 12.3身長 ≈ 25m: 中盤からFWラインへ届く距離。S-P1 (スルーパス北極星ゲート、
 * 150px先のFWの頭を越えて前方空間へ落とす) の根拠でもある。着地後は通常の
 * バウンド+転がりで数十px伸びる。
 */
export const LONG_FEED_DISTANCE_FIXED: Fixed = toFixed(180);
export const LONG_FEED_SPEED_FIXED: Fixed = toFixed(9.0 * BALL_TEMPO);

/** キック溜め時間の下限/上限 (tick、60fps基準。上限は約0.5秒、仮値)。 */
export const KICK_MIN_CHARGE_FRAMES = 1;
export const KICK_MAX_CHARGE_FRAMES = 30;

/**
 * 弱キック (方向入力無しで解放) の基準速度 (px/tick)。
 *
 * ★17周目に 4.0 → 6.2★ 実プレイ報告「キックの反応が弱い」の計測で、方向入力なしのBが
 * 球速3.94 (方向ありは8.86) と落差が大きすぎ、「蹴ったのに転がっただけ」に感じることが
 * 判明した。方向を入れない=狙いを定めていないので強キックより弱いのは仕様として残すが、
 * 「クリア/軽い蹴り出し」として成立する速度まで上げる。
 */
export const WEAK_KICK_SPEED_FIXED: Fixed = toFixed(6.2 * BALL_TEMPO);

/**
 * キックが届く距離 (px)。touch-priority (ドリブル半径20px) より広くする。
 *
 * ★17周目に新設★ 実プレイ「キックの反応が弱い」の直接原因。旧実装はキックを
 * 「touch-priorityを保持しているtickだけ」に許していたため、ボールが足元から少し離れる
 * (こぼれ球・トラップ直後・味方が一瞬タッチした等)だけでBが**完全に無反応**になっていた。
 * 実戦相当の計測では、ドリブル中でも22%のtickでキックできなかった。
 * 「相手が保持しているボール」は対象外 (それはタックルの領分) なので、責任範囲は変えない。
 */
export const KICK_REACH_FIXED: Fixed = toFixed(30);

/**
 * キック入力のバッファ長 (tick)。★17周目に新設★
 *
 * 押した瞬間にキックできない状況 (ボールが射程外) でも、この時間内に射程へ入れば
 * 蹴る。人間の操作は「ボールに追いつく少し前にボタンを押す」のが自然なので、
 * これが無いと「押したのに無反応」が頻発する (格闘ゲーム等の入力バッファと同じ発想)。
 * 12tick = 0.2秒。選手速度3.0px/tickなので「ボールまで36pxの手前で押した」までを拾える
 * (計測: 60px手前で押すと射程30pxに入るまで10tick)。長すぎると意図しない暴発になるため、
 * 実際の追走距離から決めたこの値を上限とする。
 */
export const KICK_INPUT_BUFFER_TICKS = 48;
/** 強キック (方向入力ありで解放) の基準速度 (px/tick, 仮値)。 */
export const STRONG_KICK_SPEED_FIXED: Fixed = toFixed(9.0 * BALL_TEMPO);

/** 弾道軸: 溜め時間0→最大 で zVel をこの範囲に線形補間する (仮値)。 */
export const KICK_Z_VEL_MIN_FIXED: Fixed = toFixed(0);
export const KICK_Z_VEL_MAX_FIXED: Fixed = toFixed(6.0 * BALL_TEMPO);

/**
 * 最大溜め時に水平速度へ掛かる係数。
 *
 * ★24周目サイクル③ (K2ゲートの修正) で 0.7 → 1.4★
 * 旧値0.7は「溜めるほど総合的な蹴りの強さ (水平+垂直の合成初速) が下がる」という
 * 続編公式「押す長さがそのままボールの強さになる」と逆行する欠陥だった (争点1)。
 * 1.4 で最大溜めの合成初速はタップの約1.55倍 (K2ゲートの許容 1.5〜2.0)。
 * 原作実測のキック初速分布 (p25 6.9 → p75 16.0 身長/s ≈ 2.3倍の広がり) とも整合し、
 * 「強く蹴ると高い弾道になりバーを越えることがある」リスク (公式記述) は
 * zVel が溜めに比例して上がる既存の弾道軸がそのまま担う。
 * AIしきい値との連動: この変更はサイクル③末の統計ゲート全数スイープとセットで入れた
 * (単独で入れると正常性基準が閾値際で落ちることを20周目に実測済みのため)。
 */
export const HIGH_ARC_SPEED_MULTIPLIER_FIXED: Fixed = toFixed(1.4);

/** 重力加速度 (px/tick^2, 仮値)。 */
export const GRAVITY_FIXED: Fixed = toFixed(0.35 * BALL_TEMPO_SQ);

/**
 * ★スローイン (台帳L-04、24周目-6)★ 原作のスローインは「頭上に掲げて静止→放物線で
 * 投げ入れる」動作で、蹴るのではなく投げる (docs/visual-behavior-audit.md 2-3節、
 * vf2070-2088)。当実装ではスローインの再開ロック解除の瞬間 (キッカーがボールを
 * 動かした瞬間) に、どのボタン経路 (B/Y/A) で出たボールも投げ込みの弾道へ変換する。
 *
 * - 水平速度の上限: 投げの強さはパス帯 (P1: 1.4〜2.2px/tick) の上限程度。
 *   キック経路の初速 (最大 2.7px/tick) をこの値でクランプする
 * - 垂直初速: 頂点 ≈ zVel²/(2g) = 0.75²/(2×0.0315) ≈ 9px の放物線。
 *   滞空 ≈ 2×zVel/g ≈ 48tick (0.8秒) で原作の投げの滞空感 (約0.6〜1.0秒) の帯内。
 *   (初案の3.55×TEMPO=滞空1.1秒は、受け手AIのグラウンダー前提の到達予測と乖離しすぎ、
 *   観戦シミュレーターの passHeavy セルでBの攻撃チェーンが切れて criterion 5 が
 *   1本まで落ちた。滞空を原作帯の下側に寄せて受け手が回収できる範囲に収める)
 * - テンポ整合: zVel ∝ BALL_TEMPO / g ∝ BALL_TEMPO² なので、頂点の高さは
 *   テンポ変更に対して不変 (KICK_Z_VEL_MAX と同じ規約)
 */
export const THROW_IN_SPEED_MAX_FIXED: Fixed = toFixed(7.0 * BALL_TEMPO);
export const THROW_IN_Z_VEL_FIXED: Fixed = toFixed(2.5 * BALL_TEMPO);
/**
 * 投げ込み変換時に水平速度へ掛ける係数 (到達点の保存)。
 *
 * キック経路が設定した速度は「グラウンダーが転がり摩擦で減衰して受け手に届く」前提で
 * 選ばれている (総到達距離 ≈ v/(1-0.968) ≈ 31v)。これをそのまま浮き球にすると、
 * 滞空中(48tick)は摩擦が効かないため 48v + 着地後の転がり ≈ 70v まで伸びて
 * **意図した受け手を飛び越える** (観戦シミュレーターでスローインが毎回ターンオーバーになり
 * criterion 5 のBシュートが1本まで落ちた実測が根拠)。
 * 0.45 で 総到達 ≈ 0.45×(48+0.75×31)v ≈ 32v となり、グラウンダーの到達点とほぼ一致する
 * (= AIの受け手選定・人間のカーソルパスの狙いがどちらもそのまま機能する)。
 */
export const THROW_IN_CARRY_MATCH_FIXED: Fixed = toFixed(0.45);
/** バウンド時に残る垂直速度の割合 (仮値)。 */
export const BOUNCE_DAMPING_FIXED: Fixed = toFixed(0.5);

/**
 * 着地時の水平速度の減衰率 (24周目サイクル④)。芝との衝突でボールは前方への勢いも失う。
 * これが無いと浮き球は着地後も初速の水平速度のままバウンドし続け、Xロングフィード
 * (飛距離180px) が着地後さらに175px転がる (プローブ実測)。0.75で着地後の伸びは
 * 約60〜80pxに収まり、「落とし所の少し先で受け手が追いつく」スルーパスの間合いになる。
 * 転がり摩擦(ROLLING_FRICTION)とは別軸: こちらは衝突1回ごとの離散的な減衰。
 */
export const BOUNCE_HORIZONTAL_DAMPING_FIXED: Fixed = toFixed(0.75);
/** これ未満の着地速度はバウンドさせず静止させる (px/tick, 仮値)。無限微小バウンド防止。 */
export const BOUNCE_MIN_VEL_FIXED: Fixed = toFixed(0.5 * BALL_TEMPO);
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
export const ROLLING_FRICTION_FIXED: Fixed = toFixed(0.968);

/**
 * ★24周目サイクル②: 低速域の強い転がり減衰★
 * この速度未満 (px/tick) のボールには ROLLING_FRICTION の代わりに ROLL_SLOW_FRICTION を
 * 掛ける。「速いボールはよく滑り、遅いボールは芝に沈んで早く止まる」の近似。
 *
 * 導入理由: 離散タッチドリブルの成立条件。ドリブルタッチ(1.2px/tick)がこの帯で
 * 数tickのうちに沈む = 「蹴る→少し転がって止まりかける→追いつく→また蹴る」のリズムが
 * 物理から生まれる。しきい値はタッチ速度(1.2)より上・最弱キック(1.86)より下に置く。
 * キック/パスへの影響は「終端の惰性の30px程度が消える」だけで、速度が出ている区間の
 * 挙動・GKの判定・T4ゲート (キック直後の減衰率0.968) には影響しない。
 */
export const ROLL_SLOW_SPEED_FIXED: Fixed = toFixed(1.25);
export const ROLL_SLOW_FRICTION_FIXED: Fixed = toFixed(0.85);

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
export const CURVE_INPUT_WINDOW_TICKS = 12;
/** カーブが実際に効いている持続tick数 (仮値)。テンポ変更に伴い 1/BALL_TEMPO 倍 (軌道形状保存)。 */
export const CURVE_DURATION_TICKS = ballTicks(24);
/**
 * ★24周目サイクル①で方式変更: 側方加速度の加算 → 速度ベクトルの微小回転★
 *
 * 旧方式 (毎tick `vel += 方向 × CURVE_ACCEL`) はテンポ変更で死んだ:
 * 0.04×BALL_TEMPO²=0.0036px/tick² は固定小数点の量子化下限 (1/256=0.0039) を下回り、
 * さらに斜め方向は fixedMul の切り捨てで完全にゼロになる (実測: 全飛程で横ずれ0.31px)。
 * 「小さな定数を加算する」方式は低テンポ×固定小数点と本質的に相性が悪い。
 *
 * 新方式は毎tick速度ベクトルを微小角回転させる:
 *   vx' = vx - vy×k×s / vy' = vy + vx×k×s (s=曲げ方向の符号)
 * 乗算の相手が速度そのもの (数百raw) なので量子化に強く、曲がる角度が速度に比例して
 * 保存される (速いボールほど大きく曲がって見える=原作らしい)。摩擦は回転後の
 * ベクトル全体に掛かるため、側方成分だけが選択的に減衰することもない。
 *
 * さらに量子化対策として「毎tick最小量子(1/256rad)を回す」のではなく
 * 「CURVE_ROTATION_INTERVAL(4)tickごとに4倍角(4/256rad)を回す」。毎tick1/256だと
 * fixedMulの切り捨て(trunc)で実効ゲインが半分以下に減り、摩擦との均衡で側方速度が
 * 9raw(0.035px/tick)で停滞することを実測した。4tickまとめ適用なら切り捨て損失は1割未満。
 * 合計回転角は 80/4回 × 4/256rad = 0.3125rad ≈ **17.9°** = 旧設計の狙い
 * (最大側方2.4px/tick ÷ 強キック9.0 ≈ 15°) とほぼ同じ曲げ角。
 */
export const CURVE_ROTATION_STEP_FIXED: Fixed = toFixed(4 / 256);
export const CURVE_ROTATION_INTERVAL = 4;

/**
 * リフティング(続編仕様⑥)で頭上へ蹴り上げる際の垂直初速 (px/tick、仮値)。
 * KICK_Z_VEL_MAX_FIXED(6.0、キック弾道軸の最大)の約半分にし、「強いキックの浮き球」
 * ではなく「軽く浮かせて保持を継続する」動作であることを表現した。
 */
export const LIFT_Z_VEL_FIXED: Fixed = toFixed(3.0 * BALL_TEMPO);

/**
 * ★24周目サイクル③ (不具合#1の修正)★ リフティングの入力受付ウィンドウ (tick)。
 * 旧実装は「反転入力」と「Bのedge」を**同一tick**に要求しており、人間には
 * 「方向転換とまったく同じフレームにBを押し始める」ことが事実上不可能だった
 * (機械入力のテストだけが通る空振り仕様)。反転を検出したらこのウィンドウを開き、
 * その間のB押下をリフティングとして受け付ける。9tick=150ms は人間の「直後」の近似
 * (公式の「ターンアクション中にキックボタン」の実装置き換え)。
 */
export const LIFT_INPUT_WINDOW_TICKS = 9;

/**
 * ★24周目サイクル③ (不具合#4)★ Bキックのワインドアップ長 (tick)。
 * 原作実測 K1 (静止→最高速の proxy): p25≈3.2tick・med≈8tick → 範囲3〜8の中の
 * 承認済み設計値 6 を採用。B解放からこのtick数の後にボールが発射され、その間の
 * +字入力がカーブになる (state.ts WindupKick 参照)。
 */
export const KICK_WINDUP_TICKS = 6;

/**
 * ★24周目サイクル③ (不具合#2 / P1)★ カーソルパス (applyAimedPass、kick.ts) の物理定数。
 * 原作実測 P1: パス初速の下側は p25 6.9身長/s ≈ 1.7px/tick。グラウンダーの帯を
 * 1.4〜2.4px/tick に置き、届かない遠距離 (>90px) は浮き球で通す。
 */
export const PASS_GROUND_MAX_DIST_FIXED: Fixed = toFixed(90);
/** グラウンダーの距離→速度係数: v = dist×0.03 → 摩擦0.968での総転がり距離 ≈ dist×0.91+残速。 */
export const PASS_GROUND_SPEED_PER_DIST_FIXED: Fixed = toFixed(0.03);
export const PASS_MIN_SPEED_FIXED: Fixed = toFixed(1.4);
// 批評役FAIL指摘(サイクル③)で 2.4→2.2: P1ゲート上限 (9身長/s = 2.2px/tick) に揃えた。
export const PASS_MAX_GROUND_SPEED_FIXED: Fixed = toFixed(2.2);
/** ロビングの水平速度 (px/tick)。強キック(2.7)よりやや遅い「柔らかい」弾道。 */
export const PASS_LOB_SPEED_FIXED: Fixed = toFixed(2.2);
export const PASS_MIN_LOB_Z_FIXED: Fixed = toFixed(0.7);
export const PASS_MAX_LOB_Z_FIXED: Fixed = toFixed(2.2);
