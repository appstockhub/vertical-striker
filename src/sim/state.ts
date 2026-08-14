import type { Fixed, Vec2Fixed } from '../core/types';
import { createRng, type RngState } from '../core/rng';
import { emptyButtonState, type ButtonState, type Direction8 } from '../input/types';
import { FormationId, PLAYERS_PER_TEAM, TeamId } from './formations';
import { TacklePhase } from './tacklePhase';
import { placeKickoffFormation } from './kickoff';
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
}

export interface BallState {
  readonly pos: Vec2Fixed;
  readonly vel: Vec2Fixed;
  /** 地面からの高さ (z軸、疑似3D)。0以上。 */
  readonly height: Fixed;
  /** 垂直方向の速度。+ = 上昇。 */
  readonly zVel: Fixed;
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
}

/** GameState.lastEvent の種別。goalはscoreの変化で既に検出可能なため対象外。 */
export type NotableEventKind = 'throwIn' | 'goalKick' | 'corner' | 'gkCatch';

export interface NotableEvent {
  readonly kind: NotableEventKind;
  readonly team: TeamId;
  readonly atFrame: number;
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

  const { players, ball } = placeKickoffFormation(1, teamFormations);

  // キックオフ時の操作選手: Team A の最初のFW (4-4-2ならslotIndex=9、DF4+MF4の次)。
  // ボールが PITCH_HEIGHT*0.5 付近に置かれるため、比較的近い位置の選手を初期操作対象にする。
  const controlledPlayerIndex = TeamId.A * PLAYERS_PER_TEAM + 9;

  return {
    frame: 0,
    rngState: createRng(seed),
    players,
    ball,
    controlledPlayerIndex,
    prevButtons: emptyButtonState(),
    teamFormations,
    score: [0, 0],
    lastTouchTeam: null,
    linePossessionTeam: null,
    linePossessionSwitchTicks: 0,
    lastTouchPlayerIndex: null,
    prevTouchPlayerIndex: null,
    difficulty: options.difficulty ?? 'medium',
    offsideEnabled: options.offsideEnabled ?? true,
    // 試合開始キックオフはTeam Aが行う前提 (既存のcontrolledPlayerIndex初期値と同じ前提の踏襲)。
    restartGraceTeam: TeamId.A,
    restartGraceTicksLeft: KICKOFF_GRACE_TICKS,
    lastEvent: null,
  };
}
