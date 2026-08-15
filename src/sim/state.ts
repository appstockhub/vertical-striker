import type { Fixed, Vec2Fixed } from '../core/types';
import { ZERO_FIXED } from '../core/fixed';
import { createRng, type RngState } from '../core/rng';
import { emptyButtonState, type ButtonState, type Direction8 } from '../input/types';
import { FormationId, PLAYERS_PER_TEAM, TeamId } from './formations';
import { TacklePhase } from './tacklePhase';
import { KICKOFF_TAKER_SLOT_INDEX, placeKickoffFormation } from './kickoff';
import { KICKOFF_GRACE_TICKS } from './teamAIConstants';

export { TeamId, PLAYERS_PER_TEAM };
export { TacklePhase };
export type { Half } from './formations';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface PlayerState {
  readonly pos: Vec2Fixed;
  readonly vel: Vec2Fixed;
  readonly facing: Direction8;
  /** 0 = 非チャージ中。>0 = Bボタンを押し続けているtick数 (Phase 1 キック弾道軸用)。 */
  readonly kickChargeFrames: number;
  readonly team: TeamId;
  readonly isGoalkeeper: boolean;
  /** 0=GK, 1..10=そのチームのフォーメーションslot (formations.ts の outfieldSlots index+1)。 */
  readonly slotIndex: number;
  readonly tacklePhase: TacklePhase;
  readonly tackleFrames: number;
  readonly tackleDirection: Direction8;
  /**
   * 蹴り出しドリブル(続編仕様)が現在有効かどうか。L+R同時押しで新規トリガーし、以後
   * L/Rどちらか片方を押し続けている間は継続、両方離すと解除する(update.tsの
   * computeKickDribbleState参照)。実際のシミュレーション経路(kickoff.ts/update.ts)では
   * 常に明示的な値を持つが、既存のテストコード互換のためoptionalにしてある
   * (省略時は`?? false`として扱う)。
   */
  readonly kickDribbleActive?: boolean;
}

export interface BallState {
  readonly pos: Vec2Fixed;
  readonly vel: Vec2Fixed;
  /** 地面からの高さ (z軸、疑似3D)。0以上。 */
  readonly height: Fixed;
  /** 垂直方向の速度。+ = 上昇。 */
  readonly zVel: Fixed;
  /**
   * カーブ(続編仕様③)の入力受付ウィンドウの残りtick数。0より大きい間に方向入力があれば
   * curveDirection/curveTicksLeftへ遷移する(update.tsのカーブトリガー判定を参照)。
   * 人間の直接キック(シフトキックと同じ経路)でのみ開かれる。
   * optional(既存テストコード互換のため。省略時は`?? 0`として扱う)。
   */
  readonly curveWindowTicksLeft?: number;
  /** 現在効いているカーブの方向。Direction8.Noneなら無効(optional、省略時は`?? Direction8.None`)。 */
  readonly curveDirection?: Direction8;
  /** 上記カーブの残り持続tick数。0になったらcurveDirectionもNoneへ戻る(sim/ballPhysics.ts参照)。 */
  readonly curveTicksLeft?: number;
}

/**
 * 決定論シミュレーションの全状態。
 *
 * players のインデックス規約 (厳守): 0=TeamA GK, 1-10=TeamA outfield,
 * 11=TeamB GK, 12-21=TeamB outfield。globalIndex = team*11 + slotIndex。
 * 22人ぶんのクロスプレイヤー判定 (誰がボールに一番近いか等) はすべてこの配列を
 * 昇順indexで走査し、同点は小さいindexが勝つ、という決定論的タイブレークを徹底する。
 *
 * 前後半・試合時間・試合終了は `frame` (単調増加、リセットしない) と
 * sim/matchClock.ts の定数から毎tick導出する (GameStateには持たない、
 * ホームポジションと同じ「derive、cacheしない」方針)。
 */
export interface GameState {
  readonly frame: number;
  readonly rngState: RngState;
  readonly players: PlayerState[];
  readonly ball: BallState;
  /** 現在人間が操作している選手の players[] index。常に Team A (0..10)。 */
  readonly controlledPlayerIndex: number;
  /** 前tickの物理ボタン状態 (edge判定用。InputFrame.buttonsPressed は経由しない、Phase 1と同じ方針)。 */
  readonly prevButtons: ButtonState;
  readonly teamFormations: readonly [FormationId, FormationId];
  /** [TeamAの得点, TeamBの得点]。 */
  readonly score: readonly [number, number];
  /** 最後にボールに触れた(ドリブルタッチ/キック/タックル奪取/セーブ)チーム。スローイン等の相手判定に使う。 */
  readonly lastTouchTeam: TeamId | null;
  /**
   * チームライン押し上げ/引き下げが現在反映している保持チーム (時間ヒステリシス付き)。
   * 瞬間的な保持の入れ替わり(GKのパンチング・ディフレクション等、数十tickの揺り戻し)の
   * たびにライン目標が静的ホームへ即座に巻き戻ると、チーム全体が一斉に自陣へ行進して
   * すぐ戻る不自然な動きになる (観戦シミュレーターのpostShotRetreat測定で発覚)。
   * 相手が LINE_POSSESSION_SWITCH_TICKS 連続で保持し続けた時だけ切り替わる。
   */
  readonly linePossessionTeam: TeamId | null;
  /** 上記の切替判定用: linePossessionTeam と異なるチームが連続保持しているtick数。 */
  readonly linePossessionSwitchTicks: number;
  /**
   * 最後に touch-priority を保持した選手の players[] index (Phase 4)。
   * ドリブルの蹴り出しでボールが一時的に足元を離れ touch=null になっても保持され、
   * 「別の選手」が touch を取った時だけ更新される。
   */
  readonly lastTouchPlayerIndex: number | null;
  /**
   * lastTouchPlayerIndex の1つ前の (別の) 保持者の players[] index (Phase 4)。
   * 「いま保持している選手に、直前にボールを渡した選手」を表し、CPUのパス先から除外する
   * (相互パスの永久ピンポン防止、cpuAttackAI.ts のコメント参照)。
   */
  readonly prevTouchPlayerIndex: number | null;
  /** Team B(CPU)の攻撃AI難易度。試合開始時に決定、以後不変。 */
  readonly difficulty: Difficulty;
  /** オフサイドルールのON/OFF。試合開始時に決定、以後不変。 */
  readonly offsideEnabled: boolean;
  /**
   * ★練習モード★ true の間、CPU(Team B)のフィールドプレイヤーはボールに一切関与しない
   * (追跡権を持たない / touch-priority を取れない / タックル・チャージを仕掛けない)。
   *
   * 目的: 操作の手触り・スプライトの動き・ボタンの効きを、相手に邪魔されずに確認するため
   * (ユーザー要望「動きやボタンを確認したいのでCPUがボールを取らないトグルスイッチも
   * 実装して。テストにならないから」)。
   *
   * GKのセーブだけは通常どおり動かす — シュートの確認ができなくなるため。
   * 試合中にキーで切り替えられるが、GameState の一部なので simulate() は純関数のまま
   * (決定論を壊さない。ただしリプレイはこのフラグの切替タイミングまでは記録しないため、
   * 練習モードを使った試合のリプレイは再現性を保証しない)。
   */
  readonly cpuHandsOff: boolean;
  /**
   * キック入力のバッファ (★17周目★)。ボールが射程外の時に押された B を短時間だけ覚えておき、
   * 射程に入った瞬間に蹴る。「押したのに無反応」を無くすための、格闘ゲーム等と同じ入力バッファ。
   * KICK_INPUT_BUFFER_TICKS のコメントも参照。
   */
  readonly pendingKick: PendingKick | null;
  /**
   * リスタート直後の追跡権フェアネス猶予 (Phase 5)。再開してから restartGraceTicksLeft の間、
   * computeChaseRightIndices(teamAI.ts) がこのチームの相手の追跡権をゼロにする。
   *
   * 実プレイで発覚したバグの修正: キックオフはFW同士がボールから完全に対称な距離
   * (F442で153px) に位置するが、lastTouchTeam/linePossessionTeamがnull(競り合い扱い)になるため
   * 両チームに全く同じ強さ(weight 3.0、リーシュ免除)の追跡権が与えられる。AIは反応レイテンシが
   * ゼロだが人間には現実的な反応時間(9〜18tick)があるため、対称なはずの距離が実質AI有利に
   * 倒れ「なぜか敵側が先に蹴れる」という不公平が生じていた。ゴールキックについても、既存の
   * GOAL_KICK_EXCLUSION_DEPTH_FIXED(一発ティーポート押し出し)だけでは再開後の継続的な保護が
   * 無かったため、この猶予機構で補強する。
   * null = 猶予なし (通常のpossessionTeam判定のまま)。
   */
  readonly restartGraceTeam: TeamId | null;
  /** 上記の残りtick数。0になったら restartGraceTeam は事実上無効 (update.tsがnullへ戻す)。 */
  readonly restartGraceTicksLeft: number;
  /**
   * 直近の「知覚可能にすべき」イベント (Phase 5)。スローイン/GKキャッチは実装上は正しく
   * 動作しているが、画面上・音声上、他の瞬間と見分ける手がかりが無いため実プレイで
   * 「起きていない」ように見える、という報告への対応。lastTouchTeam等と同じ
   * 「読み返すだけ、物理/AIには影響しない echo フィールド」。既存の「非得点の境界復帰は
   * 試合停止の演出を持たない」(Phase 3) 方針は維持し、一時的なHUD表示のみで対応する。
   * null = 表示すべき直近イベント無し。
   */
  readonly lastEvent: NotableEvent | null;
  /**
   * セットプレー(スローイン/ゴールキック/コーナー)の再開ロック。restartTeam以外の選手
   * (人間操作を含む、GK除く) をボールに近づけないよう押し出し、かつ touch-priority も
   * restartTeamに制限する。「キッカーが実際にボールを動かすまで解除されない」
   * 状態ベースの仕組みで、固定tick数のタイマーではない (下記参照)。
   *
   * 導入経緯: B-5(b)時点では「ゴールキックのみ、RESTART_GRACE_TICKS(63tick)の間だけ毎tick
   * 再適用する一発ティーポート押し出し」だった。任天堂公式説明書での仕様確定を受けたユーザー
   * 報告により、(1) スローイン/コーナーには押し出し自体が無く相手が即座に触れてしまう、
   * (2) ゴールキックも固定63tickで解除されるため人間の反応が遅いと結局間に合わない、
   * の2点が実プレイの不具合として判明。ticksLeftによる時間切れを廃止し、「ボールが
   * 静止位置から動く(=キッカーが実際に蹴った/ドリブルタッチした)」ことを解除条件にする
   * 状態ベースの設計に変更した(update.tsの解除判定を参照)。あわせてtouch-priorityの
   * team制限(findTouchPriorityPlayerのrestrictToTeam引数)を組み合わせることで、
   * 押し出しの幾何的な際どさ(コーナー等ピッチ端付近では押し出し半径をピッチ境界内に
   * クランプせざるを得ない)に依存せず「相手は絶対に触れない」ことを構造的に保証する。
   * null = ロック無し。
   */
  readonly setPieceLock: SetPieceLock | null;
  /**
   * ライン操作(続編仕様④、STARTボタン)の手動オフセット。人間(Team A)のみが対象
   * (CPUはSTART概念を持たない)。符号付きのdepth値で、+方向はディフェンスラインを
   * 押し上げる(オフサイドトラップ)、-方向はオフェンスラインを下げる(トラップ回避)。
   * Team Aが保持中にSTARTを押し続けると-方向へ、非保持(守備)中に押し続けると+方向へ
   * 変化し、押していない間はゆっくり0(中立)へ減衰する(update.ts参照)。
   * computeLineAdjustedHomePosition(teamAI.ts)がtargetDepthに加算する。
   */
  readonly manualLineOffset: Fixed;
}

/** GameState.lastEvent の種別。goalはscoreの変化で既に検出可能なため対象外。 */
export type NotableEventKind = 'throwIn' | 'goalKick' | 'corner' | 'gkCatch';

export interface NotableEvent {
  readonly kind: NotableEventKind;
  readonly team: TeamId;
  readonly atFrame: number;
}

/** GameState.setPieceLock の内容。 */
export interface SetPieceLock {
  /**
   * 'kickoff' は16周目に追加。それまでキックオフだけがこのロック機構の対象外で、
   * サッカーのルール(第8条: 相手はセンターサークルの外、蹴られるまで触れない)が
   * 一つも実装されていなかった (ユーザー報告「こちらのキックオフなのに敵が奪取できる」)。
   */
  /**
   * 'gkHold' はセットプレーではなく「キーパーがボールを手中に確保している間」(競技規則
   * 第12条: 相手はキーパーが持っているボールにチャレンジできない)。ロック機構の
   * 「touch-priorityを1チームに制限し、ボールが動いたら解除」という性質がそのまま使えるため
   * 同じ仕組みに相乗りしている。押し出し (applySetPieceExclusion) は行わない
   * — 相手はその場に居てよく、ボールに触れないだけなので。
   */
  readonly kind: 'throwIn' | 'goalKick' | 'corner' | 'kickoff' | 'gkHold';
  /** このチーム以外の選手 (人間操作含む) が押し出し/touch-priority制限の対象。 */
  readonly restartTeam: TeamId;
  /** ボールの静止位置 (再開スポット)。ここから動いたらロック解除 (update.ts参照)。 */
  readonly pos: Vec2Fixed;
  /** true ならゾーンは北側 (y小さい方)。goalKindのY軸ライン押し出しでのみ使用する。 */
  readonly northEnd: boolean;
  /**
   * ロックが続いているtick数。kickoff のみ上限 (KICKOFF_LOCK_MAX_TICKS) で自動解除する
   * — キッカーは必ず人間の操作選手になるため、無操作だと試合が永久停止してしまうため。
   */
  readonly elapsedTicks: number;
}

/** キック入力のバッファ (GameState.pendingKick)。 */
export interface PendingKick {
  /** 残り有効tick。0になったら破棄する。 */
  readonly ticksLeft: number;
  /** 押された時の方向入力 (キック方向・強弱の判定に使う)。 */
  readonly direction: Direction8;
  /** シフトキック (L/R) の押下状態。 */
  readonly shiftL: boolean;
  readonly shiftR: boolean;
}

export interface CreateInitialStateOptions {
  readonly difficulty?: Difficulty;
  readonly offsideEnabled?: boolean;
  readonly teamFormations?: readonly [FormationId, FormationId];
}

export function createInitialState(seed: number, options: CreateInitialStateOptions = {}): GameState {
  const teamFormations: [FormationId, FormationId] = options.teamFormations
    ? [options.teamFormations[0], options.teamFormations[1]]
    : [FormationId.F442, FormationId.F442];

  // 試合開始のキックオフは Team A (競技規則 第8条、後半は Team B へ交代する)。
  // kickoffTeam を渡すことでキッカーがセンターマーク脇に立つ (16周目、それ以前は
  // 全員がホームポジションのままで、自分のキックオフでも相手と同距離135pxの
  // 徒競走になっていた)。
  const kickoffTeam = TeamId.A;
  const { players, ball } = placeKickoffFormation(1, teamFormations, kickoffTeam);

  // 操作選手はキックオフを蹴る選手 (placeKickoffFormation がボール脇へ配置した選手と同一)。
  const controlledPlayerIndex = kickoffTeam * PLAYERS_PER_TEAM + KICKOFF_TAKER_SLOT_INDEX;

  return {
    frame: 0,
    rngState: createRng(seed),
    players,
    ball,
    controlledPlayerIndex,
    prevButtons: emptyButtonState(),
    teamFormations,
    score: [0, 0],
    // キックオフはまだ誰も触れていない (「ボールは蹴られて明らかに動いたときインプレー」)。
    // 相手を触れさせない拘束は lastTouchTeam ではなく setPieceLock.restartTeam が担う。
    lastTouchTeam: null,
    linePossessionTeam: null,
    linePossessionSwitchTicks: 0,
    lastTouchPlayerIndex: null,
    prevTouchPlayerIndex: null,
    difficulty: options.difficulty ?? 'medium',
    offsideEnabled: options.offsideEnabled ?? true,
    cpuHandsOff: false,
    pendingKick: null,
    restartGraceTeam: kickoffTeam,
    restartGraceTicksLeft: KICKOFF_GRACE_TICKS,
    lastEvent: null,
    // 相手をセンターサークルの外に保つロック (競技規則 第8条)。
    setPieceLock: {
      kind: 'kickoff',
      restartTeam: kickoffTeam,
      pos: ball.pos,
      northEnd: false,
      elapsedTicks: 0,
    },
    manualLineOffset: ZERO_FIXED,
  };
}
