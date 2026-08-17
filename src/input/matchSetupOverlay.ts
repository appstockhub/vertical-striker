import type { Difficulty } from '../sim/state';
import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from '../render/audioSettings';

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
  private audio: AudioSettings = DEFAULT_AUDIO_SETTINGS;
  private started = false;
  private onStart: ((result: MatchSetupResult) => void) | null = null;
  private onAudioChange: ((settings: AudioSettings) => void) | null = null;

  constructor(el: HTMLElement, audio: AudioSettings = DEFAULT_AUDIO_SETTINGS) {
    this.el = el;
    this.audio = audio;
    this.render();
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** 開始確定時に一度だけ呼ばれる。呼び出し側はここでGameStateを作り直す。 */
  waitForStart(onStart: (result: MatchSetupResult) => void): void {
    this.onStart = onStart;
  }

  /** BGM/効果音の切り替え時に呼ばれる (試合開始前でも即座に反映させるため)。 */
  onAudioSettingsChange(handler: (settings: AudioSettings) => void): void {
    this.onAudioChange = handler;
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
      case 'b':
      case 'B':
        this.audio = { ...this.audio, bgm: !this.audio.bgm };
        this.onAudioChange?.(this.audio);
        break;
      case 's':
      case 'S':
        this.audio = { ...this.audio, sfx: !this.audio.sfx };
        this.onAudioChange?.(this.audio);
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
      <div class="row">
        <span class="btn${this.audio.bgm ? ' selected' : ''}"><span class="glyph">B</span>BGM ${this.audio.bgm ? 'ON' : 'OFF'}</span>
        <span class="btn${this.audio.sfx ? ' selected' : ''}"><span class="glyph">S</span>効果音 ${this.audio.sfx ? 'ON' : 'OFF'}</span>
      </div>
      <div class="row hint">
        <span class="btn"><span class="glyph">⏎</span>開始</span>
      </div>
      <div class="row hint">
        <span>試合中は Esc でポーズ (音の設定はそこでも変えられます)</span>
      </div>
    `;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
  }
}
