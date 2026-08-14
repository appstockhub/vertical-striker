import { toFixed } from '../core/fixed';
import type { Fixed, Vec2Fixed } from '../core/types';
import { PITCH_HEIGHT, PITCH_WIDTH } from '../config/pitch';
import { TeamId, teamDefendsNorth, type Half } from './formations';
import { BALL_RADIUS_FIXED } from './ballConstants';
import { GOAL_CENTER_X_FIXED, GOAL_HALF_WIDTH_FIXED } from './goalkeeperConstants';
import {
  CORNER_INSET_FIXED,
  CROSSBAR_HEIGHT_FIXED,
  GOAL_KICK_DEPTH_FIXED,
  THROW_IN_INSET_FIXED,
  THROW_IN_Y_MARGIN_FIXED,
} from './boundsConstants';

export type BoundaryEvent =
  | { readonly type: 'goal'; readonly scoringTeam: TeamId }
  | { readonly type: 'throwIn'; readonly restartTeam: TeamId; readonly pos: Vec2Fixed }
  | { readonly type: 'goalKick'; readonly restartTeam: TeamId; readonly pos: Vec2Fixed }
  | { readonly type: 'corner'; readonly restartTeam: TeamId; readonly pos: Vec2Fixed };

function otherTeam(team: TeamId): TeamId {
  return team === TeamId.A ? TeamId.B : TeamId.A;
}

const PITCH_WIDTH_FIXED = toFixed(PITCH_WIDTH) as number;
const PITCH_HEIGHT_FIXED = toFixed(PITCH_HEIGHT) as number;
const BALL_RADIUS = BALL_RADIUS_FIXED as number;

/**
 * ボール(クランプ前の仮位置)がこのtickで境界を越えたかを判定する純関数。
 * `tentativePos` は sim/ballPhysics.ts の stepBallPhysicsDetailed が返す
 * 「クランプ前」の位置 (クランプ後の位置では境界越えを検出できないため必須)。
 *
 * 判定しきい値はボール半径ぶん内側にする (ball.pos は中心座標なので、中心が
 * ちょうどラインに一致した時点では既に先端がラインを割っている、という円の物理的な
 * 意味に合わせる)。これは clampToPitchBounds が使うクランプ境界 (PITCH_BOUNDS ± 半径) と
 * 完全に一致させる必要がある重要な整合性: もし判定しきい値をクランプ境界より外側
 * (真のライン位置ちょうど) に置くと、減速しながらラインに近づくボールが「クランプで
 * 半径ぶん手前に押し戻される→残り半径ぶんを一度に進める速度が無い→二度と判定しきい値に
 * 届かない」という物理的な「詰み」状態に落ち込み、転がる強シュートがゴールライン手前
 * 数px で永遠に静止して二度とゴール/アウトと判定されない、という実プレイで発覚した
 * 深刻なバグがあった (計画時は未発見。milestone3-4のテストは境界を大きく割った位置に
 * ボールを直接置く形だったため、減速しながら自然に近づく実際の物理挙動では踏んでいなかった)。
 *
 * 判定優先順位 (計画セクションC): 同tickでゴールラインとサイドラインを同時に
 * 越えた場合 (コーナー付近) はゴールライン判定を優先する。
 */
export function detectBoundaryEvent(
  tentativePos: Vec2Fixed,
  ballHeight: Fixed,
  half: Half,
  lastTouchTeam: TeamId | null,
): BoundaryEvent | null {
  const x = tentativePos.x as number;
  const y = tentativePos.y as number;

  if (y <= BALL_RADIUS || y >= PITCH_HEIGHT_FIXED - BALL_RADIUS) {
    const edgeIsNorth = y <= BALL_RADIUS;
    const teamADefendsNorth = teamDefendsNorth(TeamId.A, half);
    const defendingTeam = edgeIsNorth === teamADefendsNorth ? TeamId.A : TeamId.B;
    const attackingTeam = otherTeam(defendingTeam);

    const withinGoalWidth = Math.abs(x - (GOAL_CENTER_X_FIXED as number)) <= (GOAL_HALF_WIDTH_FIXED as number);
    const underCrossbar = (ballHeight as number) <= (CROSSBAR_HEIGHT_FIXED as number);
    if (withinGoalWidth && underCrossbar) {
      return { type: 'goal', scoringTeam: attackingTeam };
    }

    // ゴールにならなかった枠外/バー超え: 最後に触れたのが守備側ならコーナー(攻撃側)、
    // それ以外(攻撃側が最後に触れた、またはlastTouchTeamが無い)ならゴールキック(守備側)。
    const cornerToAttacker = lastTouchTeam === defendingTeam;
    const restartTeam = cornerToAttacker ? attackingTeam : defendingTeam;
    const restartX = cornerToAttacker
      ? x < (GOAL_CENTER_X_FIXED as number)
        ? (CORNER_INSET_FIXED as number)
        : PITCH_WIDTH_FIXED - (CORNER_INSET_FIXED as number)
      : (GOAL_CENTER_X_FIXED as number);
    const restartY = edgeIsNorth
      ? cornerToAttacker
        ? (CORNER_INSET_FIXED as number)
        : (GOAL_KICK_DEPTH_FIXED as number)
      : cornerToAttacker
        ? PITCH_HEIGHT_FIXED - (CORNER_INSET_FIXED as number)
        : PITCH_HEIGHT_FIXED - (GOAL_KICK_DEPTH_FIXED as number);

    return {
      type: cornerToAttacker ? 'corner' : 'goalKick',
      restartTeam,
      pos: { x: restartX as Fixed, y: restartY as Fixed },
    };
  }

  if (x <= BALL_RADIUS || x >= PITCH_WIDTH_FIXED - BALL_RADIUS) {
    // ゴールラインを跨いでいない場合のみサイドライン判定へ進む。復帰チームは
    // 最後に触れた側の相手 (lastTouchTeamが無ければ安全側のデフォルトとしてTeam A)。
    const restartTeam = lastTouchTeam !== null ? otherTeam(lastTouchTeam) : TeamId.A;
    const restartX =
      x <= BALL_RADIUS ? (THROW_IN_INSET_FIXED as number) : PITCH_WIDTH_FIXED - (THROW_IN_INSET_FIXED as number);
    const restartY = Math.min(
      Math.max(y, THROW_IN_Y_MARGIN_FIXED as number),
      PITCH_HEIGHT_FIXED - (THROW_IN_Y_MARGIN_FIXED as number),
    );
    return { type: 'throwIn', restartTeam, pos: { x: restartX as Fixed, y: restartY as Fixed } };
  }

  return null;
}
