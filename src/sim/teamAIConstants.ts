import { fixedMul, toFixed } from '../core/fixed';
import type { Fixed } from '../core/types';
import { RUN_TEMPO } from './tempo';

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
export const OFFSIDE_BIAS_WEIGHT_FIXED: Fixed = toFixed(0.8);

/**
 * オフサイドバイアスが発動する「ライン超過量」のマージン (px、仮値)。
 * ラインちょうどで判定すると、相手DFライン自体が毎tick数px動くため、ライン付近に立つ
 * FWのバイアスがtickごとにON/OFFを繰り返して小刻みに揺れ続ける (観戦シミュレーターの
 * 振動検出で発覚)。このマージンぶんまでの「わずかにライン超え」は許容する
 * (実際のオフサイド判定はキックの瞬間にしか行われないため、数px の超過は実害がない)。
 */
export const OFFSIDE_BIAS_MARGIN_FIXED: Fixed = toFixed(16);

/**
 * ボール「追跡権」(computeChaseRightIndices) を持たない選手のボール引力。仮値。
 * 実プレイで「団子サッカー」(ほぼ全員がボールに殺到する) が発覚したため導入。
 * 強いボール引力を全員に適用していた旧実装は、各チームのフィールドプレイヤー全員が
 * リーシュ内であればボールへ収束してしまっていた。追跡権を持つ選手だけが強い引力
 * (primary=BALL_ATTRACTION_WEIGHT_CLOSE_RANGE_FIXED / cover=COVER) を使い、
 * それ以外はこの弱い値を使うことで、HOME_PULL_WEIGHT_NEAR_FIXED(0.5)が優位になり
 * (ライン調整された)ホームポジション優先でスペースを守るようにする。
 */
export const BALL_ATTRACTION_WEIGHT_NON_CHASER_FIXED: Fixed = toFixed(0.15);

/**
 * カバー役(追跡権2人目)のボール引力。仮値。primary(3.0)より弱く、非追跡権(0.15)より強い
 * 中間値で、ボールに付かず離れずの距離を保つ。primaryと同じフル引力を与えると
 * 2人が同じボール座標に折り重なって団子になる (観戦シミュレーターで発覚)。
 */
export const BALL_ATTRACTION_WEIGHT_COVER_FIXED: Fixed = toFixed(0.45);

/**
 * ボール追跡権の人数 (仮値、Phase 4調整を見込んでパラメータ化)。
 * 守備側(ボールを保持していないチーム)は最寄り+カバーの2人 (プレス+カバーの読み合い)。
 * 保持側は1人だけ (パスの受け手/こぼれ球の回収要員。攻撃の厚みはライン押し上げが担うため、
 * 保持側まで2人がボールへ殺到すると団子サッカーになる — 観戦シミュレーターで発覚)。
 */
export const CHASE_RIGHT_HOLDERS_DEFENDING = 2;
export const CHASE_RIGHT_HOLDERS_POSSESSING = 1;

/**
 * ライン押し上げ(自チーム保持中)の目標深度をボールの深さからこの距離だけ手前に留める (px、仮値)。
 * 0だと全ラインがボールと同じ深さまで密着し、同深度の味方がボールの団子判定圏に常時入る
 * 「厚すぎるサポート」= 団子度悪化の一因になる (観戦シミュレーターで発覚)。
 * 「ボールの後方に支援ラインを敷く」という現実のサッカーのサポート距離の近似。
 * Phase 5 (乖離B-2修正): LINE_PUSH_FOLLOW_MINの導入で支援ラインに実際に到達する選手が
 * 増えたため、団子判定半径(150px)の内側に入らないよう150→190pxへ拡大した。
 * 190pxはホームdeadzone(28px)を引いても162px>150で団子圏外、かつキャリアへの
 * パス射程(220px)とnearSupport帯(120-250px)の内側に収まる。
 */
export const LINE_PUSH_STANDOFF_FIXED: Fixed = toFixed(190);

/**
 * 押し上げ時の追従率の下限 (Phase 5、乖離B-2修正、仮値)。ホーム深さが
 * LINE_PUSH_FOLLOW_BOOST_MIN_HOME_DEPTH 以上のスロット(MF/FW)のみに適用し、
 * DF(≈135-162px)とGKは対象外にする(レストディフェンス=カウンター保険の維持、挙動仕様書1.3)。
 * 0.95 = 支援ライン(ボール後方190px)までほぼ完全に随伴する。
 */
export const LINE_PUSH_FOLLOW_MIN_FIXED: Fixed = toFixed(0.95);
export const LINE_PUSH_FOLLOW_BOOST_MIN_HOME_DEPTH_FIXED: Fixed = toFixed(400);

/**
 * ライン押し上げ/引き下げが参照するボール深度の量子化グリッド (px、仮値)。
 * 生のボール深度をそのまま使うと、ボールの毎tickの微小な動き(ドリブル・競り合い)に
 * ホーム目標が追随して全選手が小刻みに揺れ続ける (観戦シミュレーターの振動検出で発覚)。
 * 深度をこの単位に量子化することで、ボールがグリッド1つぶん動いた時だけラインが動く。
 */
export const LINE_FOLLOW_GRID_FIXED: Fixed = toFixed(32);

/**
 * チームラインが反映する保持チームを切り替えるのに必要な連続保持tick数 (仮値、90tick=1.5秒)。
 * GameState.linePossessionTeam の時間ヒステリシス。瞬間的な保持の入れ替わり
 * (GKパンチング・こぼれ球の一瞬の接触等) でライン全体が静的ホームへ巻き戻って
 * 「シュート直後にチーム全体が一斉に自陣へ戻る」不自然な行進が起きるのを防ぐ
 * (観戦シミュレーターのpostShotRetreat測定で発覚)。追跡権(プレス)は即応のまま、
 * ライン(陣形)だけを遅らせる、という応答速度の分離。
 */
// テンポ変更(24周目サイクル①): 1.5秒→5秒。瞬間的な保持の入れ替わり(GKパンチング・こぼれ球)
// 自体がテンポ低下で長引くようになったため、ヒステリシスも 1/BALL_TEMPO 倍で追随させる。
export const LINE_POSSESSION_SWITCH_TICKS = 300;

/**
 * ライン調整後のホームポジションを相手オフサイドラインの手前に留めるマージン (px、仮値)。
 * ライン押し上げがホームをオフサイドラインの先まで進めてしまうと、ホーム復元力(前へ)と
 * オフサイドバイアス(後ろへ)が境界を挟んで毎tick反転する押し合いになり、選手がライン上で
 * 永久に振動する (観戦シミュレーターの振動検出で発覚)。ホーム目標自体をオンサイドに
 * クランプすることで、対立する2つの力の構造を除去する。
 */
export const ONSIDE_HOME_MARGIN_FIXED: Fixed = toFixed(10);

/**
 * primary追跡者のボール引力 (距離によらず常時、圧倒的優勢)。仮値。
 * 8方向に量子化した各項を重み付け合成する既存方式は、目標が斜め方向にある場合などに
 * ホーム/ボール成分が軸ごとに打ち消し合い、本来ボールに向かうべきなのに合成方向がそれて
 * しまい、ボールの手前20〜30px程度で選手が永久に足踏みする問題が実プレイ相当のテストで
 * 発覚した。当初は「最終アプローチ」(ボール80px以内の時だけこの値へ引き上げ)だったが、
 * 距離ゲート自体が追跡権メンバーシップの入れ替わりと干渉して振動を生んだため、
 * primaryは距離によらず常にこの値を使う方式に変更した (teamAI.ts のコメント参照)。
 */
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

/** ホームポジションにこの距離以内なら「到着済み」とみなし復元力を0にする (px, 仮値、二乗)。
 * 選手の1tick移動量(PLAYER_SPEED=3px)より大きくすること (overshoot振動防止の原則)。
 * さらに、ライン調整/オンサイドクランプによるホーム目標の毎tickの微小な滑り(数px)を
 * 吸収できる大きさにする — 4pxではライン目標のわずかな揺れに全員が追随して
 * 小刻みに動き続けてしまう (観戦シミュレーターの振動検出で発覚)。選手の描画半径(14px)
 * 程度の「駐留ゾーン」として16pxに拡大。 */
export const AI_HOME_DEADZONE_SQ_FIXED: Fixed = fixedMul(toFixed(28), toFixed(28));
/** ボールにこの距離以内なら引力を0にする (px, 仮値、二乗)。
 * バグ修正 (観戦シミュレーターの振動検出で発覚): 旧値2pxは選手の1tick移動量(3px)より
 * 小さく、目標を毎tick跨ぎ越して往復するoverjitterを構造的に許していた。
 * 「デッドゾーンは1tickの移動量より大きくする」原則に合わせて4pxへ拡大。 */
export const AI_BALL_DEADZONE_SQ_FIXED: Fixed = fixedMul(toFixed(4), toFixed(4));
/**
 * primary追跡者専用のボールデッドゾーン (px、仮値、二乗)。cover/非追跡権はAI_BALL_DEADZONE_SQ_FIXED
 * (4px)のまま。primaryは引力weightが圧倒的(3.0)なため、4pxでは1tick移動量(3px)に対する
 * マージンが薄く(1px)、既にボールを保持している味方へ無意味に収束しようとして極小距離で
 * 往復する振動が実プレイ相当のテストで発覚した (Phase 5、リスタート猶予導入のバタフライ効果で
 * 新たに踏んだ経路)。1tick移動量の約3倍(9px)にマージンを広げ、cover/非追跡権には影響させない
 * (デッドゾーンを全体で広げるとdango等の全体挙動に副作用が出ることを確認済みのため)。 */
export const AI_BALL_DEADZONE_PRIMARY_SQ_FIXED: Fixed = fixedMul(toFixed(9), toFixed(9));
/**
 * 合成後ベクトルの最終量子化デッドゾーン (仮値、二乗)。
 *
 * 設計ルール (観戦シミュレーターの振動検出で全22選手が振動判定になった事象を受けて確立):
 * - 「動くべき」単独項 (追跡権ボール引力0.9 / ホーム復元near 0.5 / オフサイド 0.8) より小さく、
 * - 「それ単独では動かないべき」残余項 (非追跡権ボール引力0.15 / sticky facingバイアス0.15)
 *   より大きくすること。
 * 旧値0.05は後者の条件を満たしておらず、ホームに到着済みの非追跡権選手が弱いボール引力
 * 0.15だけで毎tick踏み出しては復元力で戻される無限の微細往復(=全員が常時ジッター)を
 * 起こしていた。
 */
export const AI_FINAL_DEADZONE_SQ_FIXED: Fixed = fixedMul(toFixed(0.25), toFixed(0.25));

// ============================================================================
// マーク (marking.ts) / サポートラン (supportRun.ts) 用の定数。すべて仮値。
//
// 注意: 以下はすべて「目標位置・適格判定の半径/グリッド」であり、力の重みではない。
// 両機能とも既存のホーム復元力が収束する目標点を差し替えるだけで、8方向量子化+重み合成には
// 新しい項を追加しない (Phase 4 実装計画参照)。したがって上記の
// AI_FINAL_DEADZONE_SQ_FIXED の重み帯ルール (0.25境界) には一切影響しない。
// ============================================================================

/**
 * マーカー適格判定: 静的ホーム深度(ライン調整前)がこの値以下の守備側選手だけがマークを行う (px)。
 * depthFrac 0.35 * (PITCH_HEIGHT/2=900) = 315px。全4フォーメーションでDFライン(depthFrac
 * 0.15-0.18 → 135-162px)だけが該当し、MF(0.5 → 450px)は該当しない。静的な値なので
 * マーカー集合は試合中に一切変動しない (割り当て churn の構造的排除)。
 */
export const MARKER_MAX_HOME_DEPTH_FIXED: Fixed = toFixed(315);

/**
 * マーク候補の適格判定: 量子化深度(自陣ゴールから、LINE_FOLLOW_GRIDで量子化)がこの値未満の
 * 相手外野選手だけをマーク対象にする (px)。
 * 初期案の900px(自陣ハーフ全体)は観戦シミュレーターで平均マーク距離が313-532pxに膨らんだ:
 * ハーフライン際をうろつくだけの(まだ危険でない)相手にまで深い位置のDFが割り当てられ、
 * 永遠に移動中= マークが実質機能しない状態になっていた。危険域(自陣ゴールから450px)に
 * 絞ることで、DFライン(ホーム深度~150px)からの移動距離が短くなり実際に付き切れる。
 */
export const MARK_ZONE_DEPTH_FIXED: Fixed = toFixed(450);

/**
 * マーク候補のボール除外半径 (px、二乗を保存)。ボールからこの距離未満にいる相手は
 * マーク対象にしない — ボール近傍の相手(キャリア・至近の受け手)は追跡権保有者の仕事であり、
 * そこへマーカーまで引き寄せると団子度が悪化する (団子化への主防壁)。
 * 判定は48px²バケット(追跡権と同じ量子化)で行うため、実効境界は約117px。
 */
export const MARK_BALL_EXCLUSION_RADIUS_FIXED: Fixed = toFixed(120);
export const MARK_BALL_EXCLUSION_SQ_FIXED: Fixed = fixedMul(
  MARK_BALL_EXCLUSION_RADIUS_FIXED,
  MARK_BALL_EXCLUSION_RADIUS_FIXED,
);

/** 同時にマークを行うマーカーの最大人数 (仮値)。団子度/CPUシュート数が悪化したら下げる。 */
export const MARK_MAX_MARKERS = 4;

/**
 * マークホームのゴール側スタンドオフ (px)。マーク対象の量子化位置から自ゴール方向へ
 * この距離だけずらした点をホーム目標にする。ホームdeadzone(28px)より大きくすることで、
 * マーカーが対象に重なって止まる(=団子・タックル誤爆の温床)ことを構造的に防ぐ。
 */
export const MARK_STANDOFF_FIXED: Fixed = toFixed(48);

/**
 * マークホーム目標の量子化グリッド (px)。オンサイドクランプの24pxグリッドと同じ理由:
 * グリッド1段(24px)はホームdeadzone(28px)より小さいため、マーク対象が1段ぶん動いても
 * 到着済みのマーカーは動かない (毎tickの微小追随=振動の構造的排除)。
 */
export const MARK_TARGET_GRID_FIXED: Fixed = toFixed(24);

/**
 * サポートランナーの人数 (フォーメーションごとに depthFrac 最大の外野スロットから選ぶ、仮値)。
 * 3人にすることで、うち1人がキャリア(teamAI駆動されない)でも非キャリア2人以上の
 * サポートが常に保証される (正常性基準9の前提)。観戦シミュレーターの実測でも、
 * 2人では人間側(Team A)の攻撃が組み立たず、3人で初めてシュート数が回復した
 * (前線の受け手の枚数が攻撃成立の主要因)。
 */
export const SUPPORT_RUNNER_COUNT = 3;

/**
 * サポートランの目標深度: ボールの量子化深度(LINE_FOLLOW_GRID)からこの距離だけ前方 (px、仮値)。
 * ライン押し上げの「ボール後方150px」(LINE_PUSH_STANDOFF)をランナーだけ反転し、
 * 「キャリア前方のスペースへ走り込んでパスを受ける」動きを作る。
 * 実際の目標は既存のオンサイドクランプでオフサイドラインの手前に頭打ちされる。
 *
 * 初期案の100pxは団子度測定の半径(150px)より小さく、定着したランナー自体が
 * ボール周辺150px圏の人数にカウントされて passHeavy で団子度5.0を叩き出した
 * (観戦シミュレーターで発覚)。団子半径より外側かつカーソルパス射程
 * (PASS_MAX_RANGE=220px)の内側、という帯の中に置く。
 */
export const SUPPORT_AHEAD_STANDOFF_FIXED: Fixed = toFixed(180);

/**
 * サポートランの目標深度の上限 (自陣ゴールからの距離、px、仮値)。相手ボックスの縁
 * (PITCH_HEIGHT - 150) 相当。ボールが敵陣深くにある時に ballDepth+standoff が
 * ピッチ外 (>PITCH_HEIGHT) の目標を生み、ランナーが境界クランプに押し付けられ続ける
 * 不具合の防止 (観戦シミュレーターで発覚)。ゴール前の密集への追加合流も防ぐ。
 */
export const SUPPORT_MAX_DEPTH_FIXED: Fixed = toFixed(1650);

/**
 * サポートランの味方回避: 最寄りの味方がこの距離以内なら目標Xをずらす (px、二乗を保存、仮値)。
 * 判定は48px²バケットで安定化。フォーメーションのX間隔(FW同士144px)より狭いので通常は
 * 発動せず、スクランブル後の密集を解消するための保険。
 */
export const SUPPORT_SPACING_RADIUS_FIXED: Fixed = toFixed(64);
export const SUPPORT_SPACING_SQ_FIXED: Fixed = fixedMul(SUPPORT_SPACING_RADIUS_FIXED, SUPPORT_SPACING_RADIUS_FIXED);

/** サポートランの味方回避で目標Xをずらす量 (px、仮値)。 */
export const SUPPORT_SPREAD_OFFSET_FIXED: Fixed = toFixed(64);

/** サポートランの目標Xの量子化グリッド (px)。MARK_TARGET_GRIDと同じ理由 (< ホームdeadzone 28px)。 */
export const SUPPORT_X_GRID_FIXED: Fixed = toFixed(24);

// ============================================================================
// リスタート猶予 (Phase 5、GameState.restartGraceTeam/restartGraceTicksLeft、
// computeChaseRightIndices の suppressedTeam 引数) 用の定数。すべて仮値。
// ============================================================================

/**
 * キックオフ猶予tick数 (仮値、要プレイテスト調整)。キックオフの153px対称タイ
 * (F442 FW depthFrac=0.85 → 両チーム同じ距離) は、AIの反応レイテンシがゼロなため、
 * 人間の現実的な反応時間(~9-18tick、入力を目視して押すまでの遅延の概算)の間だけ
 * 相手側の追跡権を止めれば、対称な取り合いを人間側にも成立させられる。
 * 大きすぎると「キックオフ直後、数十tick誰も動かない」不自然さが出るため、
 * 上限寄りの18tickではなく中間の15tickを初期値にする。
 */
export const KICKOFF_GRACE_TICKS = 15;

/**
 * ゴールキック/スローイン/コーナー再開時の猶予tick数 (仮値)。ゴールキックの
 * GOAL_KICK_EXCLUSION_DEPTH_FIXED(250px)と再開位置GOAL_KICK_DEPTH_FIXED(60px)の
 * 差分190pxを、相手フィールドプレイヤーがPLAYER_SPEED_FIXED(3px/tick)で詰めるのに
 * 必要な最短tick数(190/3≈63)と揃える。この間、追跡権ゼロで一発テレポート復帰を
 * 邪魔されずに済ませられる。スローイン/コーナーはこの押し出しルール自体が無いため
 * (goal-kick専用)、同じ猶予tick数を流用する — 妥当性は要プレイテスト確認。
 */
// テンポ変更(24周目サイクル①): 上記の導出式のまま速度だけ差し替え:
// 190px / PLAYER_SPEED(0.525px/tick) ≈ 362tick。
export const RESTART_GRACE_TICKS = 362;

// ============================================================================
// ライン操作 (続編仕様④、GameState.manualLineOffset、STARTボタン) 用の定数。
// すべて仮値 (実機データ無し、要プレイテスト調整)。
// ============================================================================

/**
 * 手動ラインオフセットの上限/下限 (px、仮値)。LINE_PUSH_STANDOFF_FIXED(190px)より
 * 小さくし、「自動のライン計算を覆すほどの極端な操作」にはならない範囲に留めた
 * (オフサイドトラップは強力な戦術のはずだが、既存の自動ライン計算(押し上げ/引き下げ)
 * 自体を過剰に上書きしてピッチ外相当の不自然な位置まで押し出すのは避けたい)。
 */
export const MANUAL_LINE_OFFSET_MAX_FIXED: Fixed = toFixed(150);
/**
 * STARTを押している間、1tickあたりオフセットが変化する量 (px/tick、仮値)。
 * PLAYER_SPEED_FIXED(3px/tick)と同程度にし、選手の実際の移動速度で追随できる範囲にした。
 */
export const MANUAL_LINE_OFFSET_STEP_FIXED: Fixed = toFixed(3 * RUN_TEMPO);
/**
 * STARTを押していない間、1tickあたりオフセットが中立(0)へ戻る量 (px/tick、仮値)。
 * STEPよりやや遅くし、「離した瞬間に一瞬で元に戻る」不自然さを避けた。
 */
export const MANUAL_LINE_OFFSET_DECAY_FIXED: Fixed = toFixed(2 * RUN_TEMPO);
