import Phaser from 'phaser';
import { TeamId } from '../sim/formations';
import { DIRECTION_VECTORS } from '../sim/constants';
import { Direction8 } from '../input/types';
import { toFloat } from '../core/fixed';
import { TEAM_COLORS, PLAYER_HEAD_COLOR, type TeamKit } from './teamColors';

/**
 * 選手スプライトの手続き的生成。★描画専用★
 *
 * 16周目の疑似3D化にあわせて全面的に描き直し、23周目 (1-C) に人体比率と走行モーションを
 * 作り直した。カメラが地面近く (俯角16.7°) から斜めに見る視点なので、
 * **立っている人を横〜斜め上から見た姿**でなければ画面と噛み合わない。
 *
 * - 足元が接地点: 描画側で origin=(0.5, 1) を指定し、投影した地面座標にそのまま置く。
 * - 8方向 × 走行アニメ4フレーム × (Team A/B) × (フィールド/GK) = 128テクスチャを
 *   起動時に1回だけ焼く。毎フレームのコストは setTexture()/setScale() のみ (60fps方針)。
 * - 画像アセットは使わない (CLAUDE.md「完全オリジナル素材」)。
 *
 * ★キャンバスの寸法 (OUTFIELD_CANVAS_H) は変更しないこと★
 * 画面上の選手の見かけサイズ (41.6px) は段階1で原作と一致を確認した確定値で、
 * `tests/render/viewMetrics.test.ts` の不変条件になっている。頭身を変えるときは
 * **キャンバスの高さではなく中身の比率だけ**を動かす。
 */

const OUTFIELD_CANVAS_W = 30;
const OUTFIELD_CANVAS_H = 46;
const GK_SCALE = 1.1;
const GK_CANVAS_W = Math.round(OUTFIELD_CANVAS_W * GK_SCALE);
const GK_CANVAS_H = Math.round(OUTFIELD_CANVAS_H * GK_SCALE);

const OUTLINE_COLOR = 0x14161a;
const OUTLINE_ALPHA = 0.85;
const BOOT_COLOR = 0x101216;
const HAIR_COLOR = 0x2b1f18;

/** 走行アニメのフレーム番号 (0..3 のランサイクル)。 */
export type AnimFrame = 0 | 1 | 2 | 3;
export const ANIM_FRAME_COUNT = 4;

/**
 * 人体の縦の比率。頭の直径を1「頭身」として、頭頂からの距離で各関節を定義する。
 * 数値は成人男性アスリートの一般的な比率 (7.5頭身の標準canonをわずかに詰めたもの)。
 *
 * 23周目より前は 4.2頭身 (頭の直径10px / 全高42px) で、これが「2頭身の猿のよう」という
 * 印象の主因だった (実測。当初「約6頭身」と見積もっていたが計測すると4.2で、
 * 目分量の見積もりが外れていた)。
 */
const HEADS_TALL = 7.25;
/** 頭頂からの距離 (頭身単位)。 */
const CHIN = 1.0;
const SHOULDER = 1.4;
const WAIST = 3.0;
const HIP = 3.9;
const KNEE = 5.55;
const ANKLE = 7.0;
/** 短パンの裾とソックスの上端 (ユニフォームの帯の位置)。 */
const SHORTS_HEM = 4.45;
const SOCK_TOP = 5.95;

/** キャンバス上端の余白 (px相当、s=1のとき)。頭がキャンバス端で切れないようにする。 */
const TOP_MARGIN = 3;

export interface PlayerSkeleton {
  /** 頭の直径 = 1頭身ぶんの長さ。 */
  readonly headDiameter: number;
  readonly headRadius: number;
  /** 頭頂から接地点までの長さ。 */
  readonly figureHeight: number;
  /** 実際の頭身 (figureHeight / headDiameter)。回帰テストの対象。 */
  readonly headsTall: number;
  readonly topY: number;
  readonly headCenterY: number;
  readonly chinY: number;
  readonly shoulderY: number;
  readonly waistY: number;
  readonly hipY: number;
  readonly kneeY: number;
  readonly ankleY: number;
  readonly groundY: number;
  readonly shortsHemY: number;
  readonly sockTopY: number;
  /** 正面を向いたときの肩の半幅。人体の目安は「肩幅 ≒ 頭幅の2倍」。 */
  readonly shoulderHalfWidth: number;
  /** 走行時に足が前後する距離 (片側)。両端の差 = この2倍が1歩の見た目の幅。 */
  readonly strideLength: number;
}

/**
 * スプライトの骨格を算出する純関数。Phaser に依存しないので node のテストから直接検証できる
 * (`tests/render/playerProportions.test.ts`)。描画とテストで同じ数値を見るための分離。
 */
export function computePlayerSkeleton(canvasHeight: number): PlayerSkeleton {
  const s = canvasHeight / OUTFIELD_CANVAS_H;
  const groundY = canvasHeight - 1;
  const topY = TOP_MARGIN * s;
  const figureHeight = groundY - topY;
  const headDiameter = figureHeight / HEADS_TALL;
  const at = (heads: number): number => topY + headDiameter * heads;

  return {
    headDiameter,
    headRadius: headDiameter / 2,
    figureHeight,
    headsTall: figureHeight / headDiameter,
    topY,
    headCenterY: at(0.5),
    chinY: at(CHIN),
    shoulderY: at(SHOULDER),
    waistY: at(WAIST),
    hipY: at(HIP),
    kneeY: at(KNEE),
    ankleY: at(ANKLE),
    groundY,
    shortsHemY: at(SHORTS_HEM),
    sockTopY: at(SOCK_TOP),
    shoulderHalfWidth: headDiameter,
    strideLength: headDiameter * 1.25,
  };
}

/**
 * 走行サイクル4フレームの位相。
 * 0 = 右脚が前 / 1 = すれ違い (体が伸び上がる) / 2 = 左脚が前 / 3 = すれ違い。
 * 23周目に振り幅を 5.5px → 頭身連動 (約7.2px) へ広げ、さらに膝を曲げるようにした。
 * すれ違いのフレームで体を持ち上げる (BOB) と「走っている」と読める。
 */
const STRIDE_PHASE: readonly number[] = [1, 0, -1, 0];
const BOB_PHASE: readonly number[] = [0, -1, 0, -1];

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
  shortsColor: number,
  sockColor: number,
  dirVec: { x: number; y: number },
  frame: AnimFrame,
): void {
  const sk = computePlayerSkeleton(h);
  const unit = sk.headDiameter; // 以降の太さはすべて頭身に連動させる (比率が崩れない)
  const cx = w / 2;

  // 向きの分解: dx = 横向き成分 (-1..1)、dy = 手前(+)/奥(-) 成分。
  const len = Math.hypot(dirVec.x, dirVec.y) || 1;
  const dx = dirVec.x / len;
  const dy = dirVec.y / len;
  const side = Math.abs(dx); // 1 = 完全な横向き
  const front = dy; // +1 = 手前向き(顔が見える) / -1 = 奥向き(背中)

  const stride = STRIDE_PHASE[frame] ?? 0;
  const bob = (BOB_PHASE[frame] ?? 0) * unit * 0.22;

  const hipY = sk.hipY + bob;
  const shoulderY = sk.shoulderY + bob;
  const waistY = sk.waistY + bob;
  const shortsHemY = sk.shortsHemY + bob;
  const headCenterY = sk.headCenterY + bob;
  const headR = sk.headRadius;

  // --- 脚 (先に描いて胴体の下に敷く) ---
  // 走行方向へ振り出す。奥行き方向(dy)は見た目上つぶれるので半分に圧縮する。
  const legSpread = (0.30 + 0.22 * (1 - side)) * unit;
  const thighW = unit * 0.62;
  const shinW = unit * 0.5;

  /**
   * 1本の脚を「腿 → すね(素肌) → ソックス → スパイク」の4区間で描く。
   * phase = +1 で前へ振り出し、-1 で後ろへ蹴り上げる (踵が浮く)。膝を折ることで
   * 「滑っている」ではなく「走っている」と読めるようにするのが23周目の変更点。
   *
   * ソックスの上端は**膝→足首の線分をパラメータで分割して**求める。ワールドYで比較すると
   * 脚が浮いた時に上下が入れ替わって色が飛ぶ (初回実装のバグ。実際に接触シートで
   * 「片脚だけ白い」フレームが出て気付いた)。
   */
  const SOCK_START_T = (SOCK_TOP - KNEE) / (ANKLE - KNEE);
  const bootW = unit * 0.95;
  const bootH = unit * 0.4;

  const drawLeg = (baseX: number, phase: number): void => {
    const swingX = dx * phase * sk.strideLength;
    // 奥行き方向(dy)の振り出しは見た目上つぶれる。さらに**接地点より下へは出さない**
    // (キャンバス下端で足が切れて白い棒が伸びたように見えるため。接触シートで発覚)。
    const swingY = Math.min(0, dy * phase * sk.strideLength * 0.3);
    // 後ろへ流れている脚は踵が浮く (前へ出ている脚は接地する)。
    const lift = Math.max(0, -phase) * unit * 0.5;
    const footX = baseX + swingX;
    const footY = sk.groundY + swingY - lift;
    const kneeX = baseX + swingX * 0.42;
    const kneeY = sk.kneeY + bob + swingY * 0.42 - lift * 0.45;
    const sockX = kneeX + (footX - kneeX) * SOCK_START_T;
    const sockY = kneeY + (footY - kneeY) * SOCK_START_T;
    const shinEndY = footY - bootH * 0.75;

    g.lineStyle(thighW, PLAYER_HEAD_COLOR, 1);
    g.lineBetween(baseX, hipY, kneeX, kneeY);
    g.lineStyle(shinW, PLAYER_HEAD_COLOR, 1);
    g.lineBetween(kneeX, kneeY, sockX, sockY);
    g.lineStyle(shinW, sockColor, 1);
    g.lineBetween(sockX, sockY, footX, shinEndY);
    // スパイク: 進行方向へつま先を出す。
    g.fillStyle(BOOT_COLOR, 1);
    g.fillRoundedRect(
      footX - bootW / 2 + dx * unit * 0.18,
      footY - bootH,
      bootW,
      bootH,
      bootH * 0.45,
    );
  };

  drawLeg(cx - legSpread, stride);
  drawLeg(cx + legSpread, -stride);

  // --- 腕 (脚と逆位相で振る。肘で軽く折る) ---
  // 素肌のままだとシャツの明るい色に埋もれて腕が消えるので、必ず輪郭線を先に敷く。
  const shoulderHalf = (0.62 + 0.38 * (1 - side)) * sk.shoulderHalfWidth;
  const armW = unit * 0.4;
  const armSwing = -stride * unit * 0.95;
  const elbowY = shoulderY + (hipY - shoulderY) * 0.55;
  const handY = shoulderY + (hipY - shoulderY) * 0.98;
  const armJoints = [-1, 1].map((sign) => {
    const sx = cx + sign * shoulderHalf * 0.94;
    const swing = sign > 0 ? armSwing : -armSwing;
    return {
      shoulder: { x: sx, y: shoulderY + unit * 0.1 },
      elbow: { x: sx + sign * unit * 0.2 + swing * 0.5, y: elbowY },
      hand: { x: sx + sign * unit * 0.1 + swing, y: handY },
    };
  });
  for (const pass of [
    { width: armW + unit * 0.24, color: OUTLINE_COLOR, alpha: OUTLINE_ALPHA },
    { width: armW, color: PLAYER_HEAD_COLOR, alpha: 1 },
  ]) {
    g.lineStyle(pass.width, pass.color, pass.alpha);
    for (const a of armJoints) {
      g.lineBetween(a.shoulder.x, a.shoulder.y, a.elbow.x, a.elbow.y);
      g.lineBetween(a.elbow.x, a.elbow.y, a.hand.x, a.hand.y);
    }
  }

  // --- 短パン (腰〜腿の途中まで。シャツとの明度差で上下が別物だと読ませる) ---
  // 幅は必ずシャツの裾より細くする。太いと「スカート」に見える (接触シートで発覚)。
  const shortsHalf = shoulderHalf * 0.68;
  g.fillStyle(shortsColor, 1);
  g.lineStyle(Math.max(0.6, unit * 0.14), OUTLINE_COLOR, OUTLINE_ALPHA);
  const shorts = [
    { x: cx - shortsHalf, y: waistY },
    { x: cx + shortsHalf, y: waistY },
    { x: cx + shortsHalf * 1.06, y: shortsHemY },
    { x: cx - shortsHalf * 1.06, y: shortsHemY },
  ];
  g.fillPoints(shorts, true);
  g.strokePoints(shorts, true);
  // 裾に一段暗い折り返しを入れて「布」に見せる (初回実装の股の切れ込みは、
  // 素肌色の楔がオムツのように見えたので廃止した)。
  g.fillStyle(darken(shortsColor, 0.75), 1);
  g.fillRect(cx - shortsHalf * 1.06, shortsHemY - unit * 0.16, shortsHalf * 2.12, unit * 0.16);

  // --- 胴体 (シャツ。肩から腰までの台形) ---
  const torsoTop = shoulderY - unit * 0.28;
  const torsoBottom = waistY + unit * 0.16;
  const topHalf = shoulderHalf * 1.04;
  const bottomHalf = shoulderHalf * 0.76;
  g.fillStyle(jerseyColor, 1);
  g.lineStyle(Math.max(0.6, unit * 0.14), OUTLINE_COLOR, OUTLINE_ALPHA);
  const torso = [
    { x: cx - topHalf, y: torsoTop },
    { x: cx + topHalf, y: torsoTop },
    { x: cx + bottomHalf, y: torsoBottom },
    { x: cx - bottomHalf, y: torsoBottom },
  ];
  g.fillPoints(torso, true);
  g.strokePoints(torso, true);
  // 半袖の袖口 (肩から腕の付け根を覆う。これが無いと腕が肩から直接生えて見える)
  const sleeveH = (torsoBottom - torsoTop) * 0.34;
  g.fillStyle(darken(jerseyColor, 0.88), 1);
  for (const sign of [-1, 1]) {
    g.fillTriangle(
      cx + sign * topHalf,
      torsoTop,
      cx + sign * topHalf * 1.16,
      torsoTop + sleeveH,
      cx + sign * topHalf * 0.6,
      torsoTop + sleeveH,
    );
  }
  // 裾の陰影 (立体感の最小限の手がかり)
  g.fillStyle(darken(jerseyColor, 0.72), 1);
  g.fillRect(cx - bottomHalf, torsoBottom - unit * 0.28, bottomHalf * 2, unit * 0.28);
  // 背面向きのときは背中側に縦の陰影を入れて「後ろ姿」だと分かるようにする
  if (front < -0.3) {
    g.fillStyle(darken(jerseyColor, 0.85), 1);
    g.fillRect(cx - unit * 0.17, torsoTop, unit * 0.34, torsoBottom - torsoTop);
  }

  // --- 首 (頭と胴が離れて見えないよう、太めに短く) ---
  g.lineStyle(unit * 0.46, PLAYER_HEAD_COLOR, 1);
  g.lineBetween(cx + dx * unit * 0.14, sk.chinY + bob - unit * 0.1, cx, torsoTop + unit * 0.18);

  // --- 頭 ---
  // 7.25頭身では頭が小さく (直径 約5.8px)、目や鼻で向きを示すには画素が足りない。
  // 向きの手がかりは「頭の左右オフセット」「髪の面積」「肩幅」で作る。
  const headX = cx + dx * unit * 0.28;
  g.fillStyle(PLAYER_HEAD_COLOR, 1);
  g.lineStyle(Math.max(0.5, unit * 0.12), OUTLINE_COLOR, 0.75);
  g.fillCircle(headX, headCenterY, headR);
  g.strokeCircle(headX, headCenterY, headR);

  g.fillStyle(HAIR_COLOR, 1);
  if (front < -0.3) {
    // 奥向き: 後頭部なので髪がほぼ全体を覆う
    g.fillCircle(headX, headCenterY, headR * 0.92);
  } else {
    // 手前/横向き: 前髪を浅めにして顔の面積を残す (深く覆うと頭が茶色い点になる)
    g.beginPath();
    g.arc(headX, headCenterY - headR * 0.22, headR * 0.98, Math.PI, Math.PI * 2, false);
    g.fillPath();
    if (side > 0.5) g.fillCircle(headX - dx * headR * 0.5, headCenterY - headR * 0.1, headR * 0.55);
  }

  // 顔: 手前向き成分がある時だけ目を打つ (1画素相当の点)。
  if (front > -0.2) {
    const eyeY = headCenterY + headR * 0.2;
    const eyeR = Math.max(0.45, headR * 0.17);
    g.fillStyle(OUTLINE_COLOR, 0.9);
    if (side > 0.5) {
      g.fillCircle(headX + dx * headR * 0.34, eyeY, eyeR);
    } else {
      g.fillCircle(headX - headR * 0.36, eyeY, eyeR);
      g.fillCircle(headX + headR * 0.36, eyeY, eyeR);
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
      const kit: TeamKit = TEAM_COLORS[team];
      const jersey = isGoalkeeper ? kit.goalkeeper : kit.outfield;
      // GKは上下とも自分のシャツ色でまとめる (実際のGKユニフォームの慣習にも合う)。
      const shorts = isGoalkeeper ? darken(kit.goalkeeper, 0.62) : kit.shorts;
      const socks = isGoalkeeper ? darken(kit.goalkeeper, 0.62) : kit.socks;
      const w = isGoalkeeper ? GK_CANVAS_W : OUTFIELD_CANVAS_W;
      const h = isGoalkeeper ? GK_CANVAS_H : OUTFIELD_CANVAS_H;
      for (const dir of BAKED_DIRECTIONS) {
        const vec = DIRECTION_VECTORS[dir];
        const dirVec = { x: toFloat(vec.x), y: toFloat(vec.y) };
        for (const frame of frames) {
          g.clear();
          drawPlayerSprite(g, w, h, jersey, shorts, socks, dirVec, frame);
          g.generateTexture(playerSpriteKey(team, isGoalkeeper, dir, frame), w, h);
        }
      }
    }
  }
  g.destroy();
}

/** スプライトの基準サイズ (奥行きスケール1.0のときの表示高さ)。描画側の位置合わせに使う。 */
export const SPRITE_BASE_HEIGHT = OUTFIELD_CANVAS_H;
