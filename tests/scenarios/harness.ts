import { distSqFixed, toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { Direction8, emptyButtonState, type ButtonState } from '../../src/input/types';
import { createInitialState, TeamId, type GameState } from '../../src/sim/state';
import { simulate, type Inputs } from '../../src/sim/update';
import { findTouchPriorityPlayer } from '../../src/sim/ballTouch';

/**
 * ★操作シナリオ検証ハーネス (24周目、自律開発モードの機械判定基盤)★
 *
 * 目的: 「人間がこう操作したら、ゲームはこう応答すべき」を、人間入力を模した
 * スクリプトで再現し、成立/不成立を機械判定する。playability.test.ts が
 * 「1〜数tickの因果」を見るのに対し、ここは「数百tickの操作シーケンス全体」を見る。
 *
 * ラチェット規約 (tests/scenarios/README.md 参照):
 *   - 現在の実装で成立するシナリオは it(...) で書く = 回帰ゲート
 *   - 既知の不具合で不成立のシナリオは it.fails(...) で書く = 修正されると
 *     vitest が「fails指定なのに通った」とエラーを出し、it への昇格を強制する。
 *     これがラチェット(合格した項目は二度と後退させない)の機構になる。
 */

export const NEUTRAL: Inputs = { direction: Direction8.None, buttons: emptyButtonState() };

export function btn(held: Partial<Record<keyof ButtonState, boolean>>): ButtonState {
  return { ...emptyButtonState(), ...held } as ButtonState;
}

export function inputs(
  direction: Direction8,
  held: Partial<Record<keyof ButtonState, boolean>> = {},
): Inputs {
  return { direction, buttons: btn(held) };
}

/** 操作スクリプトの1ステップ: この入力を ticks 回続ける。 */
export interface ScriptStep {
  readonly ticks: number;
  readonly input: Inputs;
}

export function step(ticks: number, direction: Direction8, held: Partial<Record<keyof ButtonState, boolean>> = {}): ScriptStep {
  return { ticks, input: inputs(direction, held) };
}

/** tickごとの観測値。シナリオの成立判定はこのトレースに対して行う。 */
export interface TickObservation {
  readonly tick: number;
  readonly ballX: number;
  readonly ballY: number;
  readonly ballHeight: number;
  readonly ballSpeed: number;
  /** 操作選手とボールの距離 (px)。 */
  readonly carrierGap: number;
  /** このtickの touch-priority 保持者 index (null = 誰も保持していない)。 */
  readonly holderIndex: number | null;
  readonly controlledIndex: number;
}

export interface ScriptResult {
  readonly finalState: GameState;
  readonly trace: readonly TickObservation[];
}

export function ballSpeedOf(state: GameState): number {
  return Math.hypot(toFloat(state.ball.vel.x), toFloat(state.ball.vel.y));
}

export function distToBallPx(state: GameState, index: number): number {
  const p = state.players[index]!;
  return Math.sqrt(toFloat(distSqFixed(p.pos, state.ball.pos)));
}

export function holderOf(state: GameState): number | null {
  return findTouchPriorityPlayer(state.players, state.ball.pos, state.lastTouchPlayerIndex);
}

/** スクリプトを実行し、tickごとのトレースを返す。 */
export function runScript(start: GameState, script: readonly ScriptStep[]): ScriptResult {
  let state = start;
  const trace: TickObservation[] = [];
  let tick = 0;
  for (const s of script) {
    for (let i = 0; i < s.ticks; i++) {
      state = simulate(state, s.input);
      trace.push({
        tick,
        ballX: toFloat(state.ball.pos.x),
        ballY: toFloat(state.ball.pos.y),
        ballHeight: toFloat(state.ball.height),
        ballSpeed: ballSpeedOf(state),
        carrierGap: distToBallPx(state, state.controlledPlayerIndex),
        holderIndex: holderOf(state),
        controlledIndex: state.controlledPlayerIndex,
      });
      tick++;
    }
  }
  return { finalState: state, trace };
}

/**
 * 人間(Team A)が中盤でボールを足元に持っている無菌状態を作る
 * (playability.test.ts の humanCarrying と同じ構図。他の21人は遠くへ退避)。
 */
export function humanCarrying(carrierIndex = TeamId.A * 11 + 9, x = 240, y = 1000): GameState {
  const base = createInitialState(1, { difficulty: 'easy', offsideEnabled: false });
  const pos = { x: toFixed(x), y: toFixed(y) };
  return {
    ...base,
    controlledPlayerIndex: carrierIndex,
    ball: { ...base.ball, pos, vel: { x: ZERO_FIXED, y: ZERO_FIXED }, height: ZERO_FIXED, zVel: ZERO_FIXED },
    players: base.players.map((p, i) => {
      if (i === carrierIndex) return { ...p, pos, facing: Direction8.Up };
      const far = { x: toFixed(20 + (i % 5) * 30), y: toFixed(i < 11 ? 1700 : 120) };
      return { ...p, pos: far };
    }),
    lastTouchTeam: TeamId.A,
    lastTouchPlayerIndex: carrierIndex,
  };
}

/**
 * humanCarrying に「前方へ走り込む味方FW」を1人加えた状態
 * (スルーパスのシナリオ用。receiverIndex の選手をキャリアの前方 forwardPx ・
 * 横 lateralPx の位置に置く)。
 */
export function humanCarryingWithReceiver(
  receiverForwardPx: number,
  receiverLateralPx: number,
  carrierIndex = TeamId.A * 11 + 9,
  receiverIndex = TeamId.A * 11 + 10,
  x = 240,
  y = 1000,
): GameState {
  const base = humanCarrying(carrierIndex, x, y);
  return {
    ...base,
    players: base.players.map((p, i) => {
      if (i !== receiverIndex) return p;
      // half=1 の Team A は北(y=0)へ攻める。前方 = -y。
      return { ...p, pos: { x: toFixed(x + receiverLateralPx), y: toFixed(y - receiverForwardPx) }, facing: Direction8.Up };
    }),
  };
}
