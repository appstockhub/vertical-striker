import type { AudioSettings } from '../render/audioSettings';

/**
 * 試合中のポーズ画面 (23周目に新設)。
 *
 * CLAUDE.md の操作仕様では SELECT = ポーズだが、**Pause機能はこれまで一度も実装されて
 * いなかった** (`src/input/types.ts` にも「このプロジェクトはPause機能自体を持たない」と
 * 明記されていた)。BGM/効果音を試合中に切り替えたいという要望に応えるため最小構成で作る。
 *
 * キーは Escape。ゲームパッドの SELECT は、論理ボタンの集合 (`LogicalButton`) に Select が
 * 無く、追加すると sim が受け取る InputFrame の形が変わる (= リプレイ互換に影響する) ため、
 * 今回は見送った。追加するなら入力抽象化レイヤーの変更として別途行うこと。
 *
 * MatchSetupOverlay と同じ「Phaserとは独立したDOMコンポーネント」パターン。
 * CSSも #match-setup-overlay と共用する (style.css)。
 */
export class PauseOverlay {
  private readonly el: HTMLElement;
  private visible = false;
  private settings: AudioSettings;
  private onChange: ((settings: AudioSettings) => void) | null = null;

  constructor(el: HTMLElement, settings: AudioSettings) {
    this.el = el;
    this.settings = settings;
    this.el.classList.add('hidden');
    this.render();
  }

  /** BGM/効果音の切り替えが起きたら呼ばれる (呼び出し側が実際のミュートと保存を行う)。 */
  onSettingsChange(handler: (settings: AudioSettings) => void): void {
    this.onChange = handler;
  }

  isVisible(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.el.classList.toggle('hidden', !visible);
    if (visible) this.render();
  }

  /** 外 (試合前設定など) で設定が変わった時に表示を合わせる。 */
  setSettings(settings: AudioSettings): void {
    this.settings = settings;
    if (this.visible) this.render();
  }

  /**
   * ポーズ中のキー入力を処理する。処理したら true を返す
   * (呼び出し側はその場合ゲーム側のキー処理をスキップする)。
   */
  handleKey(key: string): boolean {
    if (!this.visible) return false;
    switch (key) {
      case 'b':
      case 'B':
        this.settings = { ...this.settings, bgm: !this.settings.bgm };
        break;
      case 's':
      case 'S':
        this.settings = { ...this.settings, sfx: !this.settings.sfx };
        break;
      default:
        return false;
    }
    this.onChange?.(this.settings);
    this.render();
    return true;
  }

  private render(): void {
    this.el.innerHTML = `
      <h2>一時停止</h2>
      <div class="row">
        <span class="btn${this.settings.bgm ? ' selected' : ''}"><span class="glyph">B</span>BGM ${this.settings.bgm ? 'ON' : 'OFF'}</span>
        <span class="btn${this.settings.sfx ? ' selected' : ''}"><span class="glyph">S</span>効果音 ${this.settings.sfx ? 'ON' : 'OFF'}</span>
      </div>
      <div class="row hint">
        <span class="btn"><span class="glyph">Esc</span>再開</span>
      </div>
    `;
  }
}
