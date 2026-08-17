import { describe, expect, it } from 'vitest';
import { toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { STRONG_KICK_SPEED_FIXED } from '../../src/sim/ballConstants';
import { Direction8 } from '../../src/input/types';
import { createInitialState, TeamId, type GameState } from '../../src/sim/state';
import { humanCarrying, humanCarryingWithReceiver, runScript, step } from './harness';

/**
 * シナリオ: スルーパスとYパス。
 * parity-targets.md P2 (スルーパスの成立 = 北極星「スルーパスが通る快感」の機械判定) と
 * 不具合#2 (Yパスが誰にも飛ばない) に対応。
 */

const CARRIER = TeamId.A * 11 + 9;
const RECEIVER = TeamId.A * 11 + 10;

describe('シナリオ: スルーパス', () => {
  /**
   * ★北極星ゲート★ 前方150px・横30pxに味方FWが居る状態で、進行方向へAパス(グラウンダー)。
   * 「スルーパスが通った」= 受け手がボールを走りながら受け取り、受け取り地点が
   * 受け手の開始位置より前方(攻撃方向)であること。
   */
  it.fails('S-P1: Aパスが前方へ走り込むFWに通る [P2ゲート・北極星]', () => {
    const start = humanCarryingWithReceiver(150, 30, CARRIER, RECEIVER, 240, 1200);
    const receiverStartY = 1200 - 150;
    const { trace } = runScript(start, [
      step(10, Direction8.Up), // 前進して間合いを作る
      step(1, Direction8.Up, { A: true }), // A = 進行方向へのパス
      step(240, Direction8.None), // 受け手(AI)の走り込みを待つ
    ]);
    // 受け手がボールの touch-priority を獲得するtickを探す
    const receivedAt = trace.findIndex((t) => t.holderIndex === RECEIVER);
    expect(receivedAt, 'FWがボールを受け取れなかった(スルーパス不成立)').toBeGreaterThanOrEqual(0);
    const reception = trace[receivedAt]!;
    expect(
      reception.ballY,
      '受け取り地点が受け手の開始位置より後方(走り込みに通っていない)',
    ).toBeLessThan(receiverStartY - 10);
  });

  /**
   * ★不具合#2の再現シナリオ★ 実戦の陣形(初期フォーメーションのまま)で、ボールを持つ
   * MFがYを押してもパスが出ない。原因は候補選定(前方±60°/220px)が実戦の選手間隔に
   * 合わないこと。修正後に it へ昇格すること。
   */
  it.fails('S-P2: 実戦陣形でYパスが受け手に飛ぶ [不具合#2]', () => {
    const base = createInitialState(1, { difficulty: 'easy', offsideEnabled: false });
    // フォーメーションはそのまま、中盤の選手(index 5)へボールを渡す
    const carrierIndex = TeamId.A * 11 + 5;
    const carrier = base.players[carrierIndex]!;
    const state: GameState = {
      ...base,
      controlledPlayerIndex: carrierIndex,
      ball: { ...base.ball, pos: carrier.pos, vel: { x: ZERO_FIXED, y: ZERO_FIXED }, height: ZERO_FIXED, zVel: ZERO_FIXED },
      players: base.players.map((p, i) => (i === carrierIndex ? { ...p, facing: Direction8.Up } : p)),
      lastTouchTeam: TeamId.A,
      lastTouchPlayerIndex: carrierIndex,
    };
    const { trace } = runScript(state, [
      step(1, Direction8.None, { Y: true }),
      step(3, Direction8.None),
    ]);
    // Yを押した直後にボールがパス速度で飛び出していること (しきい値はキック定数由来 =
    // テンポ変更に自動追従する。パス初速はKICK_MIN_CHARGE時の強キック速度)
    const passSpeed = toFloat(STRONG_KICK_SPEED_FIXED) * 0.8;
    const maxSpeed = Math.max(...trace.map((t) => t.ballSpeed));
    expect(maxSpeed, 'Yを押してもパスが出ない').toBeGreaterThan(passSpeed);
  });

  /** 受け手が明確に射程内(前方100px)に居る無菌状態ならYパスが出る (現行でも成立する下限ゲート)。 */
  it('S-P3: 前方100pxの味方へはYパスが出る', () => {
    const start = humanCarryingWithReceiver(100, 0, CARRIER, RECEIVER, 240, 1200);
    const { trace } = runScript(start, [
      step(1, Direction8.None, { Y: true }),
      step(3, Direction8.None),
    ]);
    const passSpeed = toFloat(STRONG_KICK_SPEED_FIXED) * 0.8;
    const maxSpeed = Math.max(...trace.map((t) => t.ballSpeed));
    expect(maxSpeed, '無菌状態ですらYパスが出ない').toBeGreaterThan(passSpeed);
  });
});
