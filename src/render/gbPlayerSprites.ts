import Phaser from 'phaser';
import { TeamId } from '../sim/formations';
import { Direction8 } from '../input/types';
import { TEAM_COLORS } from './teamColors';
import { AnimFrame, ANIM_FRAME_COUNT } from './playerSprites';

/**
 * 【試作・本採用未定】CC0の外部スプライト素材を選手として描く経路。★描画専用★
 *
 * 素材: 8-Directional Game Boy Character Template / GibbonGL (CC0 1.0)
 *       public/assets/thirdparty/gb-8dir-character-cc0.png (配布zipの `loose sprites.png` 無改変)
 *       出典とライセンスは docs/asset-credits.md に記録済み。
 *
 * 目的は「外部素材が現行の描画パイプラインに乗るか」を実際に画で確かめること
 * (V-2、22周目のユーザー指示)。既定は OFF で、`?sprites=gb` を付けた時だけ有効になる。
 * 既存の手続き生成 (playerSprites.ts) は一切変更していないので、同じ試合・同じフレームで
 * 両方をキャプチャして並べられる。
 *
 * 素材側の制約 (試作で分かったことの記録):
 * - 16x16 の 4色固定パレット。**ユニフォームと肌が同じ色**なので、パレット差し替えでは
 *   「シャツだけチーム色」にはできない。ここでは中間色をチーム色へ置換しており、
 *   結果として選手が全身チーム色の単色シルエットになる (= 素材そのものの限界)。
 * - 真上寄りの見下ろし (頭が大きいRPG体型) で、当プロジェクトの俯角16.7°とは前提が違う。
 */

/** 配布物のパレット (4色固定)。実測して確定した値。 */
const GB_BG = { r: 48, g: 104, b: 80 };
const GB_MID = { r: 134, g: 192, b: 108 };
const GB_LIGHT = { r: 224, g: 248, b: 207 };
const GB_DARK = { r: 7, g: 24, b: 33 };

const SHEET_W = 128;
const SHEET_H = 128;
const CELL = 16;
/**
 * 焼き込み時の整数倍拡大。現行スプライト(46px高)と見かけの背丈を揃えるため 3倍(48px)にする。
 * 描画時ではなく焼き込み時に最近傍で拡大するので、Phaser側の平滑化に影響されずドットが保たれる。
 */
const UPSCALE = 3;
const OUT = CELL * UPSCALE;

export const GB_SHEET_KEY = 'gb-8dir-character';
export const GB_SPRITE_BASE_HEIGHT = OUT;

/**
 * シート上の行 → 向き。素材に説明が無いので実測で確定した:
 * - 行0 と 行4 は左右対称、行1..3 と 行7..5 が互いの完全な鏡像 (全ピクセル一致) →
 *   8方向の一巡であることが確定。明色(目)の画素数が 行0=32 → 行4=6 と単調に減るので
 *   行0=手前(顔が正面)、行4=奥(後頭部)。
 * - 左右の向きは「明色(目)の重心 − シルエットの重心」で判定した。行1/2/3 は -0.25/-0.53/-1.70
 *   と顔が**左**へ寄り、行5/6/7 は +1.70/+0.53/+0.25 と右へ寄る。見た目で判断すると
 *   逆に取り違えるので、この数値を根拠とする。
 */
const ROW_DIRECTIONS: readonly Direction8[] = [
  Direction8.Down,
  Direction8.DownLeft,
  Direction8.Left,
  Direction8.UpLeft,
  Direction8.Up,
  Direction8.UpRight,
  Direction8.Right,
  Direction8.DownRight,
];

/** `?sprites=gb` が付いている時だけ試作経路を使う (既定は現行のベクター生成)。 */
export function isGbSpriteModeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('sprites') === 'gb';
}

export function gbPlayerSpriteKey(
  team: TeamId,
  isGoalkeeper: boolean,
  facing: Direction8,
  frame: AnimFrame,
): string {
  const dir = facing === Direction8.None ? Direction8.Down : facing;
  return `gbplayer-${team}-${isGoalkeeper ? 'gk' : 'out'}-${dir}-${frame}`;
}

export function preloadGbPlayerSprites(scene: Phaser.Scene): void {
  // vite.config.ts の base は './' なので、ページURLからの相対で解決させる
  // (GitHub Pages のサブパス配信でも /<repo>/assets/... に正しく解決される)。
  scene.load.image(GB_SHEET_KEY, 'assets/thirdparty/gb-8dir-character-cc0.png');
}

function splitColor(color: number): { r: number; g: number; b: number } {
  return { r: (color >> 16) & 0xff, g: (color >> 8) & 0xff, b: color & 0xff };
}

function mix(c: { r: number; g: number; b: number }, to: number, t: number): { r: number; g: number; b: number } {
  return {
    r: Math.round(c.r + (to - c.r) * t),
    g: Math.round(c.g + (to - c.g) * t),
    b: Math.round(c.b + (to - c.b) * t),
  };
}

function sameColor(
  data: Uint8ClampedArray,
  offset: number,
  c: { r: number; g: number; b: number },
): boolean {
  return data[offset] === c.r && data[offset + 1] === c.g && data[offset + 2] === c.b;
}

/**
 * 4色 → チーム配色への写像。素材にシャツ/肌の区別が無いため、
 * 「中間色 = 体」をチーム色そのものに、「明色 = ハイライト」をその明るい版に置く。
 */
function paletteFor(jersey: number): {
  mid: { r: number; g: number; b: number };
  light: { r: number; g: number; b: number };
  dark: { r: number; g: number; b: number };
} {
  const base = splitColor(jersey);
  return {
    mid: base,
    light: mix(base, 255, 0.55),
    dark: mix(base, 0, 0.78),
  };
}

/**
 * 8方向 × 4フレーム × 2チーム × (フィールド/GK) = 64テクスチャを起動時に1回だけ焼く。
 * 焼き込み内容: 背景色の抜き + パレット差し替え + 整数倍の最近傍拡大。
 */
export function buildGbPlayerSpriteTextures(scene: Phaser.Scene): void {
  const guardKey = gbPlayerSpriteKey(TeamId.A, false, Direction8.Down, 0);
  if (scene.textures.exists(guardKey)) return;
  if (!scene.textures.exists(GB_SHEET_KEY)) return;

  // 元シートの生ピクセルを1回だけ読み出す (Phaserのテクスチャからは直接読めないので
  // 一時canvasへ描いて getImageData する)。
  const source = scene.textures.get(GB_SHEET_KEY).getSourceImage() as CanvasImageSource;
  const scratch = document.createElement('canvas');
  scratch.width = SHEET_W;
  scratch.height = SHEET_H;
  const sctx = scratch.getContext('2d');
  if (!sctx) return;
  sctx.drawImage(source, 0, 0);
  const sheet = sctx.getImageData(0, 0, SHEET_W, SHEET_H).data;

  for (const team of [TeamId.A, TeamId.B]) {
    for (const isGoalkeeper of [false, true]) {
      const colors = TEAM_COLORS[team];
      const palette = paletteFor(isGoalkeeper ? colors.goalkeeper : colors.outfield);

      for (let row = 0; row < ROW_DIRECTIONS.length; row++) {
        const dir = ROW_DIRECTIONS[row] as Direction8;
        for (let frame = 0; frame < ANIM_FRAME_COUNT; frame++) {
          const key = gbPlayerSpriteKey(team, isGoalkeeper, dir, frame as AnimFrame);
          const tex = scene.textures.createCanvas(key, OUT, OUT);
          if (!tex) continue;
          const ctx = tex.getContext();
          const out = ctx.createImageData(OUT, OUT);

          for (let y = 0; y < OUT; y++) {
            const sy = row * CELL + Math.floor(y / UPSCALE);
            for (let x = 0; x < OUT; x++) {
              const sx = frame * CELL + Math.floor(x / UPSCALE);
              const si = (sy * SHEET_W + sx) * 4;
              const di = (y * OUT + x) * 4;
              // 背景色は完全に抜く (素材はアルファを持たず、背景も palette の1色なので
              // 色キーで抜く必要がある。実測で「背景色はキャラ内部に一切出現しない」ことを
              // 確認済みなので、この方式で穴は開かない)。
              if (sameColor(sheet, si, GB_BG)) continue;
              const c = sameColor(sheet, si, GB_MID)
                ? palette.mid
                : sameColor(sheet, si, GB_LIGHT)
                  ? palette.light
                  : sameColor(sheet, si, GB_DARK)
                    ? palette.dark
                    : { r: sheet[si] ?? 0, g: sheet[si + 1] ?? 0, b: sheet[si + 2] ?? 0 };
              out.data[di] = c.r;
              out.data[di + 1] = c.g;
              out.data[di + 2] = c.b;
              out.data[di + 3] = 255;
            }
          }

          ctx.putImageData(out, 0, 0);
          tex.refresh();
        }
      }
    }
  }
}
