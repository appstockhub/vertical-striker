import { toFloat } from '../core/fixed';
import { Direction8, LogicalButton, type InputFrame } from '../input/types';
import type { GameState } from '../sim/state';
import { KICK_MAX_CHARGE_FRAMES } from '../sim/ballConstants';

/**
 * ★操作確認モード (ドリルモード) のデバッグ表示★ 描画専用の純関数。
 *
 * 段階2でユーザーが手触りを評価するために必要な「今なにが起きたか」を数値と名前で見せる。
 * 「押したのに発動しなかったのか、発動したが手応えが無いのか」を切り分けられることが目的。
 *
 * ここは表示のためだけの層で、GameState は読むだけ。sim/ には一切影響しない。
 */

/** 直近に発動した操作の記録 (画面に名前と数値を出すため)。 */
export interface DrillEvent {
  /** 表示名 (例: 「シフトキック(R)」)。 */
  readonly name: string;
  /** 発動時のボール水平速度 (px/tick)。 */
  readonly speed: number;
  /** 発動時の垂直初速。0 ならグラウンダー。 */
  readonly zVel: number;
  /** 発動時の溜めフレーム数 (チャージキック以外は0)。 */
  readonly charge: number;
  /** 発動した frame。 */
  readonly atFrame: number;
}

/** 直近のカーブの記録。 */
export interface DrillCurve {
  readonly direction: Direction8;
  readonly atFrame: number;
}

const BUTTON_LABEL: Readonly<Record<LogicalButton, string>> = {
  [LogicalButton.B]: 'B(Z)',
  [LogicalButton.Y]: 'Y(C)',
  [LogicalButton.A]: 'A(X)',
  [LogicalButton.X]: 'X(V)',
  [LogicalButton.L]: 'L(Q)',
  [LogicalButton.R]: 'R(E)',
  [LogicalButton.Start]: 'START(Shift)',
};

const DIRECTION_LABEL: Readonly<Record<Direction8, string>> = {
  [Direction8.None]: '・',
  [Direction8.Up]: '↑',
  [Direction8.UpRight]: '↗',
  [Direction8.Right]: '→',
  [Direction8.DownRight]: '↘',
  [Direction8.Down]: '↓',
  [Direction8.DownLeft]: '↙',
  [Direction8.Left]: '←',
  [Direction8.UpLeft]: '↖',
};

/**
 * ボールの状態変化から「いま何の操作が発動したか」を推定する。
 *
 * sim 側にイベントを持たせず描画側で推定する方式にしてあるのは、決定論の対象である
 * GameState を表示都合で太らせないため (段階1の「見た目の状態は GameState に持たせない」
 * 方針と同じ)。推定なので厳密ではないが、「発動したか / しなかったか」の判別には十分。
 */
export function classifyDrillEvent(
  prev: GameState,
  next: GameState,
  inputs: InputFrame | null,
): DrillEvent | null {
  const prevSpeed = Math.hypot(toFloat(prev.ball.vel.x), toFloat(prev.ball.vel.y));
  const speed = Math.hypot(toFloat(next.ball.vel.x), toFloat(next.ball.vel.y));
  const zVel = toFloat(next.ball.zVel);
  const prevZ = toFloat(prev.ball.zVel);

  // 「蹴った」= 水平速度が跳ねたか、垂直初速が新たに立ち上がったか。
  const kicked = speed - prevSpeed > KICK_SPEED_JUMP || (zVel > 0.4 && prevZ <= 0.4);
  if (!kicked) return null;

  const held = inputs?.buttons;
  const charge = prev.players[prev.controlledPlayerIndex]?.kickChargeFrames ?? 0;
  const stillMine =
    next.lastTouchPlayerIndex === next.controlledPlayerIndex && (next.ball.height as number) > 0;

  let name: string;
  if (stillMine && zVel > 0.4 && speed < 5) {
    name = 'リフティング';
  } else if (held?.Y) {
    name = 'Y カーソルパス';
  } else if (held?.A) {
    name = 'A 進行方向パス';
  } else if (held?.X) {
    name = 'X ロングフィード';
  } else if (charge > 0) {
    const shift = held?.R ? '(Rシフト)' : held?.L ? '(Lシフト)' : '';
    name = charge >= KICK_MAX_CHARGE_FRAMES * 0.6 ? `B 長押しシュート${shift}` : `B キック${shift}`;
  } else {
    name = 'キック';
  }

  return { name, speed, zVel, charge, atFrame: next.frame };
}

/** これ以上の速度の跳ね上がりがあれば「蹴った」とみなす (ドリブルタッチは3.6程度)。 */
const KICK_SPEED_JUMP = 2.0;

/** 押されているボタンと方向の1行表示。 */
export function formatInputLine(inputs: InputFrame | null): string {
  if (!inputs) return '入力: (なし)';
  const pressed = (Object.keys(BUTTON_LABEL) as LogicalButton[])
    .filter((b) => inputs.buttons[b])
    .map((b) => BUTTON_LABEL[b]);
  return `方向 ${DIRECTION_LABEL[inputs.direction]}   押下 [${pressed.join(' ') || '---'}]`;
}

/** 直近イベント + カーブの数値表示 (複数行)。 */
export function formatDrillPanel(
  state: GameState,
  inputs: InputFrame | null,
  lastEvent: DrillEvent | null,
  lastCurve: DrillCurve | null,
): string {
  const carrier = state.players[state.controlledPlayerIndex];
  const charge = carrier?.kickChargeFrames ?? 0;
  const ballSpeed = Math.hypot(toFloat(state.ball.vel.x), toFloat(state.ball.vel.y));
  const lines = [
    '── 操作確認モード  T:解除  R:ボールを足元へ ──',
    formatInputLine(inputs),
    `溜め ${charge}/${KICK_MAX_CHARGE_FRAMES}   ボール 速度${ballSpeed.toFixed(2)} 高さ${toFloat(state.ball.height).toFixed(1)}`,
    `蹴出しドリブル ${carrier?.kickDribbleActive ? 'ON' : 'off'}   ライン操作 ${toFloat(state.manualLineOffset).toFixed(0)}`,
  ];
  if (lastEvent) {
    const age = state.frame - lastEvent.atFrame;
    lines.push(
      `直近: ${lastEvent.name}  初速${lastEvent.speed.toFixed(2)} 弾道zVel${lastEvent.zVel.toFixed(2)} 溜め${lastEvent.charge}  (${age}f前)`,
    );
  } else {
    lines.push('直近: (まだ何も発動していません)');
  }
  if (lastCurve) {
    lines.push(`カーブ: ${DIRECTION_LABEL[lastCurve.direction]} 方向へ作用中/直近 (${state.frame - lastCurve.atFrame}f前)`);
  } else {
    lines.push('カーブ: (未発動)');
  }
  return lines.join('\n');
}
