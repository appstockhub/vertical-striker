import Phaser from 'phaser';

/**
 * Phase 0 ではアセットが無いため即座に PitchScene を開始する。
 * Phase 1 以降でスプライトシート等のプリロードが必要になった際にここへ追加する。
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.scene.start('Pitch');
  }
}
