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
   * ★不具合#1★ リフティングは「facingと逆方向の入力」+「Bのedge」を同一tickに要求しており、
   * 人間には「反転入力と同フレームにBを押し始める」ことは事実上不可能。
   * 人間の実際の操作は「反転してから数フレーム以内にB」なので、反転検出で
   * turnActionTicksLeft を数フレーム立て、その間のB押下を受け付けるべき (承認済み設計)。
   * 修正後に it へ昇格すること。
   */
  it.fails('S-B1: 反転の2tick後のBでリフティングが出る (人間に可能なタイミング) [不具合#1]', () => {
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
   * ★不具合#4★ キックにモーション(ワインドアップ)が無く、ボールが即時発射される。
   * parity-targets.md K1: 原作は静止→最高速に3〜8tick (承認済み設計は6tickワインドアップ、
   * その間がカーブ受付窓)。修正後に it へ昇格すること。
   */
  it.fails('S-B4: Bキックは押してから3tick以上のワインドアップの後に発射される [不具合#4]', () => {
    let state = humanCarrying(undefined, 240, 1200);
    state = simulate(state, inputs(Direction8.Up, { B: true }));
    state = simulate(state, inputs(Direction8.Up)); // 解放 = キック開始
    // 解放tickで即座に飛んでいたらワインドアップが無い
    const speedAtRelease = Math.hypot(
      (state.ball.vel.x as number) / 256,
      (state.ball.vel.y as number) / 256,
    );
    expect(speedAtRelease, 'キックが即時発射 (ワインドアップ無し)').toBeLessThan(1);
    // その後3〜10tickの間に発射される
    let fired = -1;
    for (let i = 0; i < 10; i++) {
      state = simulate(state, inputs(Direction8.Up));
      const sp = Math.hypot((state.ball.vel.x as number) / 256, (state.ball.vel.y as number) / 256);
      if (sp > 5) {
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
   * ★不具合#5 (描画側)★ 描画/音/HUDのどこも tacklePhase を読んでおらず、スライディングが
   * 「見えない」。描画層が tacklePhase を参照するようになったら it へ昇格すること。
   * (シナリオテストから実描画は起動できないため、配線の静的検査で代替する。
   *  画としての正しさはサイクル③のキャプチャ+批評役判定で確認する)
   */
  it.fails('S-B5b: 描画層がtacklePhaseを読んでいる (スライディングの可視化配線) [不具合#5 描画側]', () => {
    // 注: PitchScene.ts のデバッグHUD文字列 (`tkl:`) は「見える化」に当たらないため対象外。
    // スプライト(ポーズ)か効果音のどちらかが tacklePhase / スライドを扱っていること。
    const spritesSrc = readFileSync('src/render/playerSprites.ts', 'utf-8');
    const soundSrc = readFileSync('src/render/SoundPlayer.ts', 'utf-8');
    const wired = /tacklePhase|slide|Slide/.test(spritesSrc) || /tackle|slide|Slide/i.test(soundSrc);
    expect(wired, 'スプライトも効果音もスライディングを表現していない (見えない・聞こえない)').toBe(true);
  });
});
