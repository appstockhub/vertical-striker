import Phaser from 'phaser';
import { TeamId } from '../sim/formations';
import { DIRECTION_VECTORS } from '../sim/constants';
import { Direction8 } from '../input/types';
import { toFloat } from '../core/fixed';
import { TEAM_COLORS, PLAYER_HEAD_COLOR } from './teamColors';

/**
 * 選手の見た目を「単なる円+頭の小円」から、頭・肩・胴体・脚が識別できるドット絵風の
 * 人型スプライトへ置き換える (ユーザー要望: 「図形の組み合わせでは限界がある」への対応)。
 *
 * 画像アセットは一切使わない。ボールのテクスチャ (PitchScene.ts の buildBallTexture、
 * Graphics→generateTexture) と同じプロシージャル生成パターンを踏襲する
 * (CLAUDE.md「完全オリジナル素材」方針。CC0素材等の外部流用はこの方針に抵触するため採らない)。
 *
 * 8方向 × 2フレーム(歩行アニメ: 脚を閉じた基本姿勢/開いたストライド姿勢) ×
 * (Team A/B) × (フィールドプレイヤー/GK) = 64テクスチャを起動時に1回だけ焼き込む。
 * 毎フレームの描画コストは setTexture() のみ (Graphics再生成なし、既存の
 * 「プール化オブジェクトを1回だけ生成しrender()ではsetPosition等のみ」方針を維持し60fpsを守る)。
 *
 * 向きの表現: 既存の「頭を胴体前面へオフセットする」コンセプトを継承しつつ、
 * 脚のストライド軸も向きベクトルに沿って開くようにした (歩いている方向へ脚が開く)。
 */

const OUTFIELD_CANVAS_W = 40;
const OUTFIELD_CANVAS_H = 50;
const GK_SCALE = 1.15;
const GK_CANVAS_W = Math.round(OUTFIELD_CANVAS_W * GK_SCALE);
const GK_CANVAS_H = Math.round(OUTFIELD_CANVAS_H * GK_SCALE);

const OUTLINE_COLOR = 0x1a1a1a;
const OUTLINE_ALPHA = 0.8;
/** 短パン/靴下の色 (両チーム共通、ピッチの緑との対比を優先した中立の濃灰)。 */
const SHORTS_COLOR = 0x262626;

export type AnimFrame = 0 | 1;

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

/** Direction8.None (初期値のみで実プレイでは即座に上書きされる) はテクスチャを焼かないため、
 * 描画時は Down 扱いにフォールバックする。 */
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

/** 1体ぶんの人型を (cx, cy) を胴体中心として Graphics に描く。 */
function drawPlayerSprite(
  g: Phaser.GameObjects.Graphics,
  w: number,
  h: number,
  jerseyColor: number,
  dirVec: { x: number; y: number },
  frame: AnimFrame,
): void {
  const scale = w / OUTFIELD_CANVAS_W;
  const cx = w / 2;
  const cy = h * 0.54;
  const dx = dirVec.x;
  const dy = dirVec.y;

  // 脚 (先に描いて胴体の下に敷く)。歩行時は向いている方向の軸に沿って開く。
  const legStride = frame === 1 ? 3 * scale : 0;
  const legW = 6 * scale;
  const legH = 12 * scale;
  const legY = cy + 13 * scale;
  const legAx = cx - 5 * scale + dx * legStride;
  const legAy = legY + dy * legStride;
  const legBx = cx + 5 * scale - dx * legStride;
  const legBy = legY - dy * legStride;
  g.fillStyle(SHORTS_COLOR, 1);
  g.lineStyle(1.5, OUTLINE_COLOR, OUTLINE_ALPHA);
  g.fillRoundedRect(legAx - legW / 2, legAy - legH / 2, legW, legH, 2 * scale);
  g.strokeRoundedRect(legAx - legW / 2, legAy - legH / 2, legW, legH, 2 * scale);
  g.fillRoundedRect(legBx - legW / 2, legBy - legH / 2, legW, legH, 2 * scale);
  g.strokeRoundedRect(legBx - legW / 2, legBy - legH / 2, legW, legH, 2 * scale);

  // 胴体 (ジャージ)。裾に単色の陰影バンドを足して立体感の最小限の手がかりにする。
  const torsoW = 16 * scale;
  const torsoH = 12 * scale;
  g.fillStyle(jerseyColor, 1);
  g.lineStyle(1.5, OUTLINE_COLOR, OUTLINE_ALPHA);
  g.fillRoundedRect(cx - torsoW / 2, cy - torsoH / 2, torsoW, torsoH, 3 * scale);
  g.strokeRoundedRect(cx - torsoW / 2, cy - torsoH / 2, torsoW, torsoH, 3 * scale);
  const hemH = 3 * scale;
  g.fillStyle(darken(jerseyColor, 0.75), 1);
  g.fillRect(cx - torsoW / 2, cy + torsoH / 2 - hemH, torsoW, hemH);

  // 肩
  const shoulderW = 22 * scale;
  const shoulderH = 6 * scale;
  const shoulderY = cy - 8 * scale;
  g.fillStyle(jerseyColor, 1);
  g.lineStyle(1.5, OUTLINE_COLOR, OUTLINE_ALPHA);
  g.fillRoundedRect(cx - shoulderW / 2, shoulderY - shoulderH / 2, shoulderW, shoulderH, 3 * scale);
  g.strokeRoundedRect(cx - shoulderW / 2, shoulderY - shoulderH / 2, shoulderW, shoulderH, 3 * scale);

  // 頭 (向いている方向へオフセット。「頭がある方向=向いている方向」という既存コンセプトを継承)
  const headR = 6 * scale;
  const headX = cx + dx * 4 * scale;
  const headY = cy - 14 * scale + dy * 3 * scale;
  g.fillStyle(PLAYER_HEAD_COLOR, 1);
  g.lineStyle(1.5, OUTLINE_COLOR, 0.7);
  g.fillCircle(headX, headY, headR);
  g.strokeCircle(headX, headY, headR);
}

/**
 * 64テクスチャを1回だけ焼き込む。Scene再生成時の重複生成防止に、既存のボールテクスチャと
 * 同じ「代表キーの存在チェック」ガードを使う。
 */
export function buildPlayerSpriteTextures(scene: Phaser.Scene): void {
  const guardKey = playerSpriteKey(TeamId.A, false, Direction8.Down, 0);
  if (scene.textures.exists(guardKey)) return;

  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const teams: TeamId[] = [TeamId.A, TeamId.B];
  const frames: AnimFrame[] = [0, 1];

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
