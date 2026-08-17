import { Direction8, emptyButtonState, emptyInputFrame, type InputFrame, LogicalButton } from './types';

/** 矢印キー/WASD の4方向boolean → Direction8 のルックアップ。trig 不要。 */
function composeDirection(up: boolean, down: boolean, left: boolean, right: boolean): Direction8 {
  const v = up ? -1 : down ? 1 : 0; // 上下同時押しは打ち消し合う (中立)
  const h = left ? -1 : right ? 1 : 0;
  if (v === -1 && h === 0) return Direction8.Up;
  if (v === -1 && h === 1) return Direction8.UpRight;
  if (v === 0 && h === 1) return Direction8.Right;
  if (v === 1 && h === 1) return Direction8.DownRight;
  if (v === 1 && h === 0) return Direction8.Down;
  if (v === 1 && h === -1) return Direction8.DownLeft;
  if (v === 0 && h === -1) return Direction8.Left;
  if (v === -1 && h === -1) return Direction8.UpLeft;
  return Direction8.None;
}

const DIRECTION_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
]);

/**
 * SFC論理ボタンの仮キーボード割り当て (Phase 0 の動作確認用)。
 *
 * ★export している理由★ 画面のキー一覧 (input/keymapOverlay.ts) がこの定義を直接読む。
 * 一覧を別途手書きすると必ず食い違う (dd0fda6「ボタン表と実装の食い違いを全面修正」の再発)。
 * 割り当てを変えたら一覧は自動で追従する。
 */
export const BUTTON_KEYS: Record<string, LogicalButton> = {
  KeyZ: LogicalButton.B,
  KeyX: LogicalButton.A,
  KeyC: LogicalButton.Y,
  KeyV: LogicalButton.X,
  KeyQ: LogicalButton.L,
  KeyE: LogicalButton.R,
  // 続編仕様④(ライン操作)。Enter/Spaceは試合前設定オーバーレイ(matchSetupOverlay.ts)が
  // 既に「試合開始」に使っているため(このKeyboardSourceとは別の独立したリスナーだが、
  // 混同を避けるため)、WASD操作から押しやすいShiftを割り当てる。
  ShiftLeft: LogicalButton.Start,
};

export class KeyboardSource {
  private readonly held = new Set<string>();
  private prevButtons = emptyButtonState();

  constructor(target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (DIRECTION_KEYS.has(e.code) || e.code in BUTTON_KEYS) {
      e.preventDefault();
    }
    this.held.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };

  dispose(target: Window = window): void {
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
  }

  sample(): InputFrame {
    if (this.held.size === 0) {
      this.prevButtons = emptyButtonState();
      return emptyInputFrame();
    }

    const up = this.held.has('ArrowUp') || this.held.has('KeyW');
    const down = this.held.has('ArrowDown') || this.held.has('KeyS');
    const left = this.held.has('ArrowLeft') || this.held.has('KeyA');
    const right = this.held.has('ArrowRight') || this.held.has('KeyD');
    const direction = composeDirection(up, down, left, right);

    const buttons = { ...emptyButtonState() } as Record<LogicalButton, boolean>;
    for (const [code, logical] of Object.entries(BUTTON_KEYS)) {
      buttons[logical] = this.held.has(code);
    }

    const buttonsPressed = { ...emptyButtonState() } as Record<LogicalButton, boolean>;
    for (const logical of Object.values(LogicalButton)) {
      buttonsPressed[logical] = buttons[logical] && !this.prevButtons[logical];
    }
    this.prevButtons = buttons;

    return { direction, buttons, buttonsPressed };
  }
}
