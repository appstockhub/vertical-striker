/**
 * 固定タイムステップのゲームループ (アキュムレータ方式)。
 *
 * 実フレームレートに関わらず、シミュレーション (simulate) は常に 1/60 秒刻みで
 * 呼び出される。Phaser のシーンとは無関係な、フレームワーク非依存のクラス。
 */

export interface FixedTimestepLoopOptions {
  /** 1ステップあたりのミリ秒。既定 1000/60。 */
  stepMs?: number;
  /** 1回の tick() で消化する最大ステップ数 (スパイラル・オブ・デス対策)。 */
  maxStepsPerFrame?: number;
  /** 1ステップ経過するたびに呼ばれる。 */
  onFixedUpdate: () => void;
}

const DEFAULT_STEP_MS = 1000 / 60;
const DEFAULT_MAX_STEPS_PER_FRAME = 5;
/** rawDeltaMs のクランプ上限。タブのバックグラウンド化などで巨大な delta が来た場合の対策。 */
const MAX_RAW_DELTA_MS = 250;

export class FixedTimestepLoop {
  private readonly stepMs: number;
  private readonly maxStepsPerFrame: number;
  private readonly onFixedUpdate: () => void;
  private accumulatorMs = 0;

  constructor(options: FixedTimestepLoopOptions) {
    this.stepMs = options.stepMs ?? DEFAULT_STEP_MS;
    this.maxStepsPerFrame = options.maxStepsPerFrame ?? DEFAULT_MAX_STEPS_PER_FRAME;
    this.onFixedUpdate = options.onFixedUpdate;
  }

  /** 実フレームの経過時間 (ms) を渡す。必要な回数だけ onFixedUpdate を呼ぶ。 */
  tick(rawDeltaMs: number): void {
    const delta = Math.min(Math.max(rawDeltaMs, 0), MAX_RAW_DELTA_MS);
    this.accumulatorMs += delta;

    let steps = 0;
    while (this.accumulatorMs >= this.stepMs && steps < this.maxStepsPerFrame) {
      this.onFixedUpdate();
      this.accumulatorMs -= this.stepMs;
      steps += 1;
    }

    // 消化しきれなかった場合はスパイラルを避けるため余剰を捨てる。
    if (steps === this.maxStepsPerFrame) {
      this.accumulatorMs = 0;
    }
  }

  /**
   * 次の固定ステップまでの進捗度 (0〜1)。将来の描画補間 (interpolation) 用に予約。
   * Phase 0 では未使用 (直近の simulate 結果をそのまま描画する)。
   */
  get alpha(): number {
    return this.accumulatorMs / this.stepMs;
  }
}
