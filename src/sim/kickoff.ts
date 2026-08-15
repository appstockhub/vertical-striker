import { toFixed, vZero, ZERO_FIXED } from '../core/fixed';
import type { Fixed } from '../core/types';
import { Direction8 } from '../input/types';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';
import { attackingIsUpward, FormationId, getHomePosition, PLAYERS_PER_TEAM, TeamId, type Half } from './formations';
import { KICKOFF_KICKER_STANDOFF_FIXED } from './boundsConstants';
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
    kickDribbleActive: false,
  };
}

function createTeamPlayersAtKickoff(team: TeamId, formationId: FormationId, half: Half): PlayerState[] {
  const players: PlayerState[] = [];
  for (let slotIndex = 0; slotIndex < PLAYERS_PER_TEAM; slotIndex++) {
    players.push(createPlayerAtKickoff(team, slotIndex, formationId, half));
  }
  return players;
}

/**
 * キックオフを行う選手の slotIndex。フォーメーション定義で最も前方 (depthFrac 0.85) の
 * FW を使う。Team A では players[9] となり、createInitialState の初期操作選手と一致するため、
 * 試合開始時にカーソルがそのままキッカーへ乗る。
 */
export const KICKOFF_TAKER_SLOT_INDEX = 9;

/**
 * 指定した半分(half)でのキックオフ配置を返す。ボールは常にセンターマーク上で静止。
 *
 * ★16周目★ kickoffTeam を渡すと、そのチームのキッカーをボールの手前 (自陣側) へ配置する。
 * 競技規則 第8条のキックオフを成立させるために必須:
 *   - 旧実装は全員をホームポジションに戻すだけだったため、キッカー役の FW もボールから
 *     135px 離れており、**相手の FW も同じ135pxの距離**にいた。つまり「自分のキックオフ」
 *     でも相手と同距離からの徒競走になり、普通に奪われた
 *     (ユーザー報告「点を決められてこちらのキックオフなのに敵が奪取できる」)。
 *   - キッカーはセンターマークより自陣側に立つ (規則「すべての競技者は自分のハーフ内に」)。
 * 相手をセンターサークル外に保つ拘束は update.ts の setPieceLock 側が担当する。
 */
export function placeKickoffFormation(
  half: Half,
  teamFormations: readonly [FormationId, FormationId],
  kickoffTeam?: TeamId,
): KickoffPlacement {
  const players = [
    ...createTeamPlayersAtKickoff(TeamId.A, teamFormations[TeamId.A], half),
    ...createTeamPlayersAtKickoff(TeamId.B, teamFormations[TeamId.B], half),
  ];
  const ballPos = { x: toFixed(PITCH_WIDTH / 2), y: toFixed(PITCH_HEIGHT * 0.5) };
  const ball: BallState = { pos: ballPos, vel: vZero(), height: ZERO_FIXED, zVel: ZERO_FIXED };

  if (kickoffTeam !== undefined) {
    const kickerIndex = kickoffTeam * PLAYERS_PER_TEAM + KICKOFF_TAKER_SLOT_INDEX;
    const kicker = players[kickerIndex];
    if (kicker) {
      // 自陣側 = 攻撃方向の逆。attackingIsUpward が true なら攻撃は -Y なので自陣側は +Y。
      const ownHalfSign = attackingIsUpward(kickoffTeam, half) ? 1 : -1;
      players[kickerIndex] = {
        ...kicker,
        pos: {
          x: ballPos.x,
          y: ((ballPos.y as number) + ownHalfSign * (KICKOFF_KICKER_STANDOFF_FIXED as number)) as Fixed,
        },
      };
    }
  }

  return { players, ball };
}
