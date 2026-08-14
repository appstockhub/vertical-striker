import { describe, expect, it } from 'vitest';
import { formatMatchSummary, runSimulatedMatch, type HumanPattern } from './matchSimulator';

/**
 * 観戦シミュレーターのレポート出力 (人間が読む用)。`npm run sim:report` で実行する。
 * 正常性の assert は soccerSanity.test.ts が担う。ここでは統計サマリの表示のみ。
 */
// 実プレイの現実的な組み合わせ: 攻撃的な人間は easy CPU 相手を選びがち、
// 守備的/放置は難しいCPU相手の耐久シナリオとして意味がある。
const MATRIX: Array<{ pattern: HumanPattern; difficulty: 'easy' | 'medium' | 'hard' }> = [
  { pattern: 'aggressive', difficulty: 'easy' },
  { pattern: 'passHeavy', difficulty: 'easy' },
  { pattern: 'defensive', difficulty: 'medium' },
  { pattern: 'idle', difficulty: 'medium' },
];

describe('match report (観戦シミュレーター)', () => {
  for (const { pattern, difficulty } of MATRIX) {
    it(
      `full match report: ${pattern} vs ${difficulty} CPU`,
      () => {
        const stats = runSimulatedMatch({ seed: 1, scriptSeed: 42, pattern, difficulty });
        console.log('\n' + formatMatchSummary(stats));
        console.log('--- events (first 40) ---');
        for (const e of stats.events.slice(0, 40)) console.log(e);
        expect(stats.ticks).toBeGreaterThan(0);
      },
      60000,
    );
  }
});
