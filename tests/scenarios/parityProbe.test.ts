import { describe, expect, it } from 'vitest';
import { toFloat } from '../../src/core/fixed';
import { Direction8 } from '../../src/input/types';
import { humanCarrying, runScript, step } from './harness';

/**
 * ★パリティ・プローブ (24周目)★ docs/parity-targets.md の「現状値」を実測で出す。
 *
 * 定数からの机上換算ではなく、実際に simulate() を回した挙動から測る
 * (AI・ドリブルサーボ・摩擦の相互作用で、実効値は定数どおりにならないことがあるため)。
 * 単位は原作実測と同じ「身長/秒」(1身長 = 14.68 world px、60fps)。
 *
 * これは report + 粗い範囲ゲートのハイブリッド: パリティゲート本体の合否判定は
 * 批評役が parity-targets.md の許容範囲と照合して行うが、範囲を大きく外れたら
 * ここで即検知する (回帰ラチェット)。
 */

const HEIGHT_PX = 14.68;
const toHeightsPerSec = (pxPerTick: number) => (pxPerTick * 60) / HEIGHT_PX;

describe('パリティ・プローブ (原作実測との対比値)', () => {
  it('T1: 保持中の走速が 1.7〜2.7 身長/s (原作 med 2.15)', () => {
    const { trace } = runScript(humanCarrying(undefined, 240, 1700), [step(400, Direction8.Up)]);
    // 定常区間 (最初の60tickを除く) の選手速度: ボールYの変化ではなく実移動距離で測る
    const span = trace.slice(60);
    const dist = Math.hypot(0, span[0]!.ballY - span[span.length - 1]!.ballY);
    const pxPerTick = dist / (span.length - 1);
    const heightsPerSec = toHeightsPerSec(pxPerTick);
    console.log(`[parity] T1 walk-with-ball: ${pxPerTick.toFixed(3)} px/tick = ${heightsPerSec.toFixed(2)} 身長/s`);
    expect(heightsPerSec).toBeGreaterThanOrEqual(1.7);
    expect(heightsPerSec).toBeLessThanOrEqual(2.7);
  });

  it('T2: キック初速が 9〜14 身長/s (原作 lateral med 11.2)', () => {
    let state = humanCarrying(undefined, 240, 1400);
    const { finalState } = { finalState: state };
    let s = finalState;
    s = runScript(s, [step(1, Direction8.Up, { B: true }), step(1, Direction8.Up)]).finalState;
    const speed = Math.hypot(toFloat(s.ball.vel.x), toFloat(s.ball.vel.y));
    const heightsPerSec = toHeightsPerSec(speed);
    console.log(`[parity] T2 kick speed: ${speed.toFixed(3)} px/tick = ${heightsPerSec.toFixed(2)} 身長/s`);
    expect(heightsPerSec).toBeGreaterThanOrEqual(9);
    expect(heightsPerSec).toBeLessThanOrEqual(14);
  });

  it('T3: キック/走速の比が 4〜6 (原作 5.2)', () => {
    // T1/T2と同じ測り方の比。定数比 (2.7/0.525=5.14) の回帰ゲート
    const walk = runScript(humanCarrying(undefined, 240, 1700), [step(400, Direction8.Up)]);
    const span = walk.trace.slice(60);
    const walkPxPerTick =
      Math.abs(span[0]!.ballY - span[span.length - 1]!.ballY) / (span.length - 1);
    let s = humanCarrying(undefined, 240, 1400);
    s = runScript(s, [step(1, Direction8.Up, { B: true }), step(1, Direction8.Up)]).finalState;
    const kick = Math.hypot(toFloat(s.ball.vel.x), toFloat(s.ball.vel.y));
    const ratio = kick / walkPxPerTick;
    console.log(`[parity] T3 kick/run ratio: ${ratio.toFixed(2)}`);
    expect(ratio).toBeGreaterThanOrEqual(4);
    expect(ratio).toBeLessThanOrEqual(6);
  });

  it('D1/D2: ドリブルのギャップ中央値 0.3〜0.75身長・タッチ周期 6〜14tick (原作 med 0.51 / 9.6tick)', () => {
    const { trace } = runScript(humanCarrying(undefined, 240, 1700), [step(500, Direction8.Up)]);
    const gaps = trace.slice(60).map((t) => t.carrierGap).sort((a, b) => a - b);
    const gapMed = gaps[Math.floor(gaps.length / 2)]! / HEIGHT_PX;
    const speeds = trace.map((t) => t.ballSpeed);
    const peaks: number[] = [];
    for (let i = 61; i < speeds.length - 1; i++) {
      if (speeds[i]! > speeds[i - 1]! && speeds[i]! >= speeds[i + 1]! && speeds[i]! > 0.5) peaks.push(i);
    }
    const periods = peaks.slice(1).map((p, i) => p - peaks[i]!).sort((a, b) => a - b);
    const periodMed = periods[Math.floor(periods.length / 2)] ?? 0;
    console.log(`[parity] D1 gap med: ${(gapMed * HEIGHT_PX).toFixed(1)}px = ${gapMed.toFixed(2)} 身長 / D2 touch period med: ${periodMed} tick (n=${periods.length})`);
    expect(gapMed).toBeGreaterThanOrEqual(0.3);
    expect(gapMed).toBeLessThanOrEqual(0.75);
    expect(periodMed).toBeGreaterThanOrEqual(6);
    expect(periodMed).toBeLessThanOrEqual(14);
  });

  it('D3/D4: 蹴り出しドリブルの最大ギャップ 12〜26px・追いつき ≤54tick (原作 0.8〜1.8身長 / 18〜54tick)', () => {
    const { trace } = runScript(humanCarrying(undefined, 240, 1700), [
      step(60, Direction8.Up),
      step(1, Direction8.Up, { L: true, R: true }),
      step(120, Direction8.Up, { L: true }),
    ]);
    const after = trace.slice(61);
    // 最初の蹴り出しサイクルを測る (L押しっぱなしでは接触のたび再蹴り出しされるため、
    // 「最初のピーク」とそこからの追いつきを対象にする)
    let firstPeak = 0;
    let firstPeakIdx = 0;
    for (let i = 1; i < after.length; i++) {
      if (after[i]!.carrierGap > firstPeak) {
        firstPeak = after[i]!.carrierGap;
        firstPeakIdx = i;
      } else if (firstPeak > 12 && after[i]!.carrierGap < firstPeak - 3) {
        break; // ピークを過ぎて明確に閉じ始めた
      }
    }
    const catchTicks = after.slice(firstPeakIdx).findIndex((t) => t.carrierGap <= 10);
    console.log(`[parity] D3 kickout max gap: ${firstPeak.toFixed(1)}px (${(firstPeak / HEIGHT_PX).toFixed(2)}身長) / D4 catch-up: ${catchTicks} tick after peak`);
    expect(firstPeak).toBeGreaterThanOrEqual(12);
    expect(firstPeak).toBeLessThanOrEqual(26);
    expect(catchTicks).toBeGreaterThanOrEqual(0);
    expect(catchTicks).toBeLessThanOrEqual(54);
  });

  it('T4: 転がり摩擦が 0.960〜0.975/tick (原作 0.965)', () => {
    // キックで蹴り出した後の自由転がり区間から減衰率をフィット
    let s = humanCarrying(undefined, 240, 1400);
    const result = runScript(s, [
      step(1, Direction8.Up, { B: true }),
      step(1, Direction8.Up),
      step(40, Direction8.None),
    ]);
    const speeds = result.trace.slice(4, 40).map((t) => t.ballSpeed).filter((v) => v > 0.2);
    const ratios: number[] = [];
    for (let i = 1; i < speeds.length; i++) ratios.push(speeds[i]! / speeds[i - 1]!);
    const median = ratios.sort((a, b) => a - b)[Math.floor(ratios.length / 2)]!;
    console.log(`[parity] T4 rolling friction: ${median.toFixed(4)} /tick (n=${ratios.length})`);
    expect(median).toBeGreaterThanOrEqual(0.96);
    expect(median).toBeLessThanOrEqual(0.975);
  });
});
