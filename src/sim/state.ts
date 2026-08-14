import { toFixed, vZero, ZERO_FIXED } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { createRng, type RngState } from '../core/rng';
import { Direction8, emptyButtonState, type ButtonState } from '../input/types';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';
import { FormationId, getHomePosition, TeamId } from './formations';

export { TeamId };

export enum TacklePhase {
  None = 'None',
  Windup = 'Windup',
  Active = 'Active',
  Recovery = 'Recovery',
}

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
 */
export interface GameState {
  readonly frame: number;
  readonly rngState: RngState;
  readonly players: PlayerState[];
  readonly ball: BallState;
  /** 現在人間が操作している選手の players[] index。Phase 2 では常に Team A (0..10)。 */
  readonly controlledPlayerIndex: number;
  /** 前tickの物理ボタン状態 (edge判定用。InputFrame.buttonsPressed は経由しない、Phase 1と同じ方針)。 */
  readonly prevButtons: ButtonState;
  readonly teamFormations: readonly [FormationId, FormationId];
}

/** 1チームあたりの人数 (GK含む)。他モジュールからも参照する共通定数。 */
export const PLAYERS_PER_TEAM = 11;
/** 1チームあたりのフィールドプレイヤー数 (GK除く)。 */
export const OUTFIELD_PER_TEAM = 10;

function createPlayer(team: TeamId, slotIndex: number, formationId: FormationId): PlayerState {
  const isGoalkeeper = slotIndex === 0;
  const pos = getHomePosition(team, slotIndex, formationId);
  // Team A は y=0 方向 (上) へ攻めるので Up を向く。Team B はその逆で Down。
  const facing = team === TeamId.A ? Direction8.Up : Direction8.Down;
  return {
    pos,
    vel: vZero(),
    facing,
    kickChargeFrames: 0,
    team,
    isGoalkeeper,
    slotIndex,
    tacklePhase: TacklePhase.None,
    tackleFrames: 0,
    tackleDirection: Direction8.None,
  };
}

function createTeamPlayers(team: TeamId, formationId: FormationId): PlayerState[] {
  const players: PlayerState[] = [];
  for (let slotIndex = 0; slotIndex < PLAYERS_PER_TEAM; slotIndex++) {
    players.push(createPlayer(team, slotIndex, formationId));
  }
  return players;
}

export function createInitialState(seed: number): GameState {
  const teamFormations: [FormationId, FormationId] = [FormationId.F442, FormationId.F442];
  const players = [
    ...createTeamPlayers(TeamId.A, teamFormations[0]),
    ...createTeamPlayers(TeamId.B, teamFormations[1]),
  ];

  // キックオフ時の操作選手: Team A の最初のFW (4-4-2ならslotIndex=9、DF4+MF4の次)。
  // ボールが PITCH_HEIGHT*0.5 付近に置かれるため、比較的近い位置の選手を初期操作対象にする。
  const controlledPlayerIndex = TeamId.A * PLAYERS_PER_TEAM + 9;

  return {
    frame: 0,
    rngState: createRng(seed),
    players,
    ball: {
      pos: { x: toFixed(PITCH_WIDTH / 2), y: toFixed(PITCH_HEIGHT * 0.5) }, // キックオフ位置 (Phase 1と同じ中央)
      vel: vZero(),
      height: ZERO_FIXED,
      zVel: ZERO_FIXED,
    },
    controlledPlayerIndex,
    prevButtons: emptyButtonState(),
    teamFormations,
  };
}
