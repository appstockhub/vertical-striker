import { toFixed, vZero, ZERO_FIXED } from '../core/fixed';
import { Direction8 } from '../input/types';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';
import { attackingIsUpward, FormationId, getHomePosition, PLAYERS_PER_TEAM, TeamId, type Half } from './formations';
import { TacklePhase } from './tacklePhase';
import type { BallState, PlayerState } from './state';

/**
 * キックオフ配置 (選手22人+ボール) を求める純関数。試合開始・後半開始・得点後リセットの
 * すべてがこの1関数を共有する (配置ロジックを3箇所に重複させない)。
 *
 * `PlayerState`/`BallState` は type-only import で参照する (state.ts への実行時
 * 依存を作らない)。state.ts の createInitialState はこの関数に委譲するため、
 * もし通常のimportで循環させると壊れやすい。TacklePhase/PLAYERS_PER_TEAM も
 * それぞれ独立ファイル/formations.ts に置くことで、state.ts への実行時依存を
 * 完全に断ち切っている。
 */
export interface KickoffPlacement {
  readonly players: PlayerState[];
  readonly ball: BallState;
}

function createPlayerAtKickoff(
  team: TeamId,
  slotIndex: number,
  formationId: FormationId,
  half: Half,
): PlayerState {
  const isGoalkeeper = slotIndex === 0;
  const pos = getHomePosition(team, slotIndex, formationId, half);
  // 攻撃方向 (上/下) を向く。半分に応じて向きが変わる (Phase 3 で修正した見落とし:
  // これを固定のままにすると、後半/得点後リセットで選手が逆向きのまま止まり、
  // 無方向キック(player.facingを使う)が自陣方向に誤射する、selectPassTargetの
  // 前方コーンが逆を向く、といった実害が出る)。
  const facing = attackingIsUpward(team, half) ? Direction8.Up : Direction8.Down;
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

function createTeamPlayersAtKickoff(team: TeamId, formationId: FormationId, half: Half): PlayerState[] {
  const players: PlayerState[] = [];
  for (let slotIndex = 0; slotIndex < PLAYERS_PER_TEAM; slotIndex++) {
    players.push(createPlayerAtKickoff(team, slotIndex, formationId, half));
  }
  return players;
}

/** 指定した半分(half)でのキックオフ配置を返す。ボールは常にピッチ中央、静止。 */
export function placeKickoffFormation(
  half: Half,
  teamFormations: readonly [FormationId, FormationId],
): KickoffPlacement {
  const players = [
    ...createTeamPlayersAtKickoff(TeamId.A, teamFormations[TeamId.A], half),
    ...createTeamPlayersAtKickoff(TeamId.B, teamFormations[TeamId.B], half),
  ];
  const ball: BallState = {
    pos: { x: toFixed(PITCH_WIDTH / 2), y: toFixed(PITCH_HEIGHT * 0.5) },
    vel: vZero(),
    height: ZERO_FIXED,
    zVel: ZERO_FIXED,
  };
  return { players, ball };
}
