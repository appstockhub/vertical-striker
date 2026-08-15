import { Direction8, ALL_LOGICAL_BUTTONS, type ButtonState, type InputFrame } from './types';
import { GamepadSource } from './gamepad';
import { KeyboardSource } from './keyboard';

/**
 * ゲームパッドとキーボードの2フレームを1つに合成する純関数。
 *
 * ★14周目の修正★ 旧実装は「パッドに何か入力があればパッドだけ、無ければキーボードだけ」
 * という切替式だった。この方式には実プレイ直結の落とし穴がある:
 *  - パッドを接続したままキーボードで遊ぶと、スティックのわずかなドリフトや
 *    置いたパッドに触れただけでキーボード入力が丸ごと無視される
 *  - 「キーボードで移動しながらパッドのボタンを押す」等の混在が一切成立しない
 * どちらも「ボタンを押しているのに反応しない」という体感になる。
 * 合成式 (ボタンはOR、方向は入力がある方を優先) なら、どちらのデバイスの入力も
 * 必ずsimに届く。純関数なので入力層として初めて単体テスト可能になった。
 */
export function mergeInputFrames(pad: InputFrame, keyboard: InputFrame): InputFrame {
  const buttons = {} as Record<string, boolean>;
  const buttonsPressed = {} as Record<string, boolean>;
  for (const b of ALL_LOGICAL_BUTTONS) {
    buttons[b] = pad.buttons[b] || keyboard.buttons[b];
    buttonsPressed[b] = pad.buttonsPressed[b] || keyboard.buttonsPressed[b];
  }
  const direction = pad.direction !== Direction8.None ? pad.direction : keyboard.direction;
  return {
    direction,
    buttons: buttons as ButtonState,
    buttonsPressed: buttonsPressed as ButtonState,
  };
}

/**
 * ゲームパッドとキーボードを統合し、1フレームにつき1回だけ InputFrame を生成する。
 * 固定タイムステップループが1フレームで複数回 simulate() を回す場合でも、
 * 同一フレーム内では同じ InputFrame を使い回す (呼び出し側が sample() を1回だけ呼ぶ)。
 */
export class InputManager {
  private readonly gamepad = new GamepadSource();
  private readonly keyboard: KeyboardSource;

  constructor(target: Window = window) {
    this.keyboard = new KeyboardSource(target);
  }

  isGamepadConnected(): boolean {
    return this.gamepad.isConnected();
  }

  sample(): InputFrame {
    return mergeInputFrames(this.gamepad.sample(), this.keyboard.sample());
  }
}
