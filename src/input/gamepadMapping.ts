import { type ButtonState, type InputFrame, Direction8, LogicalButton, emptyButtonState } from './types';

/**
 * ブラウザの実 Gamepad オブジェクトに構造的に一致する最小インターフェース。
 * DOM の Gamepad 型に依存しないことで、テストからは素のオブジェクトを渡せる。
 */
export interface RawPadLike {
  readonly buttons: readonly { readonly pressed: boolean }[];
  readonly axes: readonly number[];
}

/**
 * 標準 Gamepad API レイアウト (Xbox系パッド) のボタン index。
 * https://www.w3.org/TR/gamepad/#remapping
 */
const XBOX_BUTTON = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const;

/**
 * SFC 論理ボタン → Xbox 標準レイアウトの物理ボタン index。
 * SFC の物理配置 (下=B/右=A/左=Y/上=X) を位置対応でそのまま Xbox 配置に写す。
 * X→Xbox Y (index 3) は CLAUDE.md に明記が無く、対称性からの推測 (要実機確認)。
 */
const LOGICAL_TO_XBOX_INDEX: Record<LogicalButton, number> = {
  [LogicalButton.B]: XBOX_BUTTON.A, // 下
  [LogicalButton.A]: XBOX_BUTTON.B, // 右
  [LogicalButton.Y]: XBOX_BUTTON.X, // 左
  [LogicalButton.X]: XBOX_BUTTON.Y, // 上 (推測)
  [LogicalButton.L]: XBOX_BUTTON.LB,
  [LogicalButton.R]: XBOX_BUTTON.RB,
};

function isButtonPressed(pad: RawPadLike, index: number): boolean {
  return pad.buttons[index]?.pressed ?? false;
}

export function gamepadToButtonState(pad: RawPadLike): ButtonState {
  const state = emptyButtonState();
  const result: Record<string, boolean> = { ...state };
  for (const logical of Object.values(LogicalButton)) {
    result[logical] = isButtonPressed(pad, LOGICAL_TO_XBOX_INDEX[logical]);
  }
  return result as ButtonState;
}

const STICK_DEADZONE = 0.35;

/** 45度刻みの8方向テーブル。atan2 の結果をこのテーブルに丸める。 */
const EIGHT_WAY_DIRECTIONS: readonly Direction8[] = [
  Direction8.Right,
  Direction8.DownRight,
  Direction8.Down,
  Direction8.DownLeft,
  Direction8.Left,
  Direction8.UpLeft,
  Direction8.Up,
  Direction8.UpRight,
];

/**
 * アナログスティックの (x, y) を8方向に離散化する。
 * ここでの atan2/sqrt の使用は入力サンプリング層に限定されており、出力は
 * 離散値の Direction8 のみが simulate() に渡るため、sim/ の決定論制約
 * (超越関数禁止) には抵触しない。
 */
function stickToDirection8(x: number, y: number): Direction8 {
  const magnitude = Math.sqrt(x * x + y * y);
  if (magnitude < STICK_DEADZONE) {
    return Direction8.None;
  }
  // axes[1] は下方向が正なので、画面座標そのままの角度で atan2 する
  // (0rad = 右, 反時計回りが負角、Down = +y なので atan2(y, x) でよい)
  const angle = Math.atan2(y, x);
  const twoPi = Math.PI * 2;
  const normalized = ((angle % twoPi) + twoPi) % twoPi;
  const index = Math.round(normalized / (Math.PI / 4)) % 8;
  return EIGHT_WAY_DIRECTIONS[index] ?? Direction8.None;
}

function dpadToDirection8(pad: RawPadLike): Direction8 {
  const up = isButtonPressed(pad, XBOX_BUTTON.DPAD_UP);
  const down = isButtonPressed(pad, XBOX_BUTTON.DPAD_DOWN);
  const left = isButtonPressed(pad, XBOX_BUTTON.DPAD_LEFT);
  const right = isButtonPressed(pad, XBOX_BUTTON.DPAD_RIGHT);

  if (up && right) return Direction8.UpRight;
  if (up && left) return Direction8.UpLeft;
  if (down && right) return Direction8.DownRight;
  if (down && left) return Direction8.DownLeft;
  if (up) return Direction8.Up;
  if (down) return Direction8.Down;
  if (left) return Direction8.Left;
  if (right) return Direction8.Right;
  return Direction8.None;
}

export function gamepadToDirection8(pad: RawPadLike): Direction8 {
  const dpad = dpadToDirection8(pad);
  if (dpad !== Direction8.None) {
    return dpad;
  }
  const x = pad.axes[0] ?? 0;
  const y = pad.axes[1] ?? 0;
  return stickToDirection8(x, y);
}

export function gamepadToInputFrame(pad: RawPadLike, prevButtons: ButtonState): InputFrame {
  const buttons = gamepadToButtonState(pad);
  const buttonsPressed: Record<string, boolean> = { ...emptyButtonState() };
  for (const logical of Object.values(LogicalButton)) {
    buttonsPressed[logical] = buttons[logical] && !prevButtons[logical];
  }
  return {
    direction: gamepadToDirection8(pad),
    buttons,
    buttonsPressed: buttonsPressed as ButtonState,
  };
}
