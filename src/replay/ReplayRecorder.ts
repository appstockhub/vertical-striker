import type { Difficulty } from '../sim/state';
import type { Inputs } from '../sim/update';
import type { ReplayLog } from './replay';

/**
 * リプレイ記録の規約を1箇所に閉じ込める薄いクラス。
 *
 * 重要 (計画セクションG): 記録は simulate() が呼ばれるたびに1回、必ず fixedUpdate() 側から
 * 呼ぶこと。FixedTimestepLoop のcatch-upで1実フレームに fixedUpdate() が複数回呼ばれることが
 * あるため、実フレーム単位 (update() 側) で記録するとフレーム落ち時に記録漏れが起き、
 * リプレイが本編と食い違う。
 */
export class ReplayRecorder {
  private seed = 0;
  private difficulty: Difficulty = 'medium';
  private offsideEnabled = true;
  private inputsLog: Inputs[] = [];

  start(seed: number, difficulty: Difficulty, offsideEnabled: boolean): void {
    this.seed = seed;
    this.difficulty = difficulty;
    this.offsideEnabled = offsideEnabled;
    this.inputsLog = [];
  }

  /** simulate() を呼ぶ直前/直後のどちらでもよいが、渡す inputs は simulate() に渡したものと同一にすること。 */
  record(inputs: Inputs): void {
    this.inputsLog.push(inputs);
  }

  finish(): ReplayLog {
    return {
      seed: this.seed,
      difficulty: this.difficulty,
      offsideEnabled: this.offsideEnabled,
      inputs: this.inputsLog,
    };
  }
}
