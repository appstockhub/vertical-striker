import { BUTTON_KEYS } from './keyboard';
import { LogicalButton } from './types';

/**
 * キーボード割り当ての一覧表示 (K キーで開閉、23周目に新設)。
 *
 * 段階2の手触り評価にあたって、「どのキーが何に対応するか」を画面上で確認できるようにする。
 * 画面下端のボタンガイド (buttonGuide.ts) は**文脈ごとの役割**を出すもので、
 * キーそのものの一覧ではなかった。
 *
 * ★論理ボタンの行は keyboard.ts の BUTTON_KEYS から自動生成する★
 * 一覧を手書きすると必ず実装と食い違う (過去にコミット dd0fda6 で全面修正した実績がある)。
 * 割り当てを変更すれば、この一覧は何もしなくても追従する。
 */

/** 論理ボタンの意味 (文脈依存なので代表的な役割を1行で)。CLAUDE.md「続編仕様」準拠。 */
const BUTTON_ROLE: Readonly<Record<LogicalButton, string>> = {
  [LogicalButton.B]: 'シュート / クリア / ショルダーチャージ（押す長さで強さと弾道）',
  [LogicalButton.Y]: 'パスカーソル先へパス / スライディングタックル',
  [LogicalButton.A]: '進行方向へパス / スライディング / ヘディング',
  [LogicalButton.X]: 'ロングフィード・センタリング / ショルダーチャージ',
  [LogicalButton.L]: 'シフトキック（左へオフセット） / 蹴り出しドリブル（L+R）',
  [LogicalButton.R]: 'シフトキック（右へオフセット） / 蹴り出しドリブル（L+R）',
  [LogicalButton.Start]: 'ライン操作（保持中=オフェンスライン下げ / 守備中=DFライン上げ）',
};

/** SFCの物理ボタン名 (原作の配置。CLAUDE.md の表と対応させるため併記する)。 */
const SFC_LABEL: Readonly<Record<LogicalButton, string>> = {
  [LogicalButton.B]: 'B（下）',
  [LogicalButton.Y]: 'Y（左）',
  [LogicalButton.A]: 'A（右）',
  [LogicalButton.X]: 'X（上）',
  [LogicalButton.L]: 'L',
  [LogicalButton.R]: 'R',
  [LogicalButton.Start]: 'START',
};

/** 論理ボタン以外の、UI・モード切替のキー (sim へは渡らない)。 */
const UTILITY_KEYS: ReadonlyArray<{ key: string; role: string }> = [
  { key: '↑↓←→ / WASD', role: '移動・ドリブル方向（8方向）' },
  { key: 'Enter', role: '試合開始（試合前設定画面）' },
  { key: 'Esc', role: 'ポーズ（BGM / 効果音の切り替え）' },
  { key: 'K', role: 'このキー一覧を開く / 閉じる' },
  { key: 'T', role: '操作確認モード（自分1人とボールだけの無菌室）' },
  { key: 'R', role: '操作確認モード中: ボールを足元へ戻す / 試合終了後: 再戦' },
  { key: 'P', role: '練習モード（CPUがボールに関与しない）' },
  { key: 'M', role: '一括ミュート（BGM・効果音の両方）' },
];

/** `KeyZ` → `Z`、`ShiftLeft` → `Shift(左)` のように読める表記へ直す。 */
export function formatKeyCode(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'ShiftLeft') return 'Shift(左)';
  if (code === 'ShiftRight') return 'Shift(右)';
  return code;
}

/** 論理ボタン → 割り当てキー の逆引き (BUTTON_KEYS はキー → 論理ボタンの向き)。 */
export function keysForButton(button: LogicalButton): string[] {
  return Object.entries(BUTTON_KEYS)
    .filter(([, logical]) => logical === button)
    .map(([code]) => formatKeyCode(code));
}

/** 表示順 (SFCのボタン配置に合わせる)。 */
const BUTTON_ORDER: readonly LogicalButton[] = [
  LogicalButton.B,
  LogicalButton.Y,
  LogicalButton.A,
  LogicalButton.X,
  LogicalButton.L,
  LogicalButton.R,
  LogicalButton.Start,
];

export class KeymapOverlay {
  private readonly el: HTMLElement;
  private visible = false;

  constructor(el: HTMLElement) {
    this.el = el;
    this.el.classList.add('hidden');
    this.render();
  }

  isVisible(): boolean {
    return this.visible;
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.el.classList.toggle('hidden', !visible);
  }

  private render(): void {
    const buttonRows = BUTTON_ORDER.map((button) => {
      const keys = keysForButton(button);
      // 未割り当てのボタンも「未割り当て」と明示する (黙って消すと実装漏れに気付けない)。
      const keyText = keys.length > 0 ? keys.join(' / ') : '—（未割り当て）';
      return `<tr><td class="k">${keyText}</td><td class="b">${SFC_LABEL[button]}</td><td class="r">${BUTTON_ROLE[button]}</td></tr>`;
    }).join('');

    const utilityRows = UTILITY_KEYS.map(
      (row) => `<tr><td class="k">${row.key}</td><td class="b">—</td><td class="r">${row.role}</td></tr>`,
    ).join('');

    this.el.innerHTML = `
      <h2>キーボード操作一覧</h2>
      <table class="keymap">
        <tr><th>キー</th><th>ボタン</th><th>役割</th></tr>
        ${buttonRows}
        <tr class="sep"><td colspan="3">画面・モード</td></tr>
        ${utilityRows}
      </table>
      <div class="row hint"><span>ボタンの役割はボールの状況（保持 / 相手保持 / ルーズ）で変わります。画面下端のガイドが今の役割を表示します。</span></div>
      <div class="row hint"><span class="btn"><span class="glyph">K</span>閉じる</span></div>
    `;
  }
}
