import Phaser from 'phaser';
import { VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from './pitch';
import { BootScene } from '../render/BootScene';
import { PitchScene } from '../render/PitchScene';

/**
 * Phaser.Types.Core.GameConfig。
 * - type: Phaser.CANVAS を明示 (AUTO にして WebGL へフォールバックさせない。
 *   CLAUDE.md の「Canvas 2D」指定を文字通り守る)
 * - physics キーは含めない (Arcade/Matter 等の Phaser 物理プラグインは一切使わない。
 *   物理は sim/ で自前実装する)
 */
export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.CANVAS,
  parent: 'game-root',
  width: VIEWPORT_WIDTH,
  height: VIEWPORT_HEIGHT,
  backgroundColor: '#10141a',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
  },
  scene: [BootScene, PitchScene],
};
