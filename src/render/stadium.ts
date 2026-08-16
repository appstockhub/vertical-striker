import Phaser from 'phaser';
import { lerpColor } from './colorUtils';

/**
 * 地平線の上に広がるスタジアム (空 → 屋根 → 観客席 → 広告板) の描画。★描画専用・静的★
 *
 * 疑似3D化で画面上部18%が「地面ではない領域」として空くため、ここを埋めないと
 * 空白の帯になってしまう。原作もこの帯にスタンドを描いており、これがあるだけで
 * 「スタジアムの中にいる」感が出る = 完成度の体感が大きく変わる。
 *
 * カメラは横スクロールしないので、この帯は完全に静的でよい (1回だけ描いて以後触らない、
 * 60fps 方針のガードレール)。観客のドットも固定配置にする — 疑似乱数すら使わない
 * 決め打ちの格子＋位相ずらしで、十分「群衆」に見える。
 */

const SKY_TOP = 0x0d1622;
const SKY_BOTTOM = 0x1d2c3f;
const ROOF_COLOR = 0x0a0f16;
/**
 * ★V-4 (ビジュアル手法転換・案C)★ スタンド段差の基調色。原作PNGを実測すると
 * 観客席は `#c9dbdb`/`#c5d5d4`(明るい水色がかったグレー)主体で、旧実装の暗い青灰
 * (0x232b36系、実測サンプルの100%が単色の黒 `#0d1622` に潰れていた) とは真逆だった
 * (docs/visual-overhaul-proposal.md 1-3)。段差そのものを明るくし、群衆ドットが暗い
 * 背景に沈まないようにする。
 */
const STAND_BASE_A = 0xc9dbdb;
const STAND_BASE_B = 0xbfd2d1;
/**
 * 観客のドットに使う色。原作実測で確認できた `#ffffff`/明るいグレーに加え、
 * `#c14931` 相当の赤アクセントを含める (単色黒だった旧パレットからの入れ替え)。
 */
const CROWD_COLORS = [0xffffff, 0xd8d2c4, 0xc9a35b, 0x8fa7c4, 0xc14931, 0xe0dfe4];
/** 赤アクセントのサポーターズブロック (原作実測 `#c14931`)。1区画だけ塗りつぶす。 */
const CROWD_ACCENT_RED = 0xc14931;
/** 広告板: 白地に色ブロック (原作は「白系の帯」。実在企業名は使わず抽象ブロックにする)。 */
const BOARD_BASE = 0xf2f2ee;
const BOARD_BLOCKS = [0x1f6fb2, 0xd23b3b, 0xe8b71d, 0x1f8a4c];

/**
 * @param horizonY スタンドの下端 (= ピッチの地平線)。
 */
export function drawStadium(g: Phaser.GameObjects.Graphics, width: number, horizonY: number): void {
  // 空 (上ほど暗いグラデーションを横帯の重ね塗りで近似する)
  const skySteps = 10;
  for (let i = 0; i < skySteps; i++) {
    const t = i / (skySteps - 1);
    g.fillStyle(lerpColor(SKY_TOP, SKY_BOTTOM, t), 1);
    g.fillRect(0, (horizonY * 0.42 * i) / skySteps, width, horizonY * 0.42 / skySteps + 1);
  }

  const roofY = horizonY * 0.42;
  const standTop = horizonY * 0.5;
  const boardTop = horizonY - 8;

  // 屋根 (スタンド上端の庇)
  g.fillStyle(ROOF_COLOR, 1);
  g.fillRect(0, roofY, width, standTop - roofY);

  // スタンド本体 (段差を横帯で表現)。★V-4★ 暗い青灰→明るい群衆色系へ。
  const rows = 7;
  const rowHeight = (boardTop - standTop) / rows;
  for (let r = 0; r < rows; r++) {
    g.fillStyle(r % 2 === 0 ? STAND_BASE_A : STAND_BASE_B, 1);
    g.fillRect(0, standTop + r * rowHeight, width, rowHeight + 0.5);
  }

  // 赤アクセントのサポーターズブロック (原作実測 `#c14931`)。1区画を通しで塗り、
  // 「明るい群衆にドットだけでなく色面としての赤アクセントもある」原作の情報量に寄せる。
  const accentLeft = width * 0.66;
  const accentRight = width * 0.84;
  g.fillStyle(CROWD_ACCENT_RED, 0.55);
  g.fillRect(accentLeft, standTop, accentRight - accentLeft, boardTop - standTop);

  // 観客 (固定配置のドット。行ごとに位相をずらして規則性を消す)。★V-4★ 密度を上げ、
  // 明るい基調色の上でも「群衆」の粒立ちがはっきり見えるようにする。
  const dot = Math.max(1.4, rowHeight * 0.26);
  for (let r = 0; r < rows; r++) {
    const y = standTop + r * rowHeight + rowHeight * 0.45;
    const spacing = dot * 1.8;
    const phase = (r * spacing) / 3;
    for (let x = phase % spacing; x < width; x += spacing) {
      // 位置から決まる固定パターンで色を選ぶ (乱数を使わない = 毎回同じ絵)。
      const idx = (Math.round(x / spacing) * 7 + r * 3) % CROWD_COLORS.length;
      g.fillStyle(CROWD_COLORS[idx]!, 0.9);
      g.fillRect(x, y, dot, dot);
    }
  }

  // 広告板 (スタンドとピッチの境界)。★V-4★ 暗い帯→白地に色ブロックへ (原作実測「白系の帯」)。
  // 実在企業の名称・ロゴは使わず、抽象色ブロックの並びだけで情報量を出す。
  g.fillStyle(BOARD_BASE, 1);
  g.fillRect(0, boardTop, width, horizonY - boardTop);
  const blockWidth = 40;
  const blockGap = 8;
  const blockStep = blockWidth + blockGap;
  for (let x = 0, i = 0; x < width; x += blockStep, i++) {
    g.fillStyle(BOARD_BLOCKS[i % BOARD_BLOCKS.length]!, 1);
    g.fillRect(x + blockGap / 2, boardTop + 2, blockWidth, Math.max(1, horizonY - boardTop - 4));
  }
}
