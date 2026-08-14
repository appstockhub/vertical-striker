import type { Difficulty } from '../sim/state';

/**
 * 試合前設定UI (Phase 3 マイルストーン0、最小限)。DOM要素 (#match-setup-overlay) に描画する、
 * GamepadOverlay (src/input/overlay.ts) と同じ「Phaserとは独立したDOMコンポーネント」パターン。
 *
 * 難易度(1/2/3キー)とオフサイドON/OFF(Oキー)を選び、Enter/Spaceで開始を確定する。
 * 確定後は自身を隠し、onStartコールバックを一度だけ呼ぶ (呼び出し側=PitchSceneが
 * createInitialStateへ設定を渡してGameStateを作り直す)。
 */
export interface MatchSetupResult {
  readonly difficulty: Difficulty;
  readonly offsideEnabled: boolean;
}

const DIFFICULTY_LABELS: Readonly<Record<Difficulty, string>> = {
  easy: 'イージー',
  medium: 'ミディアム',
  hard: 'ハード',
};
const DIFFICULTY_ORDER: readonly Difficulty[] = ['easy', 'medium', 'hard'];

export class MatchSetupOverlay {
  private readonly el: HTMLElement;
  private difficulty: Difficulty = 'medium';
  private offsideEnabled = true;
  private started = false;
  private onStart: ((result: MatchSetupResult) => void) | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
    this.render();
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** 開始確定時に一度だけ呼ばれる。呼び出し側はここでGameStateを作り直す。 */
  waitForStart(onStart: (result: MatchSetupResult) => void): void {
    this.onStart = onStart;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.started) return;

    switch (event.key) {
      case '1':
        this.difficulty = 'easy';
        break;
      case '2':
        this.difficulty = 'medium';
        break;
      case '3':
        this.difficulty = 'hard';
        break;
      case 'o':
      case 'O':
        this.offsideEnabled = !this.offsideEnabled;
        break;
      case 'Enter':
      case ' ':
        this.confirm();
        return;
      default:
        return;
    }
    this.render();
  };

  private confirm(): void {
    if (this.started) return;
    this.started = true;
    this.el.classList.add('hidden');
    this.onStart?.({ difficulty: this.difficulty, offsideEnabled: this.offsideEnabled });
  }

  private render(): void {
    const diffRow = DIFFICULTY_ORDER.map((d, i) => {
      const selected = d === this.difficulty;
      return `<span class="btn${selected ? ' selected' : ''}"><span class="glyph">${i + 1}</span>${DIFFICULTY_LABELS[d]}</span>`;
    }).join('');

    this.el.innerHTML = `
      <h2>試合前設定</h2>
      <div class="row">${diffRow}</div>
      <div class="row">
        <span class="btn${this.offsideEnabled ? ' selected' : ''}"><span class="glyph">O</span>オフサイド ${this.offsideEnabled ? 'ON' : 'OFF'}</span>
      </div>
      <div class="row hint">
        <span class="btn"><span class="glyph">⏎</span>開始</span>
      </div>
    `;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
  }
}
