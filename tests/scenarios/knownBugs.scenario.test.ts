import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { toFixed } from '../../src/core/fixed';
import { Direction8 } from '../../src/input/types';
import { TacklePhase } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { humanCarrying, inputs, runScript, step } from './harness';

/**
 * 凍結文書の既知不具合のうち、他のシナリオファイルで扱わないものの再現シナリオ。
 * (#7→dribbleControl / #6→kickoutDribble / #2→throughPass / #3→chargeKick は各ファイル参照)
 */

describe('シナリオ: 既知不具合の再現', () => {
  /**
   * ★不具合#1 → サイクル③で解消し昇格★ 旧実装は「facingと逆方向の入力」+「Bのedge」を
   * 同一tickに要求しており、人間には事実上不可能だった。反転検出で受付ウィンドウ
   * (PlayerState.liftWindowTicksLeft、LIFT_INPUT_WINDOW_TICKS=9) を開き、その間の
   * B押下でリフティングが発動するように修正した (承認済み設計どおり)。
   */
  it('S-B1: 反転の2tick後のBでリフティングが出る (人間に可能なタイミング) [不具合#1→③で解消]', () => {
    const { trace } = runScript(humanCarrying(undefined, 240, 1200), [
      step(60, Direction8.Up), // 上へドリブル (facing=Up が確定)
      step(2, Direction8.Down), // 反転 (ターンアクション)
      step(1, Direction8.Down, { B: true }), // 反転の直後にB
      step(20, Direction8.Down),
    ]);
    const maxHeight = Math.max(...trace.slice(60).map((t) => t.ballHeight));
    expect(maxHeight, '人間に可能なタイミングではリフティングが出ない').toBeGreaterThan(2);
  });

  /** 同一tick要求の現行仕様なら出る、の対照実験 (現行の挙動を記録するためのゲート)。 */
  it('S-B1c: 反転と同一tickのBならリフティングが出る (現行仕様の対照)', () => {
    const { trace } = runScript(humanCarrying(undefined, 240, 1200), [
      step(60, Direction8.Up),
      step(1, Direction8.Down, { B: true }), // 反転とBを同一tickに (機械なら可能)
      step(20, Direction8.Down),
    ]);
    const maxHeight = Math.max(...trace.slice(60).map((t) => t.ballHeight));
    expect(maxHeight, '対照実験: 同一tickでもリフティングが出なくなった(仕様変更を検知)').toBeGreaterThan(2);
  });

  /**
   * ★不具合#4 → サイクル③で解消し昇格★ B解放は KICK_WINDUP_TICKS(6) のワインドアップの
   * 後に発射されるようになった (GameState.windupKick)。原作実測 K1 (静止→最高速 3〜8tick)
   * の範囲内。ワインドアップ中の+字がカーブ受付窓を兼ねる (続編公式の「同時押し」の近似)。
   */
  it('S-B4: Bキックは押してから3tick以上のワインドアップの後に発射される [不具合#4→③で解消]', () => {
    let state = humanCarrying(undefined, 240, 1200);
    state = simulate(state, inputs(Direction8.Up, { B: true }));
    state = simulate(state, inputs(Direction8.Up)); // 解放 = ワインドアップ開始
    // 解放tickで即座に飛んでいたらワインドアップが無い
    const speedAtRelease = Math.hypot(
      (state.ball.vel.x as number) / 256,
      (state.ball.vel.y as number) / 256,
    );
    expect(speedAtRelease, 'キックが即時発射 (ワインドアップ無し)').toBeLessThan(1);
    // その後3〜10tickの間に発射される (しきい値はテンポ追従の相対値: 強キック2.7の8割)
    let fired = -1;
    for (let i = 0; i < 10; i++) {
      state = simulate(state, inputs(Direction8.None));
      const sp = Math.hypot((state.ball.vel.x as number) / 256, (state.ball.vel.y as number) / 256);
      if (sp > 2.1) {
        fired = i + 1;
        break;
      }
    }
    expect(fired, 'ワインドアップ後にキックが発射されない').toBeGreaterThanOrEqual(2);
  });

  /**
   * ★不具合#5 (sim側)★ ルーズボールへのA = スライディングが sim では正常に発動する。
   * これは現行でも成立する (凍結文書: 「simは正常発動、描画が読んでいないだけ」)。
   * 回帰ゲートとして固定する。
   */
  it('S-B5a: ルーズボールへのAでスライディング(tacklePhase)が発動する [不具合#5 sim側]', () => {
    let state = humanCarrying(undefined, 240, 1200);
    // ボールを前方40pxへ置いてルーズボールにする
    state = {
      ...state,
      ball: { ...state.ball, pos: { x: state.ball.pos.x, y: toFixed(1160) } },
    };
    state = simulate(state, inputs(Direction8.Up, { A: true }));
    const player = state.players[state.controlledPlayerIndex]!;
    expect(player.tacklePhase, 'Aでスライディングが発動しない').not.toBe(TacklePhase.None);
  });

  /**
   * ★不具合#5 (描画側) → サイクル③で解消し昇格★ スプライトの倒れ込み表現
   * (PitchScene が TacklePhase を読んで setAngle) と効果音 (SoundEventId.Slide) を配線した。
   * この静的検査は「配線が二度と切れない」ための回帰ゲート。画としての正しさは
   * キャプチャ+批評役判定で確認済み。
   */
  it('S-B5b: 描画層がtacklePhaseを読んでいる (スライディングの可視化配線) [不具合#5→③で解消]', () => {
    const sceneSrc = readFileSync('src/render/PitchScene.ts', 'utf-8');
    const soundSrc = readFileSync('src/render/SoundPlayer.ts', 'utf-8');
    const eventsSrc = readFileSync('src/render/soundEvents.ts', 'utf-8');
    expect(/TacklePhase\.Active/.test(sceneSrc), 'スプライトの倒れ込み表現 (TacklePhase参照) が消えた').toBe(true);
    expect(/slide/i.test(soundSrc) && /Slide/.test(eventsSrc), 'スライディング効果音の配線が消えた').toBe(true);
  });
});
