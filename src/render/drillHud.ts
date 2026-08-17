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
  // L/R を押しながら蹴っていれば「シフトキック」。B だけでなく A/X/Y すべてに付く
  // (23周目に修正。旧実装は溜めキック時しか表示しておらず、A/X/Y でシフトを試した時に
  //  「効いていないのか、表示が無いだけか」が切り分けられなかった)。
  const shift = held?.R ? ' +Rシフト' : held?.L ? ' +Lシフト' : '';
  // ボールを受けたその tick に蹴っていれば「ワンツー」(即時リターン)。
  const justReceived =
    prev.lastTouchPlayerIndex !== next.controlledPlayerIndex &&
    next.lastTouchPlayerIndex === next.controlledPlayerIndex;

  let name: string;
  // リフティングは「ターンアクション中に蹴り上げる」動作なので、溜めキックとは別物。
  // ★charge === 0 の条件が無いと、B長押しでふかした球 (高く上がって水平速度が落ちる) を
  //   リフティングと誤表示する★ 23周目の実機確認で発覚した。
  if (stillMine && zVel > 0.4 && speed < 5 && charge === 0) {
    name = 'リフティング';
  } else if (held?.Y) {
    name = justReceived ? `ワンツー (Y カーソルパス)${shift}` : `Y カーソルパス${shift}`;
  } else if (held?.A) {
    name = justReceived ? `ワンツー (A 進行方向パス)${shift}` : `A 進行方向パス${shift}`;
  } else if (held?.X) {
    name = `X ロングフィード${shift}`;
  } else if (charge > 0) {
    const long = charge >= KICK_MAX_CHARGE_FRAMES * 0.6;
    // 続編仕様「Bは強く蹴ると高い弾道になりバーを越えることがある」の可視化。
    // 弾道が立った時に明示しないと「弱くなった」と誤解される (実際は威力が上へ逃げている)。
    const lofted = zVel > 2 ? ' ※弾道が高い(ふかし)' : '';
    name = `B ${long ? '長押し' : '短押し'}シュート${shift}${lofted}`;
  } else {
    name = `キック${shift}`;
  }

  return { name, speed, zVel, charge, atFrame: next.frame };
}

/**
 * 蹴り出しドリブル (L+R 同時押し) の発動。キックではないので classifyDrillEvent の
 * 速度跳ね上がり判定には掛からず、別途 off→on の立ち上がりで検出する。
 */
export function classifyKickDribbleStart(prev: GameState, next: GameState): DrillEvent | null {
  const before = prev.players[prev.controlledPlayerIndex]?.kickDribbleActive ?? false;
  const after = next.players[next.controlledPlayerIndex]?.kickDribbleActive ?? false;
  if (before || !after) return null;
  return {
    name: 'L+R 蹴り出しドリブル',
    speed: Math.hypot(toFloat(next.ball.vel.x), toFloat(next.ball.vel.y)),
    zVel: toFloat(next.ball.zVel),
    charge: 0,
    atFrame: next.frame,
  };
}

/**
 * ライン操作 (START) の発動。
 *
 * ★0 から動き出した瞬間だけ記録する★ オフセットは押している間 1tickごとに増え、離すと
 * 徐々に0へ戻るので、毎tick記録すると発動ログが一瞬で埋まって他の操作が流れてしまう
 * (23周目の実機確認で発覚)。現在値そのものはパネル上段に常時表示している。
 */
export function classifyLineShift(prev: GameState, next: GameState): DrillEvent | null {
  const before = toFloat(prev.manualLineOffset);
  const after = toFloat(next.manualLineOffset);
  if (before !== 0 || after === 0) return null;
  return {
    name: `START ライン操作 開始 (${after < 0 ? '後ろへ' : '前へ'})`,
    speed: 0,
    zVel: 0,
    charge: 0,
    atFrame: next.frame,
  };
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

/** 発動ログに残す件数。1項目ずつ試す評価では「直近1件」だと連続操作で流れてしまう。 */
export const DRILL_LOG_SIZE = 5;

/** 直近イベント + カーブの数値表示 (複数行)。 */
export function formatDrillPanel(
  state: GameState,
  inputs: InputFrame | null,
  log: readonly DrillEvent[],
  lastCurve: DrillCurve | null,
): string {
  const carrier = state.players[state.controlledPlayerIndex];
  const charge = carrier?.kickChargeFrames ?? 0;
  const ballSpeed = Math.hypot(toFloat(state.ball.vel.x), toFloat(state.ball.vel.y));
  const lines = [
    '── 操作確認モード   T:解除   R:ボールを足元へ   K:キー一覧 ──',
    formatInputLine(inputs),
    `溜め ${charge}/${KICK_MAX_CHARGE_FRAMES}   ボール 速度${ballSpeed.toFixed(2)} 高さ${toFloat(state.ball.height).toFixed(1)}`,
    `蹴出しドリブル ${carrier?.kickDribbleActive ? 'ON' : 'off'}   ライン操作 ${toFloat(state.manualLineOffset).toFixed(0)}`,
    lastCurve
      ? `カーブ: ${DIRECTION_LABEL[lastCurve.direction]} 方向 (${state.frame - lastCurve.atFrame}f前)`
      : 'カーブ: (未発動)',
    '── 発動ログ (新しい順) ──',
  ];
  if (log.length === 0) {
    lines.push('  (まだ何も発動していません)');
  } else {
    for (const event of log) {
      const age = state.frame - event.atFrame;
      const detail =
        event.speed > 0 || event.zVel > 0
          ? `初速${event.speed.toFixed(2)} 弾道${event.zVel.toFixed(2)} 溜め${event.charge}`
          : '';
      lines.push(`  ${String(age).padStart(4)}f前  ${event.name}  ${detail}`);
    }
  }
  return lines.join('\n');
}
