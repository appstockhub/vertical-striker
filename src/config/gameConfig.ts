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
/**
 * `?forcestep` クエリ付きで開くと、Phaser のループを requestAnimationFrame ではなく
 * setTimeout 駆動にする (Phaser公式の fps.forceSetTimeOut)。
 *
 * 用途: 自動E2E検証。開発環境のBrowser paneは非表示状態だと rAF が発火せず
 * Phaser が一切動かない (create()すら走らない) という制約が Phase 0 から続いており、
 * そのせいで「実際にゲームを起動して操作に反応するか」を誰も確認できないまま
 * simのテストだけが緑、という検証の穴が生まれていた (13周目の実プレイ全滅の遠因)。
 * setTimeout 駆動なら非表示でもゲームが完全に動くため、本物のKeyboardEventを流し込んで
 * 入力→ループ→simの全経路をエンドツーエンドで検証できる。
 * 通常プレイ (クエリ無し) には一切影響しない。
 */
const forceSetTimeOut = typeof location !== 'undefined' && location.search.includes('forcestep');

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.CANVAS,
  parent: 'game-root',
  width: VIEWPORT_WIDTH,
  height: VIEWPORT_HEIGHT,
  backgroundColor: '#10141a',
  ...(forceSetTimeOut ? { fps: { forceSetTimeOut: true } } : {}),
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
  },
  scene: [BootScene, PitchScene],
};
