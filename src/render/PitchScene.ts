import Phaser from 'phaser';
import { FixedTimestepLoop } from '../core/loop';
import { createInitialState, type GameState, type PlayerState } from '../sim/state';
import { simulate } from '../sim/update';
import { InputManager } from '../input/inputManager';
import { Direction8, type InputFrame } from '../input/types';
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
import {
  buildGbPlayerSpriteTextures,
  gbPlayerSpriteKey,
  isGbSpriteModeEnabled,
  preloadGbPlayerSprites,
} from './gbPlayerSprites';
import { PauseOverlay } from '../input/pauseOverlay';
import { KeymapOverlay } from '../input/keymapOverlay';
import {
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  saveAudioSettings,
  type AudioSettings,
} from './audioSettings';
import { createProjection, DEFAULT_PROJECTION_CONFIG, type Projection } from './projection';
import { drawPitchPerspective } from './pitchPerspective';
import { CIRCLE_RADIUS, pitchLineSegments } from './pitchGeometry';
import { drawStadium } from './stadium';
import { findTouchPriorityPlayer } from '../sim/ballTouch';
import { isTeamAInPossession, selectPassTarget } from '../sim/cursor';
import { toFixed, toFloat } from '../core/fixed';
import {
  classifyDrillEvent,
  classifyKickDribbleStart,
  classifyLineShift,
  formatDrillPanel,
  DRILL_LOG_SIZE,
  type DrillCurve,
  type DrillEvent,
} from './drillHud';
import { GOAL_WIDTH_FIXED } from '../sim/goalkeeperConstants';
import { KICK_MAX_CHARGE_FRAMES } from '../sim/ballConstants';
import { formatClockText, formatScoreText } from './scoreboard';
import { formatEventBannerText } from './eventBanner';
import { formatButtonGuide } from './buttonGuide'; // ボタンガイド (文脈別の役割表示)
import { ReplayRecorder } from '../replay/ReplayRecorder';
import { detectSoundEvents, SoundEventId } from './soundEvents';
import { SoundPlayer } from './SoundPlayer';
import { MusicPlayer, type MusicTrack } from './MusicPlayer';
import { getHalf, isFulltime } from '../sim/matchClock';
import {
  BALL_HEIGHT_GROW_PER_PX,
  BALL_HEIGHT_LIFT_SCALE,
  BALL_SHADOW_SHRINK_PER_PX,
  FOCUS_SCREEN_Y_FRAC,
  PLAYER_SIZE_BOOST,
  RADAR_ALPHA,
} from './viewConstants';
import { followCameraWorldX, followFocusWorldY, makeCameraFollowConfig } from './camera';
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
/** 注視点 (ボール) の画面Y。調整値の実体は render/viewConstants.ts (段階1で集約)。 */
const FOCUS_SCREEN_Y = VIEWPORT_HEIGHT * FOCUS_SCREEN_Y_FRAC;
const CAMERA_FOLLOW_CONFIG = makeCameraFollowConfig(PITCH_HEIGHT);

const BALL_RADIUS_PX = 8;
/** 選手の歩行アニメ切替間隔 (tick数)。 */
const WALK_ANIM_TICKS_PER_FRAME = 6;
/** キック解放時のインパクト表示の持続時間 (ms、実フレーム時間ベース。描画専用)。 */
const KICK_FLASH_DURATION_MS = 180;
/**
 * この量だけボール速度が跳ね上がったら「蹴った」とみなしてフラッシュを出す (px/tick)。
 * ドリブルタッチの押し出しは約3.6だが「前tickとの差」は小さいため誤検出しない。
 */
const KICK_FLASH_MIN_SPEED_JUMP = 2.0;
/**
 * ゴール演出の表示時間 (ms、実フレーム時間ベース)。
 * ★18周目に 1600 → 1100★ 巨大な文字が画面を1.6秒覆い、プレーが見えなかった
 * (自己観察 V3)。短く・小さく・上寄りにして、プレーの視界を優先する。
 */
const GOAL_CELEBRATION_MS = 1100;
/** この速度未満は「静止」とみなし、脚を閉じた基本姿勢に固定する。 */
const WALK_ANIM_MIN_SPEED = 0.15;
/** ボールの見た目回転(視覚効果のみ)の係数。 */
const BALL_VISUAL_SPIN_PER_PX = 0.09;
/** 地面の円 (カーソルリング等) の縦つぶし率。斜め視点で円は楕円に見える。 */
const GROUND_ELLIPSE_SQUASH = 0.42;
/** 操作確認モードで操作する選手の固定index (Team A のアウトフィールド)。 */
const DRILL_PLAYER_INDEX = 9;
/** 操作確認モードで、退避させた選手を並べるゴールラインからの余白 (px)。 */
const DRILL_PARK_MARGIN = 40;
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
  /** 現在のカメラのワールドX (横追従。俯角を原作に合わせた結果、必要になった)。 */
  private cameraWorldX = PITCH_WIDTH / 2;

  // プール化された表示オブジェクト (生成は build*() で1回だけ、render() では更新のみ)。
  private playerSprites: Phaser.GameObjects.Sprite[] = [];
  private playerSpriteKeys: string[] = [];
  /**
   * 【試作】`?sprites=gb` で CC0 の外部スプライト素材へ切り替える (V-2、gbPlayerSprites.ts)。
   * 既定は false = 従来どおり手続き生成。素材の本採用が決まるまでの一時的な比較用スイッチ。
   */
  private readonly useGbSprites = isGbSpriteModeEnabled();
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
  /** 操作確認モードのデバッグパネル (drillHud.ts)。 */
  private drillText!: Phaser.GameObjects.Text;
  private drillLog: DrillEvent[] = [];
  private lastDrillCurve: DrillCurve | null = null;
  /** 前フレームのボール速度 (あらゆる種類のキックを検出してフラッシュを出すため)。 */
  private prevBallSpeed = 0;
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
  /** 試合中のBGM (前半/後半で別曲)。原作の「アップテンポなBGM」に対応 (MusicPlayer.ts)。 */
  private musicPlayer = new MusicPlayer();
  /** いま再生中のBGMトラック (前半/後半で切り替える)。 */
  private musicTrack: MusicTrack | null = null;
  /** フルタイム表示 (結果 + リマッチ導線)。 */
  private fulltimeText!: Phaser.GameObjects.Text;

  private matchStarted = false;
  private matchSetupOverlay: MatchSetupOverlay | null = null;
  /** 試合中のポーズ画面 (Esc)。23周目に新設。 */
  private pauseOverlay: PauseOverlay | null = null;
  /** キーボード割り当ての一覧 (K)。23周目に新設。 */
  private keymapOverlay: KeymapOverlay | null = null;
  private audioSettings: AudioSettings = DEFAULT_AUDIO_SETTINGS;

  constructor() {
    super('Pitch');
  }

  /**
   * 通常は画像アセットを一切持たない (すべて手続き生成) ので preload は空。
   * `?sprites=gb` の試作時だけ、CC0のスプライトシートを1枚読む。
   */
  preload(): void {
    if (this.useGbSprites) preloadGbPlayerSprites(this);
  }

  create(): void {
    this.inputManager = new InputManager(window);

    const overlayEl = document.getElementById('gamepad-overlay');
    if (overlayEl) {
      this.overlay = new GamepadOverlay(overlayEl);
    }

    this.replayRecorder.start(DETERMINISTIC_SEED, this.state.difficulty, this.state.offsideEnabled);
    this.soundPlayer = new SoundPlayer();

    // 音の設定は localStorage から復元し、両プレイヤーへ即座に適用する。
    this.audioSettings = loadAudioSettings();
    this.applyAudioSettings(this.audioSettings);

    const keymapEl = document.getElementById('keymap-overlay');
    if (keymapEl) this.keymapOverlay = new KeymapOverlay(keymapEl);

    const pauseEl = document.getElementById('pause-overlay');
    if (pauseEl) {
      this.pauseOverlay = new PauseOverlay(pauseEl, this.audioSettings);
      this.pauseOverlay.onSettingsChange((settings) => this.updateAudioSettings(settings));
    }

    const setupEl = document.getElementById('match-setup-overlay');
    if (setupEl) {
      this.matchSetupOverlay = new MatchSetupOverlay(setupEl, this.audioSettings);
      this.matchSetupOverlay.onAudioSettingsChange((settings) => this.updateAudioSettings(settings));
      this.matchSetupOverlay.waitForStart(({ difficulty, offsideEnabled }) => {
        this.state = createInitialState(DETERMINISTIC_SEED, { difficulty, offsideEnabled });
        this.replayRecorder.start(DETERMINISTIC_SEED, difficulty, offsideEnabled);
        this.matchStarted = true;
        // 試合開始のキー入力は「ユーザー操作」なので、ここが AudioContext を起こす正規の
        // タイミング (ブラウザの自動再生ポリシー上、操作ハンドラ内でしか resume できない)。
        this.soundPlayer.ensureStarted();
        this.musicPlayer.ensureStarted();
        this.musicPlayer.play('firstHalf');
      });
    } else {
      this.matchStarted = true;
    }

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      this.soundPlayer.ensureStarted();
      this.musicPlayer.ensureStarted();

      // ★キー一覧 (K)★ どの場面でも開ける。段階2の手触り評価で「どのキーが何か」を
      // 画面上で確認できるようにするため (input/keymapOverlay.ts)。
      if (e.code === 'KeyK') {
        this.keymapOverlay?.toggle();
        return;
      }
      // ★ポーズ (Esc)★ 試合中だけ効く。ポーズ中は fixedUpdate を止め、音の設定を変えられる。
      if (e.code === 'Escape' && this.matchStarted) {
        this.pauseOverlay?.setVisible(!this.pauseOverlay.isVisible());
        return;
      }
      // ポーズ中のキーはまずオーバーレイへ渡す (BGM/効果音の切り替えを横取りさせる)。
      if (this.pauseOverlay?.handleKey(e.key)) return;
      if (this.pauseOverlay?.isVisible()) return;

      // ★一括ミュート (M キー)★ BGM/効果音の個別設定 (Esc のポーズ画面) とは別に、
      // 「今すぐ全部黙らせる」ための即効トグルとして残す。
      if (e.code === 'KeyM') {
        const muted = !this.soundPlayer.isMuted();
        this.updateAudioSettings({ bgm: !muted, sfx: !muted });
      }
      // ★練習モード (P キー)★ CPUがボールに一切関与しなくなる。動き・ボタンの効きを
      // 相手に邪魔されず確認するための開発/練習用トグル (GameState.cpuHandsOff 参照)。
      if (e.code === 'KeyP') {
        this.state = { ...this.state, cpuHandsOff: !this.state.cpuHandsOff };
      }
      // ★操作確認モード (T キー)★ 「自分1人とボールだけ」の無菌室を作る。
      // ONにした瞬間に、操作選手以外の21人をタッチライン外へ退避させ、ボールを足元へ置く。
      // 以後 GameState.drillMode により21人は完全静止し、CPUの判断も一切走らない。
      if (e.code === 'KeyT') {
        this.state = this.state.drillMode ? this.exitDrillMode() : this.enterDrillMode();
        this.drillLog = [];
        this.lastDrillCurve = null;
      }
      // ★操作確認モード中の R★ ボールを足元へ戻す。蹴るたびにボールが転がっていってしまい、
      // 「もう一度同じ操作を試す」たびに追いかける必要があったため (自己検証で判明)。
      if (e.code === 'KeyR' && this.state.drillMode) {
        const me = this.state.players[this.state.controlledPlayerIndex];
        if (me) {
          this.state = {
            ...this.state,
            ball: {
              ...this.state.ball,
              pos: { x: me.pos.x, y: me.pos.y },
              vel: { x: toFixed(0), y: toFixed(0) },
              height: toFixed(0),
              zVel: toFixed(0),
              curveDirection: Direction8.None,
              curveTicksLeft: 0,
              curveWindowTicksLeft: 0,
            },
          };
        }
      }
      // ★リマッチ (R キー)★ フルタイム後に同じ設定でもう1試合始める
      // (原作は試合が終わったら次へ行ける。現状は時計が止まるだけだった)。
      if (e.code === 'KeyR' && isFulltime(this.state.frame)) {
        this.state = createInitialState(DETERMINISTIC_SEED, {
          difficulty: this.state.difficulty,
          offsideEnabled: this.state.offsideEnabled,
        });
        this.replayRecorder.start(DETERMINISTIC_SEED, this.state.difficulty, this.state.offsideEnabled);
        this.musicTrack = null;
        this.goalCelebrationMs = 0;
      }
    });
    window.addEventListener('pointerdown', () => this.soundPlayer.ensureStarted());

    this.buildBallTexture();
    buildPlayerSpriteTextures(this);
    if (this.useGbSprites) buildGbPlayerSpriteTextures(this);
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
       * 操作確認モードのパネル文字列 (読み取り専用)。23周目に追加。
       * 「押したらこの操作が発動する」を自動で検証するために要る (CLAUDE.md
       * 「検証の絶対原則」1: 統計ではなく因果を見る)。表示と同じ文字列を返すので、
       * 画面で見えているものとテストが見ているものが一致する。
       */
      getDrillPanelText: (): string =>
        formatDrillPanel(this.state, this.cachedInputs, this.drillLog, this.lastDrillCurve),
      /**
       * 焼き込み済みテクスチャの原画を取り出す (読み取り専用)。
       * 23周目に追加。スプライトの造形を「試合の1コマを切り出して拡大する」のではなく、
       * 8方向×4フレームを一覧にして直接検証するために要る (人体比率・走行モーションの確認)。
       */
      getTextureImage: (key: string): CanvasImageSource | null =>
        this.textures.exists(key) ? (this.textures.get(key).getSourceImage() as CanvasImageSource) : null,
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

  /** 選手1人ぶんのテクスチャキー。試作スイッチ (`?sprites=gb`) の唯一の分岐点。 */
  private spriteKeyFor(player: PlayerState, frame: AnimFrame): string {
    const dir = resolveSpriteDirection(player.facing);
    return this.useGbSprites
      ? gbPlayerSpriteKey(player.team, player.isGoalkeeper, dir, frame)
      : playerSpriteKey(player.team, player.isGoalkeeper, dir, frame);
  }

  private buildEntities(): void {
    this.ballShadow = this.add.ellipse(0, 0, 16, 7, 0x000000, 0.35);

    for (const player of this.state.players) {
      // 接地影 → 本体 → 背番号 の順に作る (depthは毎フレーム設定する)。
      const shadow = this.add.ellipse(0, 0, 20, 8, 0x000000, 0.3);
      this.playerShadows.push(shadow);

      const key = this.spriteKeyFor(player, 0);
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
    // ★段階1★ 半透明にして、レーダーの裏に隠れた選手の気配が分かるようにする
    // (縦長ピッチのためレーダーはどうしても縦に大きく、完全不透明だと右サイドが死角になる)。
    this.radarCamera.setAlpha(RADAR_ALPHA);

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

    // 操作確認モードのデバッグパネル (drillHud.ts が文字列を組み立てる)。
    this.drillText = this.add.text(6, HUD_HEIGHT + 6, '', {
      fontSize: '11px',
      color: '#d8f5ff',
      backgroundColor: '#0b1622cc',
      padding: { x: 6, y: 4 },
      lineSpacing: 2,
    });
    this.drillText.setScrollFactor(0);
    this.drillText.setDepth(DEPTH_HUD + 2);
    this.drillText.setVisible(false);

    this.goalText = this.add.text(VIEWPORT_WIDTH / 2, HUD_HEIGHT + 70, 'GOAL!', {
      fontSize: '46px',
      color: '#ffe680',
      fontStyle: 'bold',
      stroke: '#22160a',
      strokeThickness: 8,
    });
    this.goalText.setOrigin(0.5, 0.5);
    this.goalText.setScrollFactor(0);
    this.goalText.setDepth(DEPTH_HUD + 2);
    this.goalText.setVisible(false);

    // フルタイム画面 (結果 + リマッチ導線)。原作調査 G1 への対応。
    this.fulltimeText = this.add.text(VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2, '', {
      fontSize: '30px',
      color: '#ffffff',
      fontStyle: 'bold',
      align: 'center',
      backgroundColor: '#05080deb',
      padding: { x: 22, y: 18 },
      stroke: '#000000',
      strokeThickness: 4,
    });
    this.fulltimeText.setOrigin(0.5, 0.5);
    this.fulltimeText.setScrollFactor(0);
    this.fulltimeText.setDepth(DEPTH_HUD + 3);
    this.fulltimeText.setVisible(false);

    this.radarCamera.ignore([
      this.fulltimeText,
      this.hudBar,
      this.scoreText,
      this.clockText,
      this.eventBannerText,
      this.inputDebugText,
      this.buttonGuideText,
      this.practiceText,
      this.drillText,
      this.goalText,
    ]);
  }

  /**
   * 操作確認モードへ入る。操作選手以外をピッチ外へ退避させ、ボールを足元に置く。
   * GameState を直接組み替えるが、これは既存の練習モード(P)と同じ「シーンから直接
   * 状態を差し替える」パターン (リプレイの再現性は保証しない、state.ts のコメント参照)。
   */
  private enterDrillMode(): GameState {
    // 常に同じ場所 (ハーフウェーライン付近の中央) から始める。どこで押しても同条件で
    // 試せるようにするため。操作対象も固定のアウトフィールド選手にする。
    const idx = DRILL_PLAYER_INDEX;
    const startX = PITCH_WIDTH / 2;
    const startY = PITCH_HEIGHT / 2 + 120;
    const pos = { x: toFixed(startX), y: toFixed(startY) };
    const zero = { x: toFixed(0), y: toFixed(0) };
    return {
      ...this.state,
      drillMode: true,
      cpuHandsOff: true,
      controlledPlayerIndex: idx,
      ball: { ...this.state.ball, pos, vel: zero, height: toFixed(0), zVel: toFixed(0) },
      players: this.state.players.map((p, i) => {
        if (i === idx) return { ...p, pos, vel: zero, kickChargeFrames: 0 };
        // 選手はピッチ外へ出そうとしてもクランプで押し戻される (実機で発覚) ので、
        // 「両ゴールライン際に密集させる」形で退避させ、中央のプレー領域を空ける。
        const row = i < 11 ? DRILL_PARK_MARGIN : PITCH_HEIGHT - DRILL_PARK_MARGIN;
        const col = DRILL_PARK_MARGIN + (i % 11) * ((PITCH_WIDTH - DRILL_PARK_MARGIN * 2) / 10);
        return { ...p, pos: { x: toFixed(col), y: toFixed(row) }, vel: zero, kickChargeFrames: 0 };
      }),
      setPieceLock: null,
      pendingKick: null,
      manualLineOffset: toFixed(0),
    };
  }

  /** 操作確認モードを抜ける (選手の配置はそのまま。試合を続けるならリマッチ推奨)。 */
  private exitDrillMode(): GameState {
    return { ...this.state, drillMode: false, cpuHandsOff: false };
  }

  /** BGM/効果音の設定を両プレイヤーへ反映する (保存はしない)。 */
  private applyAudioSettings(settings: AudioSettings): void {
    this.musicPlayer.setMuted(!settings.bgm);
    this.soundPlayer.setMuted(!settings.sfx);
  }

  /** 設定変更の唯一の入口: 反映 + 保存 + 2つのオーバーレイの表示同期。 */
  private updateAudioSettings(settings: AudioSettings): void {
    this.audioSettings = settings;
    this.applyAudioSettings(settings);
    saveAudioSettings(settings);
    this.pauseOverlay?.setSettings(settings);
  }

  private fixedUpdate(): void {
    if (!this.matchStarted) return;
    // ポーズ中は試合を進めない (描画は続くので画面は止まって見える)。
    if (this.pauseOverlay?.isVisible()) return;
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

    // 操作確認モードの「いま何が発動したか」を推定して記録する (描画専用、drillHud.ts)。
    // キック系・蹴り出しドリブル・ライン操作の3系統を拾い、新しい順のログとして残す
    // (1項目ずつ試す評価では「直近1件」だと連続操作で流れてしまうため)。
    for (const drill of [
      classifyDrillEvent(prevState, this.state, inputs),
      classifyKickDribbleStart(prevState, this.state),
      classifyLineShift(prevState, this.state),
    ]) {
      if (!drill) continue;
      this.drillLog.unshift(drill);
      if (this.drillLog.length > DRILL_LOG_SIZE) this.drillLog.length = DRILL_LOG_SIZE;
    }
    const curveDir = this.state.ball.curveDirection;
    if (curveDir && curveDir !== Direction8.None && prevState.ball.curveDirection !== curveDir) {
      this.lastDrillCurve = { direction: curveDir, atFrame: this.state.frame };
    }
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
    if (!freezeCamera) {
      this.updateCamera(ballPx.y, this.state.ball.vel.y / 256);
      this.cameraWorldX = followCameraWorldX(this.cameraWorldX, ballPx.x, PITCH_WIDTH);
    }
    this.cameraWorldY = this.projection.cameraWorldYFor(this.focusWorldY, FOCUS_SCREEN_Y);

    drawPitchPerspective(
      this.pitchGraphics,
      this.projection,
      this.cameraWorldY,
      this.cameraWorldX,
      toFloat(GOAL_WIDTH_FIXED),
    );

    this.renderPlayers();
    this.renderBall(ballPx);

    const controlled = this.state.players[this.state.controlledPlayerIndex];
    this.renderCursor(controlled, delta);
    this.renderKickFeedback(controlled, delta);
    this.renderGoalCelebration(delta);
    this.renderInputDebug(controlled);
    this.renderPassMarker();
    this.renderMatchFlow();

    this.scoreText.setText(formatScoreText(this.state));
    this.clockText.setText(formatClockText(this.state));

    const bannerText = formatEventBannerText(this.state);
    this.eventBannerText.setText(bannerText ?? '');
    this.eventBannerText.setVisible(bannerText !== null);
  }

  /** 注視点 (ボール) の追従。カメラのワールドYはここから毎フレーム導出する。 */
  private updateCamera(ballWorldY: number, ballVelY: number): void {
    this.focusWorldY = followFocusWorldY(this.focusWorldY, ballWorldY, ballVelY, CAMERA_FOLLOW_CONFIG);
  }

  private renderPlayers(): void {
    this.state.players.forEach((player, index) => {
      const world = vecToPx(player.pos);
      const p = this.projection.project(world.x, world.y, this.cameraWorldY, this.cameraWorldX);

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
      const key = this.spriteKeyFor(player, animFrame);
      if (this.playerSpriteKeys[index] !== key) {
        this.playerSpriteKeys[index] = key;
        sprite.setTexture(key);
      }
    });
  }

  private renderBall(ballPx: { x: number; y: number }): void {
    const p = this.projection.project(ballPx.x, ballPx.y, this.cameraWorldY, this.cameraWorldX);
    this.ballRadarDot.setPosition(ballPx.x, ballPx.y);

    if (!p.visible) {
      this.ballMain.setVisible(false);
      this.ballShadow.setVisible(false);
      return;
    }

    // 影は地面、本体は高さぶんだけ画面上へ持ち上げる (持ち上げ量も遠近スケールに従う)。
    // 係数は render/viewConstants.ts (段階1で「浮いて見えない」を解消するため強調した)。
    const heightPx = toFloat(this.state.ball.height);
    this.ballShadow.setVisible(true);
    this.ballShadow.setPosition(p.x, p.y);
    // 高く浮くほど影は小さく薄くする (高さの最も分かりやすい手がかり)。
    const shadowShrink = 1 / (1 + heightPx * BALL_SHADOW_SHRINK_PER_PX);
    this.ballShadow.setScale(p.scale * shadowShrink);
    this.ballShadow.setAlpha(0.35 * shadowShrink);
    this.ballShadow.setDepth(ballPx.y - 0.4);

    this.ballMain.setVisible(true);
    this.ballMain.setPosition(p.x, p.y - heightPx * p.scale * BALL_HEIGHT_LIFT_SCALE);
    // 高いボールほど大きく描く (カメラに近づくため)。
    this.ballMain.setScale(p.scale * (1 + heightPx * BALL_HEIGHT_GROW_PER_PX));
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
    const p = this.projection.project(world.x, world.y, this.cameraWorldY, this.cameraWorldX);
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

  /**
   * ★18周目: 試合の流れの演出 (BGM切替 + フルタイム画面 + リマッチ導線)★
   *
   * 原作調査より:
   *   - BGMは「試合の前半後半で異なる曲」(当時のレビュー) → ハーフタイムで切り替える
   *   - 試合が終わったら結果を見せて次へ行ける (現状はフルタイムで時計が止まるだけだった、
   *     docs/original-gap-list.md G1)
   */
  private renderMatchFlow(): void {
    const half = getHalf(this.state.frame);
    const finished = isFulltime(this.state.frame);

    if (finished) {
      if (this.musicTrack !== null) {
        this.musicPlayer.stop();
        this.musicTrack = null;
      }
      const [a, b] = this.state.score;
      const result = a > b ? 'WIN' : a < b ? 'LOSE' : 'DRAW';
      this.fulltimeText.setText(`FULL TIME\n${a} - ${b}\n${result}\n\nR キーでもう一度`);
      this.fulltimeText.setVisible(true);
      return;
    }

    this.fulltimeText.setVisible(false);
    const wanted: MusicTrack = half === 1 ? 'firstHalf' : 'secondHalf';
    if (this.musicTrack !== wanted) {
      this.musicTrack = wanted;
      this.musicPlayer.play(wanted);
    }
  }

  /** ゴール演出 (得点時に大きく出して素早く落ち着く)。描画専用、試合は止めない。 */
  private renderGoalCelebration(delta: number): void {
    if (this.goalCelebrationMs <= 0) {
      this.goalText.setVisible(false);
      return;
    }
    this.goalCelebrationMs = Math.max(0, this.goalCelebrationMs - delta);
    const t = this.goalCelebrationMs / GOAL_CELEBRATION_MS; // 1 → 0
    const pop = 1 + Math.max(0, t - 0.75) * 2.0;
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
    this.practiceText.setVisible(this.state.cpuHandsOff && !this.state.drillMode);
    this.drillText.setVisible(this.state.drillMode);
    if (this.state.drillMode) {
      this.drillText.setText(
        formatDrillPanel(this.state, this.cachedInputs, this.drillLog, this.lastDrillCurve),
      );
    }
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
      const p = this.projection.project(world.x, world.y, this.cameraWorldY, this.cameraWorldX);
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

    // ★段階2★ あらゆる種類のキックでフラッシュを出す。
    // 旧実装は「Bチャージの解放」だけを見ていたため、A/X/Y/ワンツー/リフティング/
    // 蹴り出しドリブルは**画面上まったく無反応**だった (押したかどうかが分からない)。
    // ボール速度の跳ね上がりで検出すれば、経路を問わず1箇所で拾える (描画専用)。
    const nowBallSpeed = Math.hypot(toFloat(this.state.ball.vel.x), toFloat(this.state.ball.vel.y));
    const speedJump = nowBallSpeed - this.prevBallSpeed;
    this.prevBallSpeed = nowBallSpeed;
    const kickedThisFrame = (this.prevKickChargeFrames > 0 && charge === 0) || speedJump > KICK_FLASH_MIN_SPEED_JUMP;
    if (kickedThisFrame) {
      this.kickFlashMs = KICK_FLASH_DURATION_MS;
      const ballWorld = vecToPx(this.state.ball.pos);
      const p = this.projection.project(ballWorld.x, ballWorld.y, this.cameraWorldY, this.cameraWorldX);
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
    const p = this.projection.project(world.x, world.y, this.cameraWorldY, this.cameraWorldX);
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
