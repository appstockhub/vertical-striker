// SFC 論理ボタン名 (下=B, 右=A, 左=Y, 上=X) と 8方向の共通語彙。
// 物理デバイス (Gamepad / Keyboard) はどちらもこの語彙に変換されてから
// sim/ に渡される。sim/ 側は物理入力の詳細を一切知らない。

export enum LogicalButton {
  B = 'B',
  Y = 'Y',
  A = 'A',
  X = 'X',
  L = 'L',
  R = 'R',
  /** 続編仕様④(ライン操作)で新設。相手保持中=ディフェンスライン上げ、自チーム保持中=
   * オフェンスライン下げ(sim/update.tsのGameState.manualLineOffset参照)。SELECT(ポーズ)は
   * まだ未実装 — このプロジェクトはPause機能自体を持たないため、当面は追加しない。 */
  Start = 'Start',
}

export const ALL_LOGICAL_BUTTONS: readonly LogicalButton[] = [
  LogicalButton.B,
  LogicalButton.Y,
  LogicalButton.A,
  LogicalButton.X,
  LogicalButton.L,
  LogicalButton.R,
  LogicalButton.Start,
];

export enum Direction8 {
  None = 'None',
  Up = 'Up',
  UpRight = 'UpRight',
  Right = 'Right',
  DownRight = 'DownRight',
  Down = 'Down',
  DownLeft = 'DownLeft',
  Left = 'Left',
  UpLeft = 'UpLeft',
}

export type ButtonState = Readonly<Record<LogicalButton, boolean>>;

export function emptyButtonState(): ButtonState {
  return { B: false, Y: false, A: false, X: false, L: false, R: false, Start: false };
}

/** 1フレーム分の入力。sim/update.ts の Inputs はこの形をベースにする。 */
export interface InputFrame {
  readonly direction: Direction8;
  /** 現在押されているボタン。 */
  readonly buttons: ButtonState;
  /** このフレームで新たに押された (立ち上がり edge) ボタン。Phase 0 では未使用だが配線しておく。 */
  readonly buttonsPressed: ButtonState;
}

export function emptyInputFrame(): InputFrame {
  return {
    direction: Direction8.None,
    buttons: emptyButtonState(),
    buttonsPressed: emptyButtonState(),
  };
}
