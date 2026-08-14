import { emptyButtonState, emptyInputFrame, type InputFrame } from './types';
import { gamepadToInputFrame } from './gamepadMapping';

/**
 * navigator.getGamepads() のポーリング glue。
 * Gamepad API はイベントではなくポーリングでの状態取得が基本 (connected/disconnected
 * イベントは「接続の有無」のみを通知する)。
 */
export class GamepadSource {
  private padIndex: number | null = null;
  private prevButtons = emptyButtonState();

  isConnected(): boolean {
    return this.padIndex !== null;
  }

  /** 1フレーム分ポーリングして InputFrame を返す。パッド未接続なら空の入力を返す。 */
  sample(): InputFrame {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];

    if (this.padIndex === null || !pads[this.padIndex]) {
      // 最初に見つかった接続済みパッドを採用する。
      this.padIndex = null;
      for (let i = 0; i < pads.length; i++) {
        if (pads[i]) {
          this.padIndex = i;
          break;
        }
      }
    }

    if (this.padIndex === null) {
      this.prevButtons = emptyButtonState();
      return emptyInputFrame();
    }

    const pad = pads[this.padIndex];
    if (!pad) {
      this.padIndex = null;
      return emptyInputFrame();
    }

    const frame = gamepadToInputFrame(pad, this.prevButtons);
    this.prevButtons = frame.buttons;
    return frame;
  }
}
