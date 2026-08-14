import { Direction8, type InputFrame } from './types';
import { GamepadSource } from './gamepad';
import { KeyboardSource } from './keyboard';

/**
 * ゲームパッドとキーボードを統合し、1フレームにつき1回だけ InputFrame を生成する。
 * 固定タイムステップループが1フレームで複数回 simulate() を回す場合でも、
 * 同一フレーム内では同じ InputFrame を使い回す (呼び出し側が sample() を1回だけ呼ぶ)。
 *
 * 優先順位: そのフレームでゲームパッドが方向/ボタンいずれかを入力していればゲームパッド、
 * そうでなければキーボードを採用する。
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
    const padFrame = this.gamepad.sample();
    const padActive =
      padFrame.direction !== Direction8.None || Object.values(padFrame.buttons).some(Boolean);
    if (padActive) {
      return padFrame;
    }
    return this.keyboard.sample();
  }
}
