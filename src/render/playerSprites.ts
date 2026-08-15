import Phaser from 'phaser';
import { TeamId } from '../sim/formations';
import { DIRECTION_VECTORS } from '../sim/constants';
import { Direction8 } from '../input/types';
import { toFloat } from '../core/fixed';
import { TEAM_COLORS, PLAYER_HEAD_COLOR } from './teamColors';

/**
 * 選手スプライトの手続き的生成。★描画専用★
 *
 * 16周目の疑似3D化にあわせて全面的に描き直した。それまでは「真上から見た選手」
 * (肩と頭を上から見下ろした絵) だったが、カメラが地面近くから斜めに見る視点になったため、
 * **立っている人を横〜斜め上から見た姿**でなければ画面と噛み合わない。
 *
 * - 足元が接地点: 描画側で origin=(0.5, 1) を指定し、投影した地面座標にそのまま置く。
 * - 8方向 × 走行アニメ4フレーム × (Team A/B) × (フィールド/GK) = 128テクスチャを
 *   起動時に1回だけ焼く。毎フレームのコストは setTexture()/setScale() のみ (60fps方針)。
 * - 画像アセットは使わない (CLAUDE.md「完全オリジナル素材」)。
 *
 * 向きの表現:
 *   - 手前向き(Down)= 顔が見える正面、奥向き(Up)= 後頭部の背面
 *   - 左右 = 横向き(肩幅が狭くなり、鼻先が進行方向へ出る)
 *   - 斜め4方向 = その中間 (肩幅と顔の要素を連続的に補間する)
 * 走行アニメは4フレームの標準的なランサイクル (ストライド → 通過 → 逆ストライド → 通過)。
 */

const OUTFIELD_CANVAS_W = 30;
const OUTFIELD_CANVAS_H = 46;
const GK_SCALE = 1.1;
const GK_CANVAS_W = Math.round(OUTFIELD_CANVAS_W * GK_SCALE);
const GK_CANVAS_H = Math.round(OUTFIELD_CANVAS_H * GK_SCALE);

const OUTLINE_COLOR = 0x14161a;
const OUTLINE_ALPHA = 0.85;
/** 短パンの色 (両チーム共通、ピッチの緑との対比を優先した中立の濃灰)。 */
const SHORTS_COLOR = 0x24262b;
const SOCK_COLOR = 0xe8e8ea;
const BOOT_COLOR = 0x101216;
const HAIR_COLOR = 0x2b1f18;

/** 走行アニメのフレーム番号 (0..3 のランサイクル)。 */
export type AnimFrame = 0 | 1 | 2 | 3;
export const ANIM_FRAME_COUNT = 4;

/** フレームごとの脚のストライド量 (-1..1) と、胴体の上下動 (px相当)。 */
const STRIDE_PHASE: readonly number[] = [1, 0, -1, 0];
const BOB_PHASE: readonly number[] = [0, -1.2, 0, -1.2];

const BAKED_DIRECTIONS: readonly Direction8[] = [
  Direction8.Down,
  Direction8.Up,
  Direction8.Left,
  Direction8.Right,
  Direction8.DownRight,
  Direction8.DownLeft,
  Direction8.UpRight,
  Direction8.UpLeft,
];

/** Direction8.None (初期値のみ) はテクスチャを焼かないため、描画時は Down 扱いにする。 */
export function resolveSpriteDirection(facing: Direction8): Direction8 {
  return facing === Direction8.None ? Direction8.Down : facing;
}

function darken(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8) & 0xff) * factor);
  const b = Math.round((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

export function playerSpriteKey(
  team: TeamId,
  isGoalkeeper: boolean,
  facing: Direction8,
  frame: AnimFrame,
): string {
  const dir = resolveSpriteDirection(facing);
  return `player-${team}-${isGoalkeeper ? 'gk' : 'out'}-${dir}-${frame}`;
}

/**
 * 立ち姿1体を Graphics に描く。足元がキャンバス下端に来るように配置する
 * (呼び出し側は origin=(0.5,1) で接地点に合わせる)。
 */
function drawPlayerSprite(
  g: Phaser.GameObjects.Graphics,
  w: number,
  h: number,
  jerseyColor: number,
  dirVec: { x: number; y: number },
  frame: AnimFrame,
): void {
  const s = h / OUTFIELD_CANVAS_H; // 46px高さを基準にした寸法スケール
  const cx = w / 2;
  const groundY = h - 1;

  // 向きの分解: dx = 横向き成分 (-1..1)、dy = 手前(+)/奥(-) 成分。
  const len = Math.hypot(dirVec.x, dirVec.y) || 1;
  const dx = dirVec.x / len;
  const dy = dirVec.y / len;
  const side = Math.abs(dx); // 1 = 完全な横向き
  const front = dy; // +1 = 手前向き(顔が見える) / -1 = 奥向き(背中)

  const stride = STRIDE_PHASE[frame] ?? 0;
  const bob = (BOB_PHASE[frame] ?? 0) * s;

  // --- 骨格の基準点 ---
  const hipY = groundY - 16 * s + bob;
  const shoulderY = hipY - 13 * s;
  const headR = 5 * s;
  const headY = shoulderY - 6 * s - headR * 0.4;

  // --- 脚 (先に描いて胴体の下に敷く) ---
  // 走行方向へ振り出す。奥行き方向(dy)は見た目上つぶれるので半分に圧縮する。
  const strideLen = 5.5 * s;
  const swingX = dx * stride * strideLen;
  const swingY = dy * stride * strideLen * 0.45;
  const legSpread = (2.6 + 1.6 * (1 - side)) * s; // 正面ほど左右に開いて見える
  const legW = 4.2 * s;

  const drawLeg = (baseX: number, footX: number, footY: number): void => {
    // 太もも〜すね (短パンの下から靴下)
    g.lineStyle(legW, PLAYER_HEAD_COLOR, 1);
    g.lineBetween(baseX, hipY, footX, footY - 3.5 * s);
    // 靴下
    g.lineStyle(legW, SOCK_COLOR, 1);
    g.lineBetween(footX, footY - 4.5 * s, footX, footY - 1.5 * s);
    // スパイク
    g.fillStyle(BOOT_COLOR, 1);
    g.fillRoundedRect(footX - 2.6 * s + (dx > 0 ? 0.8 * s : -0.8 * s), footY - 2 * s, 5.2 * s, 2.6 * s, 1 * s);
  };

  drawLeg(cx - legSpread, cx - legSpread + swingX, groundY + swingY);
  drawLeg(cx + legSpread, cx + legSpread - swingX, groundY - swingY);

  // --- 腕 (脚と逆位相で振る) ---
  const shoulderW = (5.5 + 4.5 * (1 - side)) * s;
  const armW = 3.4 * s;
  const armLen = 10 * s;
  const armSwing = -stride * 3.2 * s;
  g.lineStyle(armW, PLAYER_HEAD_COLOR, 1);
  g.lineBetween(cx - shoulderW, shoulderY + 1 * s, cx - shoulderW - 1.2 * s + armSwing, shoulderY + armLen);
  g.lineBetween(cx + shoulderW, shoulderY + 1 * s, cx + shoulderW + 1.2 * s - armSwing, shoulderY + armLen);

  // --- 短パン ---
  const shortsW = shoulderW * 1.85;
  const shortsH = 6.5 * s;
  g.fillStyle(SHORTS_COLOR, 1);
  g.lineStyle(1 * s, OUTLINE_COLOR, OUTLINE_ALPHA);
  g.fillRoundedRect(cx - shortsW / 2, hipY - shortsH * 0.75, shortsW, shortsH, 1.5 * s);
  g.strokeRoundedRect(cx - shortsW / 2, hipY - shortsH * 0.75, shortsW, shortsH, 1.5 * s);

  // --- 胴体 (ジャージ、袖まで含めた台形) ---
  const torsoTop = shoulderY - 1.5 * s;
  const torsoBottom = hipY - shortsH * 0.55;
  const topHalf = shoulderW * 1.18;
  const bottomHalf = shoulderW * 0.95;
  g.fillStyle(jerseyColor, 1);
  g.lineStyle(1 * s, OUTLINE_COLOR, OUTLINE_ALPHA);
  const torso = [
    { x: cx - topHalf, y: torsoTop },
    { x: cx + topHalf, y: torsoTop },
    { x: cx + bottomHalf, y: torsoBottom },
    { x: cx - bottomHalf, y: torsoBottom },
  ];
  g.fillPoints(torso, true);
  g.strokePoints(torso, true);
  // 裾の陰影 (立体感の最小限の手がかり)
  g.fillStyle(darken(jerseyColor, 0.72), 1);
  g.fillRect(cx - bottomHalf, torsoBottom - 1.8 * s, bottomHalf * 2, 1.8 * s);
  // 背面向きのときは背中側にも縦の陰影を入れて「後ろ姿」だと分かるようにする
  if (front < -0.3) {
    g.fillStyle(darken(jerseyColor, 0.85), 1);
    g.fillRect(cx - 1 * s, torsoTop, 2 * s, torsoBottom - torsoTop);
  }

  // --- 頭 ---
  const headX = cx + dx * 1.6 * s;
  g.fillStyle(PLAYER_HEAD_COLOR, 1);
  g.lineStyle(1 * s, OUTLINE_COLOR, 0.75);
  g.fillCircle(headX, headY, headR);
  g.strokeCircle(headX, headY, headR);

  // 髪: 奥向きほど頭全体を覆い、手前向きは上半分だけ。横向きは後頭部側に寄せる。
  g.fillStyle(HAIR_COLOR, 1);
  if (front < -0.3) {
    g.fillCircle(headX, headY, headR * 0.94);
  } else {
    // 上半分の髪
    g.beginPath();
    g.arc(headX, headY, headR, Math.PI, Math.PI * 2, false);
    g.fillPath();
    // 横向きは進行方向と逆側 (後頭部) に厚みを足す
    if (side > 0.5) {
      g.fillCircle(headX - dx * headR * 0.55, headY + headR * 0.1, headR * 0.62);
    }
  }

  // 顔 (手前向き成分がある時だけ目を描く)。横向きは片目 + 鼻先。
  if (front > -0.2) {
    const eyeY = headY + headR * 0.12;
    const eyeR = Math.max(0.6, 0.9 * s);
    g.fillStyle(OUTLINE_COLOR, 0.9);
    if (side > 0.5) {
      g.fillCircle(headX + dx * headR * 0.35, eyeY, eyeR);
      // 鼻先
      g.fillStyle(PLAYER_HEAD_COLOR, 1);
      g.fillCircle(headX + dx * headR * 0.95, eyeY + headR * 0.15, eyeR * 1.1);
    } else {
      g.fillCircle(headX - headR * 0.38, eyeY, eyeR);
      g.fillCircle(headX + headR * 0.38, eyeY, eyeR);
    }
  }
}

/**
 * 128テクスチャを1回だけ焼き込む。Scene再生成時の重複生成防止に、既存のボールテクスチャと
 * 同じ「代表キーの存在チェック」ガードを使う。
 */
export function buildPlayerSpriteTextures(scene: Phaser.Scene): void {
  const guardKey = playerSpriteKey(TeamId.A, false, Direction8.Down, 0);
  if (scene.textures.exists(guardKey)) return;

  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const teams: TeamId[] = [TeamId.A, TeamId.B];
  const frames: AnimFrame[] = [0, 1, 2, 3];

  for (const team of teams) {
    for (const isGoalkeeper of [false, true]) {
      const palette = TEAM_COLORS[team];
      const jersey = isGoalkeeper ? palette.goalkeeper : palette.outfield;
      const w = isGoalkeeper ? GK_CANVAS_W : OUTFIELD_CANVAS_W;
      const h = isGoalkeeper ? GK_CANVAS_H : OUTFIELD_CANVAS_H;
      for (const dir of BAKED_DIRECTIONS) {
        const vec = DIRECTION_VECTORS[dir];
        const dirVec = { x: toFloat(vec.x), y: toFloat(vec.y) };
        for (const frame of frames) {
          g.clear();
          drawPlayerSprite(g, w, h, jersey, dirVec, frame);
          g.generateTexture(playerSpriteKey(team, isGoalkeeper, dir, frame), w, h);
        }
      }
    }
  }
  g.destroy();
}

/** スプライトの基準サイズ (奥行きスケール1.0のときの表示高さ)。描画側の位置合わせに使う。 */
export const SPRITE_BASE_HEIGHT = OUTFIELD_CANVAS_H;
