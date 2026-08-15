import Phaser from 'phaser';

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
const STAND_DARK = 0x232b36;
const STAND_LIGHT = 0x2c3542;
/** 観客のドットに使う色 (色数を絞ると「群衆」としてまとまって見える)。 */
const CROWD_COLORS = [0xd8d2c4, 0xc9a35b, 0x8fa7c4, 0xa8563f, 0x6f7f8c, 0xe0dfe4];
/** 広告板 (ピッチとスタンドの境界を締める帯)。 */
const BOARD_COLOR = 0x101820;
const BOARD_STRIPE = 0x2a3a4a;

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

  // スタンド本体 (段差を横帯で表現)
  const rows = 7;
  const rowHeight = (boardTop - standTop) / rows;
  for (let r = 0; r < rows; r++) {
    g.fillStyle(r % 2 === 0 ? STAND_DARK : STAND_LIGHT, 1);
    g.fillRect(0, standTop + r * rowHeight, width, rowHeight + 0.5);
  }

  // 観客 (固定配置のドット。行ごとに位相をずらして規則性を消す)
  const dot = Math.max(1.4, rowHeight * 0.26);
  for (let r = 0; r < rows; r++) {
    const y = standTop + r * rowHeight + rowHeight * 0.45;
    const spacing = dot * 2.6;
    const phase = (r * spacing) / 3;
    for (let x = phase % spacing; x < width; x += spacing) {
      // 位置から決まる固定パターンで色を選ぶ (乱数を使わない = 毎回同じ絵)。
      const idx = (Math.round(x / spacing) * 7 + r * 3) % CROWD_COLORS.length;
      g.fillStyle(CROWD_COLORS[idx]!, 0.9);
      g.fillRect(x, y, dot, dot);
    }
  }

  // 広告板 (スタンドとピッチの境界)
  g.fillStyle(BOARD_COLOR, 1);
  g.fillRect(0, boardTop, width, horizonY - boardTop);
  g.fillStyle(BOARD_STRIPE, 1);
  for (let x = 0; x < width; x += 48) {
    g.fillRect(x + 6, boardTop + 2, 30, Math.max(1, horizonY - boardTop - 4));
  }
}

/** 2色を t (0..1) で線形補間する (グラデーション近似用)。 */
function lerpColor(from: number, to: number, t: number): number {
  const fr = (from >> 16) & 0xff;
  const fg = (from >> 8) & 0xff;
  const fb = from & 0xff;
  const tr = (to >> 16) & 0xff;
  const tg = (to >> 8) & 0xff;
  const tb = to & 0xff;
  const r = Math.round(fr + (tr - fr) * t);
  const gg = Math.round(fg + (tg - fg) * t);
  const b = Math.round(fb + (tb - fb) * t);
  return (r << 16) | (gg << 8) | b;
}
