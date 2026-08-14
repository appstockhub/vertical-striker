import { createInitialState, type Difficulty, type GameState } from '../sim/state';
import { simulate, type Inputs } from '../sim/update';

/**
 * リプレイログの形式。決定論(seed付きPRNG + 純粋なsimulate(state,inputs))を利用し、
 * 「入力列だけで再生可能」を実現する (計画セクションG)。
 *
 * difficulty/offsideEnabledを持たせるのは計画段階で見つけたバグ潰し(#2):
 * これらが記録時と再生時で異なると、CPU攻撃AIの判断やオフサイド判定が食い違い、
 * 同じ入力列でも別の結果になってしまう (rngStateだけでは再現性を保証できない)。
 */
export interface ReplayLog {
  readonly seed: number;
  readonly difficulty: Difficulty;
  readonly offsideEnabled: boolean;
  readonly inputs: readonly Inputs[];
}

/** リプレイログから最終状態を再生する純関数。GameStateの履歴全体は保持せず、最終状態のみ返す。 */
export function replayToState(log: ReplayLog): GameState {
  let state = createInitialState(log.seed, { difficulty: log.difficulty, offsideEnabled: log.offsideEnabled });
  for (const inputs of log.inputs) {
    state = simulate(state, inputs);
  }
  return state;
}
