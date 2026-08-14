import { distSqFixed, fixedMul, toFixed } from '../core/fixed';
import type { Fixed } from '../core/types';
import type { GameState } from '../sim/state';
import { getHalf, isFulltime } from '../sim/matchClock';

/**
 * 効果音イベントの識別子 (計画セクションH)。実アセットの調達・埋め込みはスコープ外。
 * simulate()のシグネチャは変更せず、描画側で前後のGameStateを比較する純関数として実装する
 * (既存の全simulate()呼び出し箇所への影響をゼロにするため)。
 */
export enum SoundEventId {
  Kick = 'kick',
  Goal = 'goal',
  HalfTimeWhistle = 'halfTimeWhistle',
  FullTimeWhistle = 'fullTimeWhistle',
  RestartWhistle = 'restartWhistle',
}

/** この距離を1tickで超えて動いたら「テレポートされた」とみなす (px、仮値)。
 * STRONG_KICK_SPEED_FIXED(9px/tick)を大きく上回る値にして、通常のキックと混同しないようにする。 */
const TELEPORT_DISTANCE_FIXED: Fixed = toFixed(20);
const TELEPORT_DISTANCE_SQ_FIXED: Fixed = fixedMul(TELEPORT_DISTANCE_FIXED, TELEPORT_DISTANCE_FIXED);

/**
 * 前後のtickのGameStateを比較し、このtickで発生した効果音イベントを列挙する。
 *
 * - 得点: score配列の変化を直接比較 (確実)。
 * - 前後半/試合終了の笛: matchClock.tsのgetHalf/isFulltimeの変化を直接比較。
 * - タッチ/キック音: lastTouchTeamの変化 (nullでない値に変わった時のみ。simulate()側の設計で
 *   「本当にボールに触れた瞬間」にのみ変化するため確実に検出できる)。
 * - リスタートの笛: ボールの1tickあたり移動距離が通常物理では絶対に出ない大きさを超えた場合
 *   (テレポート、計画セクションC)。得点/前後半のリセットも大きなテレポートを伴うため、
 *   それらと重複する場合は二重に鳴らさない (得点/前後半のイベントを優先する)。
 */
export function detectSoundEvents(prev: GameState, next: GameState): SoundEventId[] {
  const events: SoundEventId[] = [];

  const scored = next.score[0] > prev.score[0] || next.score[1] > prev.score[1];
  if (scored) events.push(SoundEventId.Goal);

  const halfChanged = getHalf(next.frame) !== getHalf(prev.frame);
  if (halfChanged) events.push(SoundEventId.HalfTimeWhistle);

  if (!isFulltime(prev.frame) && isFulltime(next.frame)) {
    events.push(SoundEventId.FullTimeWhistle);
  }

  if (!scored && next.lastTouchTeam !== null && next.lastTouchTeam !== prev.lastTouchTeam) {
    events.push(SoundEventId.Kick);
  }

  if (!scored && !halfChanged) {
    const distSq = distSqFixed(prev.ball.pos, next.ball.pos);
    if ((distSq as number) > (TELEPORT_DISTANCE_SQ_FIXED as number)) {
      events.push(SoundEventId.RestartWhistle);
    }
  }

  return events;
}
