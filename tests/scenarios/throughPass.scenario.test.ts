import { describe, expect, it } from 'vitest';
import { toFixed, ZERO_FIXED } from '../../src/core/fixed';
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
   * ★北極星ゲート (24周目サイクル④で成立、it.fails→itへ昇格)★
   * 前方150pxの味方FWの頭を越えて前方空間へXロングフィード。「スルーパスが通った」=
   * 受け手が走りながらボールに追いつき、受け取り地点が開始位置より前方(攻撃方向)であること。
   * 実測: 受球は開始位置の +124.6px 前方 (t=270)。
   *
   * 設計の再定義 (旧: Aパスで150px先へ、から変更): グラウンダーの物理到達距離は
   * 自作 約48px / 原作実測換算でも約73px (T2初速×T4摩擦の等比和) であり、150px先への
   * グラウンダースルーは**原作の物理でも不可能**。150pxの走り込みに通すのは続編仕様の
   * X (ロングフィード) の役割で、こちらを北極星とする。近距離のグラウンダースルーは
   * S-P4 が担保する。成立に必要だった3修正:
   *   ① 追跡権を操作選手から除外 (teamAI.ts。パスを誰も迎えに行かない根本原因)
   *   ② Xを固定飛距離180pxの弾道へ (kick.ts applyLongFeed。旧実装は577px飛んだ)
   *   ③ 着地時の水平減衰 (ballPhysics.ts。着地後さらに175px転がって受け手を置き去りにした)
   *
   * パス後はUpを押し続ける: カーソルが受け手へ自動で切り替わり(実測t=41)、人間が
   * 受け手を走らせる — 原作のスルーパスの操作そのもの。受球判定はボールが足元の高さ
   * (≤2.0px、頭上の通過は受球ではない) にある時のみ。
   */
  it('S-P1: Xロングフィードが前方へ走り込むFWに通る [P2ゲート・北極星]', () => {
    const start = humanCarryingWithReceiver(150, 0, CARRIER, RECEIVER, 240, 1200);
    const receiverStartY = 1200 - 150;
    const { trace } = runScript(start, [
      step(10, Direction8.Up), // 前進して間合いを作る
      step(1, Direction8.Up, { X: true }), // X = ロングフィード (前方空間へ)
      step(400, Direction8.Up), // カーソルが受け手へ切り替わり、受け手を走り込ませる
    ]);
    const receivedAt = trace.findIndex((t) => t.holderIndex === RECEIVER && t.ballHeight <= 2.0);
    expect(receivedAt, 'FWがボールを受け取れなかった(スルーパス不成立)').toBeGreaterThanOrEqual(0);
    const reception = trace[receivedAt]!;
    // しきい値50px (批評役サイクル④付帯指摘2): 実測+124.6pxに対し旧10pxは緩すぎ、
    // 「+15pxのこぼれ受け」でも通ってしまう。「明確に走り込んで受けた」と言える下限として
    // 実測の約4割 = 50px をラチェットにする。
    expect(
      reception.ballY,
      '受け取り地点が受け手の開始位置より十分前方でない(走り込みに通っていない)',
    ).toBeLessThan(receiverStartY - 50);
  });

  /**
   * ★グラウンダースルー (サイクル④で新設)★ 前方30px・横30pxの味方の少し先の空間へ
   * Aパス(グラウンダー、到達約48px)。操作はキャリアのまま何もしない = AIの受け手が
   * 自発的に斜めへ走り込んで回収することを検証する (S-P1が「人間が受け手を走らせる」
   * 側を検証するのと対になる、AI側の走り込みゲート)。実測: 受球は開始位置の+26.3px前方。
   */
  it('S-P4: Aパスの前方空間へAIの受け手が走り込んで回収する', () => {
    const start = humanCarryingWithReceiver(30, 30, CARRIER, RECEIVER, 240, 1200);
    const receiverStartY = 1200 - 30;
    const { trace } = runScript(start, [
      step(10, Direction8.Up),
      step(1, Direction8.Up, { A: true }), // A = 進行方向へのグラウンダーパス
      step(300, Direction8.None), // 受け手(AI)の走り込みを待つ
    ]);
    const receivedAt = trace.findIndex((t) => t.holderIndex === RECEIVER && t.ballHeight <= 2.0);
    expect(receivedAt, 'AIの受け手がボールを回収できなかった').toBeGreaterThanOrEqual(0);
    const reception = trace[receivedAt]!;
    expect(
      reception.ballY,
      '受け取り地点が受け手の開始位置より後方(走り込みではなく戻って受けている)',
    ).toBeLessThan(receiverStartY - 10);
  });

  /**
   * ★不具合#2 → サイクル③で解消し昇格★ 3欠陥を修正した:
   * ① 候補選定を2段選抜へ (前方半平面優先→最近傍フォールバック、射程300px。cursor.ts)
   * ② Yの間合いをKICK_REACH(30px)へ統一 (ルーズボールでも射程内なら発火。resolveCursor)
   * ③ 実照準+距離連動の速度/弾道 (近距離グラウンダー/遠距離ロビング。applyAimedPass)
   */
  it('S-P2: 実戦陣形でYパスが受け手に飛ぶ [不具合#2→③で解消]', () => {
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
    // Yを押した直後にボールがパス速度で飛び出していること。しきい値はパス帯の下限
    // (PASS_MIN 1.4) とドリブルタッチ (1.2) の間 = 「パスが出た」ことだけを弁別する
    // (サイクル③でパスは applyAimedPass の 1.4〜2.2 帯になり、強キック基準では
    //  近距離パスを取りこぼすため)。
    const passSpeed = 1.3;
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
    const passSpeed = 1.3; // 同上 (パス帯下限1.4とドリブルタッチ1.2の間)
    const maxSpeed = Math.max(...trace.map((t) => t.ballSpeed));
    expect(maxSpeed, '無菌状態ですらYパスが出ない').toBeGreaterThan(passSpeed);
  });
});
