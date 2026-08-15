import Phaser from 'phaser';
import { FixedTimestepLoop } from '../core/loop';
import { createInitialState, type GameState, type PlayerState } from '../sim/state';
import { simulate } from '../sim/update';
import { InputManager } from '../input/inputManager';
import type { InputFrame } from '../input/types';
import { GamepadOverlay } from '../input/overlay';
import { MatchSetupOverlay } from '../input/matchSetupOverlay';
import { vecToPx } from './fixedToPixel';
import { computeRadarLayout } from './radar';
import {
  TEAM_COLORS,
  BALL_COLOR,
  CURSOR_RING_COLOR,
  PASS_MARKER_COLOR,
  KICK_CHARGE_COLOR,
  KICK_FLASH_COLOR,
} from './teamColors';
import {
  ANIM_FRAME_COUNT,
  buildPlayerSpriteTextures,
  playerSpriteKey,
  resolveSpriteDirection,
  type AnimFrame,
} from './playerSprites';
import { createProjection, DEFAULT_PROJECTION_CONFIG, type Projection } from './projection';
import { drawPitchPerspective } from './pitchPerspective';
import { CIRCLE_RADIUS, pitchLineSegments } from './pitchGeometry';
import { drawStadium } from './stadium';
import { findTouchPriorityPlayer } from '../sim/ballTouch';
import { isTeamAInPossession, selectPassTarget } from '../sim/cursor';
import { toFloat } from '../core/fixed';
import { GOAL_WIDTH_FIXED } from '../sim/goalkeeperConstants';
import { KICK_MAX_CHARGE_FRAMES } from '../sim/ballConstants';
import { formatClockText, formatScoreText } from './scoreboard';
import { formatEventBannerText } from './eventBanner';
import { formatButtonGuide } from './buttonGuide'; // ボタンガイド (文脈別の役割表示)
import { ReplayRecorder } from '../replay/ReplayRecorder';
import { detectSoundEvents, SoundEventId } from './soundEvents';
import { SoundPlayer } from './SoundPlayer';
import {
  PITCH_HEIGHT,
  PITCH_WIDTH,
  RADAR_MARGIN,
  RADAR_WIDTH,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
} from '../config/pitch';

const DETERMINISTIC_SEED = 1; // Phase 0 は固定シード。Phase 3+ で試合ごとに可変にする。

/**
 * ★16周目: 疑似3D (透視投影) 表示への移行★
 *
 * 原作 (縦スクロールサッカー) の画面を確認した結果、真上からの平面表示ではなく
 * 「地面から少し高い位置で斜め前方を見た」視点であることが分かったため、描画層を
 * 全面的に投影ベースへ移した。sim/ は平面座標のまま一切変更していない
 * (決定論・リプレイ・ネット対戦の前提は無傷)。
 *
 * 設計:
 *   - 変換は render/projection.ts の1箇所に閉じる (X圧縮とスケールを別々に持たない)。
 *   - Phaser のカメラスクロールは使わない。全オブジェクトを毎フレーム「画面座標」に置く。
 *     カメラ移動 = 投影に渡す cameraWorldY を変えること、と定義が1本化される。
 *   - 描画順は depth = ワールドY (手前 = 大きいY = 手前に描く)。
 *   - レーダーだけは従来どおりワールド座標のまま別カメラで描く (真上表示が正しいUI)。
 */
const PROJECTION_CONFIG = DEFAULT_PROJECTION_CONFIG;
/** 注視点 (ボール) を画面のどこに置くか。少し下寄りにして前方の視界を広く取る。 */
const FOCUS_SCREEN_Y = VIEWPORT_HEIGHT * 0.66;
/** カメラ追従のイージング係数 (0..1、1に近いほど速い)。 */
const CAMERA_SMOOTHING = 0.12;
/** 進行方向の先読みオフセット (px) と、その上限に達する速度 (px/tick)。 */
const LOOK_AHEAD_MAX = 90;
const LOOK_AHEAD_VEL_REF = 3;

const BALL_RADIUS_PX = 8;
/** 選手の歩行アニメ切替間隔 (tick数)。 */
const WALK_ANIM_TICKS_PER_FRAME = 6;
/** キック解放時のインパクト表示の持続時間 (ms、実フレーム時間ベース。描画専用)。 */
const KICK_FLASH_DURATION_MS = 180;
/** ゴール演出の表示時間 (ms、実フレーム時間ベース)。 */
const GOAL_CELEBRATION_MS = 1600;
/** この速度未満は「静止」とみなし、脚を閉じた基本姿勢に固定する。 */
const WALK_ANIM_MIN_SPEED = 0.15;
/** ボールの見た目回転(視覚効果のみ)の係数。 */
const BALL_VISUAL_SPIN_PER_PX = 0.09;
/** 地面の円 (カーソルリング等) の縦つぶし率。斜め視点で円は楕円に見える。 */
const GROUND_ELLIPSE_SQUASH = 0.42;
/**
 * 選手の見かけサイズの補正。厳密な投影スケールのままだと、この縦長ピッチ (480x1800) では
 * 選手が小さすぎて背番号も向きも読めない。原作も選手を実寸比より大きく描いており、
 * 「視認性 > 幾何的な正確さ」を優先する (描画専用の演出係数)。
 */
const PLAYER_SIZE_BOOST = 1.4;
/** HUDバーの高さ。 */
const HUD_HEIGHT = 30;

// 描画順 (depth)。選手/ボールはワールドYを depth に使うため 0..PITCH_HEIGHT を占める。
const DEPTH_STADIUM = -3000;
const DEPTH_PITCH = -2000;
const DEPTH_EFFECT = 6000;
const DEPTH_HUD = 10000;

export class PitchScene extends Phaser.Scene {
  private state: GameState = createInitialState(DETERMINISTIC_SEED);
  private loop!: FixedTimestepLoop;
  private inputManager!: InputManager;
  private overlay: GamepadOverlay | null = null;
  /**
   * 実フレームにつき1回だけサンプルした InputFrame。固定タイムステップの catch-up で
   * 1フレーム内に fixedUpdate() が複数回呼ばれても、それらは同じ入力を使い回す。
   */
  private cachedInputs: InputFrame | null = null;

  private readonly projection: Projection = createProjection(PROJECTION_CONFIG);
  /** 追従中の注視点 (ワールドY、イージング後)。 */
  private focusWorldY = PITCH_HEIGHT / 2;
  /** 現在のカメラのワールドY (focusWorldY から毎フレーム導出する)。 */
  private cameraWorldY = PITCH_HEIGHT / 2 + PROJECTION_CONFIG.nearDepth;

  // プール化された表示オブジェクト (生成は build*() で1回だけ、render() では更新のみ)。
  private playerSprites: Phaser.GameObjects.Sprite[] = [];
  private playerSpriteKeys: string[] = [];
  /** 選手の頭上に浮く背番号ラベル (原作の表示を踏襲)。 */
  private playerNumbers: Phaser.GameObjects.Text[] = [];
  /** 選手の接地影 (疑似3Dでは足元の影があるだけで「立っている」感が出る)。 */
  private playerShadows: Phaser.GameObjects.Ellipse[] = [];
  private playerRadarDots: Phaser.GameObjects.Arc[] = [];
  private cursorRing!: Phaser.GameObjects.Ellipse;
  private chargeMeter!: Phaser.GameObjects.Ellipse;
  private kickFlash!: Phaser.GameObjects.Ellipse;
  private kickFlashMs = 0;
  private prevKickChargeFrames = 0;
  private passMarker!: Phaser.GameObjects.Text;
  private cursorPulseMs = 0;
  private ballVisualRotation = 0;

  // HUD (画面固定)。
  private hudBar!: Phaser.GameObjects.Rectangle;
  private scoreText!: Phaser.GameObjects.Text;
  private clockText!: Phaser.GameObjects.Text;
  private eventBannerText!: Phaser.GameObjects.Text;
  private inputDebugText!: Phaser.GameObjects.Text;
  /** ボタンガイド (文脈ごとの役割を常時表示、buttonGuide.ts)。 */
  private buttonGuideText!: Phaser.GameObjects.Text;
  /** 練習モード (CPU非干渉) の表示。Pキーで切り替える。 */
  private practiceText!: Phaser.GameObjects.Text;
  private goalText!: Phaser.GameObjects.Text;
  private goalCelebrationMs = 0;

  private ballMain!: Phaser.GameObjects.Image;
  private ballShadow!: Phaser.GameObjects.Ellipse;
  private ballRadarDot!: Phaser.GameObjects.Arc;

  /** 毎フレーム描き直すピッチ (透視投影のため静的に焼けない)。 */
  private pitchGraphics!: Phaser.GameObjects.Graphics;
  /** 地平線より上のスタジアム (静的、1回だけ描く)。 */
  private stadiumGraphics!: Phaser.GameObjects.Graphics;

  private radarCamera!: Phaser.Cameras.Scene2D.Camera;

  private replayRecorder = new ReplayRecorder();
  private soundPlayer!: SoundPlayer;

  private matchStarted = false;
  private matchSetupOverlay: MatchSetupOverlay | null = null;

  constructor() {
    super('Pitch');
  }

  create(): void {
    this.inputManager = new InputManager(window);

    const overlayEl = document.getElementById('gamepad-overlay');
    if (overlayEl) {
      this.overlay = new GamepadOverlay(overlayEl);
    }

    this.replayRecorder.start(DETERMINISTIC_SEED, this.state.difficulty, this.state.offsideEnabled);
    this.soundPlayer = new SoundPlayer();

    const setupEl = document.getElementById('match-setup-overlay');
    if (setupEl) {
      this.matchSetupOverlay = new MatchSetupOverlay(setupEl);
      this.matchSetupOverlay.waitForStart(({ difficulty, offsideEnabled }) => {
        this.state = createInitialState(DETERMINISTIC_SEED, { difficulty, offsideEnabled });
        this.replayRecorder.start(DETERMINISTIC_SEED, difficulty, offsideEnabled);
        this.matchStarted = true;
        // 試合開始のキー入力は「ユーザー操作」なので、ここが AudioContext を起こす正規の
        // タイミング (ブラウザの自動再生ポリシー上、操作ハンドラ内でしか resume できない)。
        this.soundPlayer.ensureStarted();
      });
    } else {
      this.matchStarted = true;
    }

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      this.soundPlayer.ensureStarted();
      if (e.code === 'KeyM') this.soundPlayer.setMuted(!this.soundPlayer.isMuted());
      // ★練習モード (P キー)★ CPUがボールに一切関与しなくなる。動き・ボタンの効きを
      // 相手に邪魔されず確認するための開発/練習用トグル (GameState.cpuHandsOff 参照)。
      if (e.code === 'KeyP') {
        this.state = { ...this.state, cpuHandsOff: !this.state.cpuHandsOff };
      }
    });
    window.addEventListener('pointerdown', () => this.soundPlayer.ensureStarted());

    this.buildBallTexture();
    buildPlayerSpriteTextures(this);
    this.buildBackground();
    this.buildEntities();
    this.buildRadar();
    this.buildHud();

    this.loop = new FixedTimestepLoop({
      onFixedUpdate: () => this.fixedUpdate(),
    });

    // 透視投影ではオブジェクトを画面座標で置くため、メインカメラはスクロールしない。
    this.cameras.main.setViewport(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    this.cameras.main.setScroll(0, 0);

    // 診断用の読み取り専用ハンドル (14周目で恒久追加)。simへの書き込み手段は公開しない。
    (window as unknown as { __vsDebug?: unknown }).__vsDebug = {
      getFrame: () => this.state.frame,
      isMatchStarted: () => this.matchStarted,
      getSampledInputs: () => this.cachedInputs,
      getState: () => this.state,
      /** E2E検証専用の手動駆動 (非表示タブではrAFがスロットルされるため必要)。 */
      pump: (ticks: number) => {
        for (let i = 0; i < ticks; i++) {
          this.cachedInputs = this.inputManager.sample();
          this.fixedUpdate();
        }
        return this.state.frame;
      },
      /**
       * E2E検証専用: 指定のワールドYを注視点として1フレーム描画し、canvasに絵を焼く。
       * 16周目の疑似3D化に伴い、引数の意味が「カメラのスクロールY」から
       * 「注視点のワールドY」へ変わった (カメラスクロールという概念自体が無くなったため)。
       */
      renderAt: (focusWorldY: number) => {
        this.focusWorldY = focusWorldY;
        this.render(16.7, true);
        this.game.renderer.preRender();
        // カメラごとに willRender() で絞る。子オブジェクトを丸ごと渡すと Camera.ignore()
        // (cameraFilter) が効かず、レーダー用の点がメイン画面に巨大な円として描かれ、
        // レーダー側にはメイン画面がそのまま出る (通常のPhaserループはこの絞り込みを
        // CameraManager が行っている。ここは手動描画なので自前でやる必要がある)。
        const forCamera = (cam: Phaser.Cameras.Scene2D.Camera) =>
          this.children.getChildren().filter((child) => {
            const obj = child as Phaser.GameObjects.GameObject & { willRender?: (c: unknown) => boolean };
            return obj.willRender ? obj.willRender(cam) : true;
          });
        this.game.renderer.render(this, forCamera(this.cameras.main), this.cameras.main);
        this.game.renderer.render(this, forCamera(this.radarCamera), this.radarCamera);
        this.game.renderer.postRender();
        return (this.game.canvas as HTMLCanvasElement).toDataURL('image/png');
      },
    };
  }

  /** 背景 (スタジアム = 静的 / ピッチ = 毎フレーム再描画)。 */
  private buildBackground(): void {
    this.stadiumGraphics = this.add.graphics();
    this.stadiumGraphics.setDepth(DEPTH_STADIUM);
    drawStadium(this.stadiumGraphics, VIEWPORT_WIDTH, PROJECTION_CONFIG.horizonY);

    this.pitchGraphics = this.add.graphics();
    this.pitchGraphics.setDepth(DEPTH_PITCH);
  }

  private colorFor(player: PlayerState): number {
    const palette = TEAM_COLORS[player.team];
    return player.isGoalkeeper ? palette.goalkeeper : palette.outfield;
  }

  /** サッカーボール模様のテクスチャを1回だけ生成する (画像アセット不使用)。 */
  private buildBallTexture(): void {
    const key = 'ball-texture';
    if (this.textures.exists(key)) return;
    const size = BALL_RADIUS_PX * 2;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const c = BALL_RADIUS_PX;
    g.fillStyle(BALL_COLOR, 1);
    g.fillCircle(c, c, BALL_RADIUS_PX);
    g.fillStyle(0x1a1a1a, 1);
    this.drawPolygon(g, c, c, BALL_RADIUS_PX * 0.42, 5, -Math.PI / 2);
    this.drawPolygon(g, c, c - BALL_RADIUS_PX * 0.62, BALL_RADIUS_PX * 0.26, 5, 0);
    this.drawPolygon(g, c + BALL_RADIUS_PX * 0.55, c + BALL_RADIUS_PX * 0.35, BALL_RADIUS_PX * 0.26, 5, 1.9);
    this.drawPolygon(g, c - BALL_RADIUS_PX * 0.55, c + BALL_RADIUS_PX * 0.35, BALL_RADIUS_PX * 0.26, 5, 3.7);
    g.lineStyle(2, 0x1a1a1a, 0.8);
    g.strokeCircle(c, c, BALL_RADIUS_PX);
    g.generateTexture(key, size, size);
    g.destroy();
  }

  /** 正n角形を(cx,cy)中心に描く小さなヘルパー (描画専用、sim/には影響しない)。 */
  private drawPolygon(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    radius: number,
    sides: number,
    rotation: number,
  ): void {
    const points: Phaser.Types.Math.Vector2Like[] = [];
    for (let i = 0; i < sides; i++) {
      const angle = rotation + (i / sides) * Math.PI * 2;
      points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    }
    g.fillPoints(points, true);
  }

  private buildEntities(): void {
    this.ballShadow = this.add.ellipse(0, 0, 16, 7, 0x000000, 0.35);

    for (const player of this.state.players) {
      // 接地影 → 本体 → 背番号 の順に作る (depthは毎フレーム設定する)。
      const shadow = this.add.ellipse(0, 0, 20, 8, 0x000000, 0.3);
      this.playerShadows.push(shadow);

      const key = playerSpriteKey(player.team, player.isGoalkeeper, resolveSpriteDirection(player.facing), 0);
      const sprite = this.add.sprite(0, 0, key);
      // 疑似3D: スプライトの足元を接地点に合わせる。
      sprite.setOrigin(0.5, 1);
      this.playerSprites.push(sprite);
      this.playerSpriteKeys.push(key);

      const label = this.add.text(0, 0, String(player.slotIndex + 1), {
        fontSize: '11px',
        color: '#ffffff',
        backgroundColor: '#00000099',
        padding: { x: 2, y: 0 },
      });
      label.setOrigin(0.5, 1);
      this.playerNumbers.push(label);
    }

    // カーソルハイライト (足元の楕円リング。斜め視点では円は楕円に見える)。
    this.cursorRing = this.add.ellipse(0, 0, 34, 34 * GROUND_ELLIPSE_SQUASH, 0x000000, 0);
    this.cursorRing.setStrokeStyle(3, CURSOR_RING_COLOR, 1);

    this.passMarker = this.add.text(0, 0, '▼', {
      fontSize: '20px',
      color: '#' + PASS_MARKER_COLOR.toString(16).padStart(6, '0'),
      fontStyle: 'bold',
    });
    this.passMarker.setOrigin(0.5, 1);
    this.passMarker.setVisible(false);

    this.ballMain = this.add.image(0, 0, 'ball-texture');

    // キック溜めメーター (押下が効いていること・溜まり具合の可視化)。
    this.chargeMeter = this.add.ellipse(0, 0, 46, 46 * GROUND_ELLIPSE_SQUASH, 0x000000, 0);
    this.chargeMeter.setStrokeStyle(3, KICK_CHARGE_COLOR, 1);
    this.chargeMeter.setVisible(false);

    // キック時のインパクト表示 (蹴れたという手応え)。
    this.kickFlash = this.add.ellipse(0, 0, 20, 20 * GROUND_ELLIPSE_SQUASH, 0x000000, 0);
    this.kickFlash.setStrokeStyle(3, KICK_FLASH_COLOR, 1);
    this.kickFlash.setVisible(false);
    this.kickFlash.setDepth(DEPTH_EFFECT);
  }

  /**
   * レーダー(ミニマップ)用のピッチ下地。ワールド座標のまま描き、レーダーカメラだけが映す。
   *
   * 疑似3D化でメインのピッチ描画が画面座標になったため、レーダーには何の目印も無い
   * 「点が浮いているだけの黒い板」になってしまった。CLAUDE.mdの
   * 「視野の浅さはレーダーで補う。レーダーの視認性・情報量には妥協しない」に反するため、
   * レーダー専用の真上視点のピッチを別に描く。
   */
  private buildRadarPitch(): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    g.setDepth(DEPTH_PITCH);
    g.fillStyle(0x15351f, 1);
    g.fillRect(0, 0, PITCH_WIDTH, PITCH_HEIGHT);
    g.lineStyle(4, 0xffffff, 0.55);
    for (const seg of pitchLineSegments()) {
      g.lineBetween(seg.x1, seg.y1, seg.x2, seg.y2);
    }
    g.strokeCircle(PITCH_WIDTH / 2, PITCH_HEIGHT / 2, CIRCLE_RADIUS);
    return g;
  }

  private buildRadar(): void {
    const layout = computeRadarLayout(VIEWPORT_WIDTH, PITCH_WIDTH, PITCH_HEIGHT, RADAR_WIDTH, RADAR_MARGIN);
    const radarY = layout.y + HUD_HEIGHT; // HUDバーの下へ逃がす

    this.radarCamera = this.cameras.add(layout.x, radarY, layout.width, layout.height);
    this.radarCamera.setBounds(0, 0, PITCH_WIDTH, PITCH_HEIGHT);
    this.radarCamera.setZoom(layout.zoom);
    this.radarCamera.scrollX = 0;
    this.radarCamera.scrollY = 0;
    this.radarCamera.setBackgroundColor(0x0c1017);

    const radarPitch = this.buildRadarPitch();
    this.cameras.main.ignore(radarPitch);

    const frame = this.add.rectangle(layout.x, radarY, layout.width, layout.height, 0x000000, 0);
    frame.setOrigin(0, 0);
    frame.setStrokeStyle(1, 0xffffff, 0.8);
    frame.setScrollFactor(0);
    frame.setDepth(DEPTH_HUD);
    this.radarCamera.ignore(frame);

    for (const player of this.state.players) {
      const radius = (player.isGoalkeeper ? 6 : 5) / layout.zoom;
      const dot = this.add.circle(0, 0, radius, this.colorFor(player));
      this.playerRadarDots.push(dot);
    }
    this.ballRadarDot = this.add.circle(0, 0, 4 / layout.zoom, BALL_COLOR);

    // メイン/レーダーの出し分けはプール配列から機械的に構築する (手書き列挙は漏れの元)。
    this.cameras.main.ignore([...this.playerRadarDots, this.ballRadarDot]);
    this.radarCamera.ignore([
      ...this.playerSprites,
      ...this.playerNumbers,
      ...this.playerShadows,
      this.pitchGraphics,
      this.stadiumGraphics,
      this.ballMain,
      this.ballShadow,
      this.cursorRing,
      this.chargeMeter,
      this.kickFlash,
      this.passMarker,
    ]);
  }

  /** スコアボードHUD (左=スコア / 右=前後半+時間)。原作のレイアウトに合わせて上端固定。 */
  private buildHud(): void {
    this.hudBar = this.add.rectangle(0, 0, VIEWPORT_WIDTH, HUD_HEIGHT, 0x05080d, 0.82);
    this.hudBar.setOrigin(0, 0);
    this.hudBar.setScrollFactor(0);
    this.hudBar.setDepth(DEPTH_HUD);

    this.scoreText = this.add.text(10, 4, '0 - 0', {
      fontSize: '22px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    this.scoreText.setOrigin(0, 0);
    this.scoreText.setScrollFactor(0);
    this.scoreText.setDepth(DEPTH_HUD + 1);

    this.clockText = this.add.text(VIEWPORT_WIDTH - 10, 6, "H1  0'", {
      fontSize: '18px',
      color: '#ffe9a8',
      fontStyle: 'bold',
    });
    this.clockText.setOrigin(1, 0);
    this.clockText.setScrollFactor(0);
    this.clockText.setDepth(DEPTH_HUD + 1);

    this.eventBannerText = this.add.text(VIEWPORT_WIDTH / 2, HUD_HEIGHT + 6, '', {
      fontSize: '18px',
      color: '#ffffff',
      fontStyle: 'bold',
      backgroundColor: '#00000099',
      padding: { x: 6, y: 3 },
    });
    this.eventBannerText.setOrigin(0.5, 0);
    this.eventBannerText.setScrollFactor(0);
    this.eventBannerText.setDepth(DEPTH_HUD + 1);
    this.eventBannerText.setVisible(false);

    // ★ボタンガイド★ (17周目) 続編仕様のボタンは文脈で意味が変わるため、いまの文脈と
    // 各ボタンの役割を常時表示する。「どのボタンが何をするのか画面に出ていない」ことが
    // 「押しても反応しない」という報告の切り分けを難しくしていた (buttonGuide.ts 参照)。
    this.buttonGuideText = this.add.text(VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT - 40, '', {
      fontSize: '12px',
      color: '#eaf6ff',
      backgroundColor: '#000000aa',
      padding: { x: 6, y: 3 },
    });
    this.buttonGuideText.setOrigin(0.5, 0);
    this.buttonGuideText.setScrollFactor(0);
    this.buttonGuideText.setDepth(DEPTH_HUD + 1);

    // 入力診断ライン (14周目、実プレイ「反応しない」の切り分け用)。
    this.inputDebugText = this.add.text(4, VIEWPORT_HEIGHT - 18, '', {
      fontSize: '12px',
      color: '#c8ffc8',
      backgroundColor: '#00000090',
      padding: { x: 4, y: 2 },
    });
    this.inputDebugText.setScrollFactor(0);
    this.inputDebugText.setDepth(DEPTH_HUD + 1);

    // 練習モード表示 (Pキー)。ONの間だけ出す。誤って気付かないまま遊ばないよう目立たせる。
    this.practiceText = this.add.text(VIEWPORT_WIDTH / 2, HUD_HEIGHT + 4, '練習モード: CPU非干渉 (P)', {
      fontSize: '15px',
      color: '#0b1a10',
      backgroundColor: '#aaff33',
      fontStyle: 'bold',
      padding: { x: 6, y: 2 },
    });
    this.practiceText.setOrigin(0.5, 0);
    this.practiceText.setScrollFactor(0);
    this.practiceText.setDepth(DEPTH_HUD + 1);
    this.practiceText.setVisible(false);

    this.goalText = this.add.text(VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2 - 40, 'GOAL!', {
      fontSize: '68px',
      color: '#ffe680',
      fontStyle: 'bold',
      stroke: '#22160a',
      strokeThickness: 8,
    });
    this.goalText.setOrigin(0.5, 0.5);
    this.goalText.setScrollFactor(0);
    this.goalText.setDepth(DEPTH_HUD + 2);
    this.goalText.setVisible(false);

    this.radarCamera.ignore([
      this.hudBar,
      this.scoreText,
      this.clockText,
      this.eventBannerText,
      this.inputDebugText,
      this.buttonGuideText,
      this.practiceText,
      this.goalText,
    ]);
  }

  private fixedUpdate(): void {
    if (!this.matchStarted) return;
    const inputs = this.cachedInputs;
    if (!inputs) return;
    if (Object.values(inputs.buttons).some(Boolean)) {
      this.overlay?.notifyButtonPressed();
    }
    this.replayRecorder.record(inputs);
    const prevState = this.state;
    this.state = simulate(this.state, inputs);
    const events = detectSoundEvents(prevState, this.state);
    this.soundPlayer.playAll(events);
    if (events.includes(SoundEventId.Goal)) this.goalCelebrationMs = GOAL_CELEBRATION_MS;
  }

  update(_time: number, delta: number): void {
    this.cachedInputs = this.inputManager.sample();
    this.loop.tick(delta);
    this.overlay?.pollConnectionState(this.inputManager.isGamepadConnected());
    this.render(delta, false);
  }

  /**
   * @param freezeCamera true なら注視点のイージングを行わない (__vsDebug.renderAt 用)。
   */
  private render(delta: number, freezeCamera: boolean): void {
    const ballPx = vecToPx(this.state.ball.pos);
    if (!freezeCamera) this.updateCamera(ballPx.y, this.state.ball.vel.y / 256);
    this.cameraWorldY = this.projection.cameraWorldYFor(this.focusWorldY, FOCUS_SCREEN_Y);

    drawPitchPerspective(this.pitchGraphics, this.projection, this.cameraWorldY, toFloat(GOAL_WIDTH_FIXED));

    this.renderPlayers();
    this.renderBall(ballPx);

    const controlled = this.state.players[this.state.controlledPlayerIndex];
    this.renderCursor(controlled, delta);
    this.renderKickFeedback(controlled, delta);
    this.renderGoalCelebration(delta);
    this.renderInputDebug(controlled);
    this.renderPassMarker();

    this.scoreText.setText(formatScoreText(this.state));
    this.clockText.setText(formatClockText(this.state));

    const bannerText = formatEventBannerText(this.state);
    this.eventBannerText.setText(bannerText ?? '');
    this.eventBannerText.setVisible(bannerText !== null);
  }

  /** 注視点 (ボール) の追従。カメラのワールドYはここから毎フレーム導出する。 */
  private updateCamera(ballWorldY: number, ballVelY: number): void {
    const lookAhead = Math.max(
      -LOOK_AHEAD_MAX,
      Math.min(LOOK_AHEAD_MAX, (ballVelY / LOOK_AHEAD_VEL_REF) * LOOK_AHEAD_MAX),
    );
    // 注視点はピッチ内にクランプする (ゴール裏へ回り込みすぎない)。
    const desired = Math.max(0, Math.min(PITCH_HEIGHT, ballWorldY + lookAhead));
    this.focusWorldY += (desired - this.focusWorldY) * CAMERA_SMOOTHING;
  }

  private renderPlayers(): void {
    this.state.players.forEach((player, index) => {
      const world = vecToPx(player.pos);
      const p = this.projection.project(world.x, world.y, this.cameraWorldY);

      const sprite = this.playerSprites[index];
      const shadow = this.playerShadows[index];
      const label = this.playerNumbers[index];
      this.playerRadarDots[index]?.setPosition(world.x, world.y);
      if (!sprite || !shadow || !label) return;

      if (!p.visible) {
        sprite.setVisible(false);
        shadow.setVisible(false);
        label.setVisible(false);
        return;
      }

      // 手前ほど大きく、手前ほど後に描く (depth = ワールドY)。
      const drawScale = p.scale * PLAYER_SIZE_BOOST;
      sprite.setVisible(true);
      sprite.setPosition(p.x, p.y);
      sprite.setScale(drawScale);
      sprite.setDepth(world.y);

      shadow.setVisible(true);
      shadow.setPosition(p.x, p.y);
      shadow.setScale(drawScale);
      shadow.setDepth(world.y - 0.5);

      // 背番号ラベル: 頭上に浮かせる。奥ほど小さく、小さすぎたら消す (可読性優先)。
      const spriteHeight = sprite.height * drawScale;
      label.setPosition(p.x, p.y - spriteHeight - 2);
      label.setScale(Math.max(0.55, p.scale));
      label.setDepth(world.y + 0.2);
      label.setVisible(p.scale > 0.3);

      // 向き + 走行アニメ (state.frame ベースなのでリプレイでも同じ見え方になる)。
      const speed = Math.hypot(toFloat(player.vel.x), toFloat(player.vel.y));
      const animFrame: AnimFrame =
        speed >= WALK_ANIM_MIN_SPEED
          ? ((Math.floor(this.state.frame / WALK_ANIM_TICKS_PER_FRAME) % ANIM_FRAME_COUNT) as AnimFrame)
          : 1;
      const key = playerSpriteKey(player.team, player.isGoalkeeper, resolveSpriteDirection(player.facing), animFrame);
      if (this.playerSpriteKeys[index] !== key) {
        this.playerSpriteKeys[index] = key;
        sprite.setTexture(key);
      }
    });
  }

  private renderBall(ballPx: { x: number; y: number }): void {
    const p = this.projection.project(ballPx.x, ballPx.y, this.cameraWorldY);
    this.ballRadarDot.setPosition(ballPx.x, ballPx.y);

    if (!p.visible) {
      this.ballMain.setVisible(false);
      this.ballShadow.setVisible(false);
      return;
    }

    // 影は地面、本体は高さぶんだけ画面上へ持ち上げる (持ち上げ量も遠近スケールに従う)。
    const heightPx = toFloat(this.state.ball.height);
    this.ballShadow.setVisible(true);
    this.ballShadow.setPosition(p.x, p.y);
    // 高く浮くほど影は小さく薄くする (高さの手がかり)。
    const shadowShrink = 1 / (1 + heightPx * 0.02);
    this.ballShadow.setScale(p.scale * shadowShrink);
    this.ballShadow.setAlpha(0.35 * shadowShrink);
    this.ballShadow.setDepth(ballPx.y - 0.4);

    this.ballMain.setVisible(true);
    this.ballMain.setPosition(p.x, p.y - heightPx * p.scale * 1.6);
    // 高いボールほどわずかに大きく描く (カメラに近づくため)。
    this.ballMain.setScale(p.scale * (1 + heightPx * 0.006));
    this.ballMain.setDepth(ballPx.y + 0.5);

    const speedPx = Math.hypot(toFloat(this.state.ball.vel.x), toFloat(this.state.ball.vel.y));
    this.ballVisualRotation += speedPx * BALL_VISUAL_SPIN_PER_PX;
    this.ballMain.setRotation(this.ballVisualRotation);
  }

  private renderCursor(controlled: PlayerState | undefined, delta: number): void {
    if (!controlled) {
      this.cursorRing.setVisible(false);
      return;
    }
    const world = vecToPx(controlled.pos);
    const p = this.projection.project(world.x, world.y, this.cameraWorldY);
    if (!p.visible) {
      this.cursorRing.setVisible(false);
      return;
    }
    this.cursorPulseMs += delta;
    const pulse = (Math.sin(this.cursorPulseMs / 220) + 1) / 2; // 0..1
    this.cursorRing.setVisible(true);
    this.cursorRing.setPosition(p.x, p.y);
    this.cursorRing.setScale(p.scale * (1 + pulse * 0.12));
    this.cursorRing.setAlpha(0.75 + pulse * 0.25);
    this.cursorRing.setDepth(world.y - 0.6);
  }

  /** ゴール演出 (得点時に大きく出して素早く落ち着く)。描画専用、試合は止めない。 */
  private renderGoalCelebration(delta: number): void {
    if (this.goalCelebrationMs <= 0) {
      this.goalText.setVisible(false);
      return;
    }
    this.goalCelebrationMs = Math.max(0, this.goalCelebrationMs - delta);
    const t = this.goalCelebrationMs / GOAL_CELEBRATION_MS; // 1 → 0
    const pop = 1 + Math.max(0, t - 0.75) * 3.2;
    this.goalText.setScale(pop);
    this.goalText.setAlpha(t < 0.25 ? t / 0.25 : 1);
    this.goalText.setVisible(true);
  }

  /** 入力診断ライン。simに届いている入力と操作選手の状態を毎フレーム表示。 */
  private renderInputDebug(controlled: PlayerState | undefined): void {
    const buttons = this.cachedInputs?.buttons;
    const held = buttons
      ? Object.entries(buttons)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join('+')
      : '';
    const dir = this.cachedInputs?.direction ?? 'None';
    this.inputDebugText.setText(
      `t${this.state.frame} dir:${dir} btn:[${held}] chg:${controlled?.kickChargeFrames ?? 0} tkl:${controlled?.tacklePhase ?? 0}`,
    );
    // 練習モードの表示 (Pキーで切替)。ONの間は常時見えるようにする。
    this.practiceText.setVisible(this.state.cpuHandsOff);
    // ボタンガイド (いまの文脈で各ボタンが何をするか)。
    this.buttonGuideText.setText(formatButtonGuide(this.state));
  }

  /**
   * キックの視覚フィードバック。溜め中は足元のリングが締まり、解放時にボール位置で輪が広がる。
   * どちらも描画専用で GameState には触らない。
   */
  private renderKickFeedback(controlled: PlayerState | undefined, delta: number): void {
    const charge = controlled?.kickChargeFrames ?? 0;

    if (controlled && charge > 0) {
      const world = vecToPx(controlled.pos);
      const p = this.projection.project(world.x, world.y, this.cameraWorldY);
      if (p.visible) {
        const ratio = Math.min(1, charge / KICK_MAX_CHARGE_FRAMES);
        this.chargeMeter.setPosition(p.x, p.y);
        this.chargeMeter.setScale(p.scale * (1.45 - ratio * 0.55));
        this.chargeMeter.setAlpha(0.45 + ratio * 0.55);
        this.chargeMeter.setDepth(world.y - 0.7);
        this.chargeMeter.setVisible(true);
      } else {
        this.chargeMeter.setVisible(false);
      }
    } else {
      this.chargeMeter.setVisible(false);
    }

    // 溜めが非ゼロから0へ落ちた = このフレームでキックが解放された。
    if (this.prevKickChargeFrames > 0 && charge === 0) {
      this.kickFlashMs = KICK_FLASH_DURATION_MS;
      const ballWorld = vecToPx(this.state.ball.pos);
      const p = this.projection.project(ballWorld.x, ballWorld.y, this.cameraWorldY);
      if (p.visible) this.kickFlash.setPosition(p.x, p.y);
    }
    this.prevKickChargeFrames = charge;

    if (this.kickFlashMs > 0) {
      this.kickFlashMs = Math.max(0, this.kickFlashMs - delta);
      const t = this.kickFlashMs / KICK_FLASH_DURATION_MS; // 1 → 0
      this.kickFlash.setScale(1 + (1 - t) * 2.2);
      this.kickFlash.setAlpha(t);
      this.kickFlash.setVisible(true);
    } else {
      this.kickFlash.setVisible(false);
    }
  }

  /**
   * カーソルパスの受け手マーカー。Team Aがボールを保持しており、かつ前方コーン内に
   * 受け手候補がいる時だけ表示する (simと同じ純関数を描画側でも呼ぶ)。
   */
  private renderPassMarker(): void {
    const touchPriorityIndex = findTouchPriorityPlayer(
      this.state.players,
      this.state.ball.pos,
      this.state.lastTouchPlayerIndex,
    );
    if (!isTeamAInPossession(touchPriorityIndex) || touchPriorityIndex === null) {
      this.passMarker.setVisible(false);
      return;
    }
    const targetIndex = selectPassTarget(touchPriorityIndex, this.state.players);
    const receiver = targetIndex !== null ? this.state.players[targetIndex] : undefined;
    if (!receiver) {
      this.passMarker.setVisible(false);
      return;
    }
    const world = vecToPx(receiver.pos);
    const p = this.projection.project(world.x, world.y, this.cameraWorldY);
    if (!p.visible) {
      this.passMarker.setVisible(false);
      return;
    }
    const spriteHeight = (this.playerSprites[targetIndex ?? 0]?.height ?? 46) * p.scale;
    this.passMarker.setPosition(p.x, p.y - spriteHeight - 16 * p.scale);
    this.passMarker.setScale(Math.max(0.6, p.scale));
    this.passMarker.setDepth(world.y + 0.3);
    this.passMarker.setVisible(true);
  }
}
