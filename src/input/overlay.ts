/**
 * ゲームパッド接続時に表示するボタン配置オーバーレイ。
 * Phaser とは独立した DOM コンポーネント (#gamepad-overlay に描画する)。
 */

const AUTO_HIDE_MS = 4000;

export class GamepadOverlay {
  private readonly el: HTMLElement;
  private hideTimer: number | null = null;
  private everConnected = false;

  constructor(el: HTMLElement) {
    this.el = el;
    this.el.innerHTML = `
      <h2>ゲームパッド接続</h2>
      <div class="row">
        <span class="btn"><span class="glyph">X</span>上</span>
      </div>
      <div class="row">
        <span class="btn"><span class="glyph">Y</span>左</span>
        <span class="btn"><span class="glyph">A</span>右</span>
      </div>
      <div class="row">
        <span class="btn"><span class="glyph">B</span>下</span>
      </div>
      <div class="row">
        <span class="btn"><span class="glyph">L</span>照準/キーパー選択</span>
        <span class="btn"><span class="glyph">R</span>照準</span>
      </div>
    `;

    window.addEventListener('gamepadconnected', this.onConnected);
    window.addEventListener('gamepaddisconnected', this.onDisconnected);
  }

  /** gamepadconnected イベントを取りこぼすブラウザ (Firefox 等) 向けに毎フレーム呼ぶ。 */
  pollConnectionState(anyPadConnected: boolean): void {
    if (anyPadConnected && !this.everConnected) {
      this.onConnected();
    }
  }

  private onConnected = (): void => {
    if (this.everConnected) return;
    this.everConnected = true;
    this.show();
    this.scheduleAutoHide();
  };

  private onDisconnected = (): void => {
    this.everConnected = false;
  };

  /** 何かボタンが押されたら即座に隠す。 */
  notifyButtonPressed(): void {
    this.hide();
  }

  private show(): void {
    this.el.classList.remove('hidden');
  }

  private hide(): void {
    this.el.classList.add('hidden');
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private scheduleAutoHide(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
    }
    this.hideTimer = window.setTimeout(() => this.hide(), AUTO_HIDE_MS);
  }

  dispose(): void {
    window.removeEventListener('gamepadconnected', this.onConnected);
    window.removeEventListener('gamepaddisconnected', this.onDisconnected);
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
    }
  }
}
