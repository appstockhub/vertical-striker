import { describe, expect, it } from 'vitest';
import { distSqFixed, toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { Direction8, emptyButtonState } from '../../src/input/types';
import { createInitialState, TeamId, type GameState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { BALL_TEMPO } from '../../src/sim/tempo';

/**
 * ★キーパーがボールを確保している間の保護 (競技規則 第12条)★
 *
 * 実サッカーでは、キーパーが手でボールをコントロールしている間、相手はそのボールに
 * チャレンジできない (できたら反則)。キーパーは保持したあと配球する。
 *
 * 旧実装では applySave の 'secured' が「キーパーの位置に速度0で置く」だけだったため、
 * 目の前に詰めていた攻撃側がそのまま touch-priority を取り、キャッチした次の瞬間に
 * 奪ってシュート、という現実にはあり得ない挙動が起きうる。
 * (ユーザーの実プレイ報告「破綻しているでしょ、サッカーのルールに」と同じ種類の欠落)
 */

const NO_INPUT = { direction: Direction8.None, buttons: emptyButtonState() };

/** Team B のGKが自陣ゴール前でボールを確保し、Team A の攻撃者が至近に詰めている状況。 */
function gkSecuredWithAttackerClose(): GameState {
  const base = createInitialState(11, { difficulty: 'medium', offsideEnabled: false });
  const gkIndex = TeamId.B * 11; // Team B の GK
  const attacker = TeamId.A * 11 + 9;
  // half=1 では Team B は北(y=0)を守る。
  const gkPos = { x: toFixed(240), y: toFixed(30) };
  const shot = { x: toFixed(240), y: toFixed(60) };
  let state: GameState = {
    ...base,
    controlledPlayerIndex: attacker,
    players: base.players.map((p, i) => {
      if (i === gkIndex) return { ...p, pos: gkPos };
      if (i === attacker) return { ...p, pos: { x: toFixed(240), y: toFixed(46) }, facing: Direction8.Up };
      return { ...p, pos: { x: toFixed(30 + (i % 4) * 40), y: toFixed(i < 11 ? 1500 : 400) } };
    }),
    // ゆっくりGKへ向かうボール = キャッチ可能 (速いボールは弾く仕様)。
    // テンポ変更追従: キック系速度は BALL_TEMPO 倍。旧値の -3 のままだと今の
    // CATCH_MAX_SPEED (9.5×0.3=2.85) を超えてしまい「弾く」側に化けるため、
    // 同率でスケールする (-4×0.3=-1.2。実測: 7tick目にキャッチ成立)。
    // サイクル②追従: 低速減衰帯(<1.25px/tick)の導入で、1.2のボールは数pxで沈んでGKに
    // 届かなくなった。セーブ文脈(≥1.35)・キャッチ上限(≤2.85)・減衰帯(>1.25)をすべて
    // 満たす2.0で「キャッチすべきシュート」を作る。
    ball: { pos: shot, vel: { x: ZERO_FIXED, y: toFixed(-2.0) }, height: ZERO_FIXED, zVel: ZERO_FIXED },
    lastTouchTeam: TeamId.A,
    lastTouchPlayerIndex: attacker,
    setPieceLock: null,
  };
  // キャッチが成立するまで進める。
  for (let i = 0; i < 20; i++) {
    state = simulate(state, NO_INPUT);
    if (state.lastTouchTeam === TeamId.B) return state;
  }
  throw new Error('テストの前提が崩れている: GKがキャッチしなかった');
}

describe('キーパーのボール保持 (競技規則 第12条)', () => {
  it('キャッチした瞬間、ボールはキーパーの手中にある (保持がキーパー側)', () => {
    const state = gkSecuredWithAttackerClose();
    expect(state.lastTouchTeam).toBe(TeamId.B);
    const gk = state.players[TeamId.B * 11]!;
    expect(Math.sqrt(toFloat(distSqFixed(gk.pos, state.ball.pos))), 'ボールがキーパーの手元にない').toBeLessThan(12);
  });

  it('★保持中は相手が奪えない★ 至近の攻撃者がタックル/チャージしてもボールは奪われない', () => {
    let state = gkSecuredWithAttackerClose();
    for (let i = 0; i < 60; i++) {
      // 攻撃者はキーパーへ向かって突っ込み、B(タックル)とY(チャージ)を押し続ける。
      state = simulate(state, { direction: Direction8.Up, buttons: { ...emptyButtonState(), B: true, Y: true } });
      expect(state.lastTouchTeam, `t${i}: キーパーの保持中に相手がボールを奪った`).toBe(TeamId.B);
    }
  });

  it('キーパーは保持したまま止まらない (一定時間内に配球して試合が再開する)', () => {
    let state = gkSecuredWithAttackerClose();
    let released = false;
    for (let i = 0; i < 240 && !released; i++) {
      state = simulate(state, NO_INPUT);
      const speed = Math.hypot(toFloat(state.ball.vel.x), toFloat(state.ball.vel.y));
      if (speed > 0.5) released = true;
    }
    expect(released, 'キーパーがボールを抱えたまま試合が止まる').toBe(true);
  });
});
