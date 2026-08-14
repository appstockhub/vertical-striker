import Phaser from 'phaser';
import { FixedTimestepLoop } from '../core/loop';
import { createInitialState, type GameState, type PlayerState } from '../sim/state';
import { simulate } from '../sim/update';
import { InputManager } from '../input/inputManager';
import type { InputFrame } from '../input/types';
import { GamepadOverlay } from '../input/overlay';
import { MatchSetupOverlay } from '../input/matchSetupOverlay';
import { ballLiftPx, vecToPx } from './fixedToPixel';
import { computeCameraY, type CameraConfig } from './camera';
import { computeRadarLayout } from './radar';
import {
  TEAM_COLORS,
  BALL_COLOR,
  CURSOR_RING_COLOR,
  PASS_MARKER_COLOR,
  FACING_PIP_COLOR,
  GOAL_NET_COLOR,
} from './teamColors';
import { findTouchPriorityPlayer } from '../sim/ballTouch';
import { isTeamAInPossession, selectPassTarget } from '../sim/cursor';
import { toFloat } from '../core/fixed';
import { DIRECTION_VECTORS } from '../sim/constants';
import { GOAL_WIDTH_FIXED } from '../sim/goalkeeperConstants';
import { formatClockText, formatScoreText } from './scoreboard';
import { formatEventBannerText } from './eventBanner';
import { ReplayRecorder } from '../replay/ReplayRecorder';
import { detectSoundEvents } from './soundEvents';
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

const CAMERA_CONFIG: CameraConfig = {
  viewportHeight: VIEWPORT_HEIGHT,
  pitchHeight: PITCH_HEIGHT,
  lookAheadMax: 80,
  lookAheadVelRef: 3,
  smoothing: 0.12,
};

const OUTFIELD_RADIUS = 14;
const GK_RADIUS = 15;
const BALL_RADIUS_PX = 10;
/** 選手の向き表示(facing pip、正体は小さな三角形)。「上下の向きが分かる形状」の最小実装。 */
const FACING_PIP_LENGTH = 9;
const FACING_PIP_HALF_WIDTH = 4;
/** ボールの見た目回転(仮の視覚効果、速度に比例。実際の物理スピンは追跡していない)の係数。 */
const BALL_VISUAL_SPIN_PER_PX = 0.09;
/** ゴールネットの奥行き(px、仮値)。ピッチ境界内側に収める(境界外はカメラに映らないため)。 */
const GOAL_NET_DEPTH = 18;

export class PitchScene extends Phaser.Scene {
  private state: GameState = createInitialState(DETERMINISTIC_SEED);
  private loop!: FixedTimestepLoop;
  private inputManager!: InputManager;
  private overlay: GamepadOverlay | null = null;
  /**
   * 実フレームにつき1回だけサンプルした InputFrame。固定タイムステップの catch-up で
   * 1フレーム内に fixedUpdate() が複数回呼ばれても、それらは同じ入力を使い回す
   * (InputManager.sample() 自体を複数回呼ぶと、KeyboardSource/GamepadSource が
   * 内部で保持する prevButtons がその都度更新され、2回目以降の呼び出しで
   * 立ち上がりedgeを取りこぼす恐れがあるため。Phase 1/2 のキック溜め・カーソル切替は
   * すべて GameState 側で edge を導出する設計なので実害は無かったが、
   * 将来 InputFrame.buttonsPressed に依存するコードが増えた時のための地雷を塞ぐ)。
   */
  private cachedInputs: InputFrame | null = null;

  // プール化された表示オブジェクト。生成は buildEntities()/buildRadar() で1回だけ行い、
  // render() では setPosition()/setVisible() のみを呼ぶ (60fps維持のガードレール、
  // 毎フレーム Arc/Text を生成/破棄しない)。
  private playerArcs: Phaser.GameObjects.Arc[] = [];
  /** 選手の向き表示(facing pip)。playerArcsと1:1対応、player.facingに応じて毎フレーム回転する。 */
  private playerFacingPips: Phaser.GameObjects.Triangle[] = [];
  private playerRadarDots: Phaser.GameObjects.Arc[] = [];
  private cursorRing!: Phaser.GameObjects.Arc;
  private passMarker!: Phaser.GameObjects.Text;
  /** カーソル視認性向上用のパルスアニメーション経過時間 (実フレーム時間、シミュレーションには影響しない)。 */
  private cursorPulseMs = 0;
  /** ボールの見た目回転(視覚効果のみ、GameStateには持たない)。 */
  private ballVisualRotation = 0;

  // スコアボードHUD (画面固定表示、カメラスクロールの影響を受けない setScrollFactor(0))。
  private scoreText!: Phaser.GameObjects.Text;
  private clockText!: Phaser.GameObjects.Text;
  /** スローイン/GKキャッチ等の一時バナー (Phase 5)。試合は止めず、HUD文言のみで視認性を上げる。 */
  private eventBannerText!: Phaser.GameObjects.Text;

  /** ボール本体。サッカーボール模様のテクスチャ(buildBallTexture()で生成)を貼ったImage。 */
  private ballMain!: Phaser.GameObjects.Image;
  private ballShadow!: Phaser.GameObjects.Ellipse;
  private ballRadarDot!: Phaser.GameObjects.Arc;
  /** ゴールネットの装飾(buildGoalNet()で生成、静的)。レーダーには映さない。 */
  private goalNets: Phaser.GameObjects.Graphics[] = [];

  private radarCamera!: Phaser.Cameras.Scene2D.Camera;
  private cameraY = 0;

  // リプレイ記録 (マイルストーン7)。設定UI(マイルストーン0)が無いため、現時点では
  // createInitialState() と同じ既定値 (difficulty='medium', offsideEnabled=true) を渡す。
  private replayRecorder = new ReplayRecorder();

  // 効果音フック (マイルストーン8)。実アセットは未調達のため、当面は無音のまま安全に動く。
  private soundPlayer!: SoundPlayer;

  // 試合前設定UI (マイルストーン0)。確定されるまでは既定値(difficulty='medium',
  // offsideEnabled=true)のGameStateがキックオフ配置のまま静止表示され、fixedUpdate()は
  // 何もしない (入力を無効化する、CLAUDE.md「照準スキルを薄めない」= 誤操作で試合が
  // 始まってしまうことを避ける趣旨とも合致する)。
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
    this.soundPlayer = new SoundPlayer(this);

    const setupEl = document.getElementById('match-setup-overlay');
    if (setupEl) {
      this.matchSetupOverlay = new MatchSetupOverlay(setupEl);
      this.matchSetupOverlay.waitForStart(({ difficulty, offsideEnabled }) => {
        this.state = createInitialState(DETERMINISTIC_SEED, { difficulty, offsideEnabled });
        this.replayRecorder.start(DETERMINISTIC_SEED, difficulty, offsideEnabled);
        this.matchStarted = true;
      });
    } else {
      // オーバーレイ用のDOM要素が無い場合 (テスト環境等) は設定UIを待たずに即開始する。
      this.matchStarted = true;
    }

    this.buildBallTexture();
    this.buildPitch();
    this.buildEntities();
    this.buildRadar();
    this.buildHud();

    this.loop = new FixedTimestepLoop({
      onFixedUpdate: () => this.fixedUpdate(),
    });

    this.cameras.main.setBounds(0, 0, PITCH_WIDTH, PITCH_HEIGHT);
    this.cameras.main.setViewport(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  }

  private buildPitch(): void {
    const pitch = this.add.rectangle(0, 0, PITCH_WIDTH, PITCH_HEIGHT, 0x1e6b3a);
    pitch.setOrigin(0, 0);
    pitch.setStrokeStyle(2, 0xffffff, 0.6);

    // 目印代わりの横ライン (縦スクロールが視認しやすいように)
    const lineSpacing = 200;
    for (let y = lineSpacing; y < PITCH_HEIGHT; y += lineSpacing) {
      const line = this.add.line(0, 0, 0, y, PITCH_WIDTH, y, 0xffffff, 0.25);
      line.setOrigin(0, 0);
    }

    // ゴールマウスの目印 (得点処理は伴わない、GKの位置取り確認用の最小限の幾何参照)。
    // Team A の自陣ゴールは y=PITCH_HEIGHT 側、Team B は y=0 側。
    const goalHalfWidth = toFloat(GOAL_WIDTH_FIXED) / 2;
    const goalCenterX = PITCH_WIDTH / 2;
    const goalLineA = this.add.line(
      0,
      0,
      goalCenterX - goalHalfWidth,
      PITCH_HEIGHT,
      goalCenterX + goalHalfWidth,
      PITCH_HEIGHT,
      0xffffff,
      0.9,
    );
    goalLineA.setOrigin(0, 0);
    goalLineA.setLineWidth(4);
    const goalLineB = this.add.line(
      0,
      0,
      goalCenterX - goalHalfWidth,
      0,
      goalCenterX + goalHalfWidth,
      0,
      0xffffff,
      0.9,
    );
    goalLineB.setOrigin(0, 0);
    goalLineB.setLineWidth(4);

    // ゴールネット (見た目のみ、判定には関与しない)。真上からの視点では奥行きを表現できないため、
    // ゴールラインのすぐ内側 (ピッチ境界内、カメラのsetBoundsを越えると描画されないため)に
    // 格子状の網目を敷いて「ネットがある」ことを示す最小限の表現。
    this.buildGoalNet(goalCenterX - goalHalfWidth, goalCenterX + goalHalfWidth, PITCH_HEIGHT, -1);
    this.buildGoalNet(goalCenterX - goalHalfWidth, goalCenterX + goalHalfWidth, 0, 1);
  }

  /**
   * ゴールネットの格子模様を1つ描く (静的な装飾、毎フレーム再描画しない)。
   * @param goalLineY ゴールラインのY座標 (0 または PITCH_HEIGHT)。
   * @param inwardSign ピッチ内側へ向かう方向 (+1=Y増方向、-1=Y減方向)。
   */
  private buildGoalNet(xStart: number, xEnd: number, goalLineY: number, inwardSign: 1 | -1): void {
    const net = this.add.graphics();
    net.lineStyle(1, GOAL_NET_COLOR, 0.35);
    const meshSize = 6;
    const yInner = goalLineY + inwardSign * GOAL_NET_DEPTH;
    // 縦線
    for (let x = xStart; x <= xEnd; x += meshSize) {
      net.lineBetween(x, goalLineY, x, yInner);
    }
    // 横線
    const yMin = Math.min(goalLineY, yInner);
    const yMax = Math.max(goalLineY, yInner);
    for (let y = yMin; y <= yMax; y += meshSize) {
      net.lineBetween(xStart, y, xEnd, y);
    }
    this.goalNets.push(net);
  }

  private colorFor(player: PlayerState): number {
    const palette = TEAM_COLORS[player.team];
    return player.isGoalkeeper ? palette.goalkeeper : palette.outfield;
  }

  /**
   * サッカーボール模様のテクスチャを1回だけ生成する (Graphics→generateTexture、
   * 画像アセット無しで手続き的に描く。CLAUDE.mdの「完全オリジナル素材」方針に合致)。
   * 白地に黒のペンタゴンを数枚配置した簡略パターンで、回転させた時に見た目でも
   * 「回っている」ことが分かるようにする (ballVisualRotationと組み合わせて使う)。
   */
  private buildBallTexture(): void {
    const key = 'ball-texture';
    if (this.textures.exists(key)) return; // Scene再生成時の重複生成を防ぐ
    const size = BALL_RADIUS_PX * 2;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const c = BALL_RADIUS_PX;
    g.fillStyle(BALL_COLOR, 1);
    g.fillCircle(c, c, BALL_RADIUS_PX);
    g.fillStyle(0x1a1a1a, 1);
    // 中央のペンタゴン(簡略化: 5角形の代わりに視認性優先で小さめの正多角形近似)
    this.drawPolygon(g, c, c, BALL_RADIUS_PX * 0.42, 5, -Math.PI / 2);
    // 周辺に3枚、回転させれば動きが分かる非対称配置にする
    this.drawPolygon(g, c, c - BALL_RADIUS_PX * 0.62, BALL_RADIUS_PX * 0.26, 5, 0);
    this.drawPolygon(g, c + BALL_RADIUS_PX * 0.55, c + BALL_RADIUS_PX * 0.35, BALL_RADIUS_PX * 0.26, 5, 1.9);
    this.drawPolygon(g, c - BALL_RADIUS_PX * 0.55, c + BALL_RADIUS_PX * 0.35, BALL_RADIUS_PX * 0.26, 5, 3.7);
    g.lineStyle(2, 0x1a1a1a, 0.8);
    g.strokeCircle(c, c, BALL_RADIUS_PX);
    g.generateTexture(key, size, size);
    g.destroy();
  }

  /** 正n角形を(cx,cy)中心に描く小さなヘルパー (sin/cosはPhaser描画専用の許容範囲、sim/には影響しない)。 */
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
    // 影 (地面位置に描画、疑似3D高さの手がかり)。ボール本体より先に描画して下に敷く。
    this.ballShadow = this.add.ellipse(0, 0, 20, 10, 0x000000, 0.35);

    // 選手22人ぶんを1回だけ生成してプールする。
    for (const player of this.state.players) {
      const radius = player.isGoalkeeper ? GK_RADIUS : OUTFIELD_RADIUS;
      const arc = this.add.circle(0, 0, radius, this.colorFor(player));
      arc.setStrokeStyle(2, 0x1a1a1a, 0.8);
      this.playerArcs.push(arc);

      // 向き表示(facing pip): 選手が向いている方向(player.facing)を示す小さな三角形。
      // 「〇だけでは上下の向きが分からない」を解消する最小実装 (人型シルエットの代替)。
      const pip = this.add.triangle(
        0,
        0,
        0,
        -FACING_PIP_LENGTH,
        -FACING_PIP_HALF_WIDTH,
        FACING_PIP_LENGTH * 0.5,
        FACING_PIP_HALF_WIDTH,
        FACING_PIP_LENGTH * 0.5,
        FACING_PIP_COLOR,
        1,
      );
      pip.setStrokeStyle(1, 0x1a1a1a, 0.6);
      this.playerFacingPips.push(pip);
    }

    // カーソルハイライト (縁取りのみのリング、常に操作選手の位置に表示)。太めのストロークにして
    // 視認性を上げる (仮値、要プレイテスト調整)。
    this.cursorRing = this.add.circle(0, 0, OUTFIELD_RADIUS + 5, 0x000000, 0);
    this.cursorRing.setStrokeStyle(4, CURSOR_RING_COLOR, 1);

    // カーソルパスの受け手マーカー (「↓」、Team Aがボール保持中かつ受け手がいる時だけ表示)
    this.passMarker = this.add.text(0, 0, '↓', {
      fontSize: '22px',
      color: '#' + PASS_MARKER_COLOR.toString(16).padStart(6, '0'),
      fontStyle: 'bold',
    });
    this.passMarker.setOrigin(0.5, 1);
    this.passMarker.setVisible(false);

    // ボール (サッカーボール模様のテクスチャ。実物より大きめの表示サイズでピッチとの境界を明確にする)
    this.ballMain = this.add.image(0, 0, 'ball-texture');
  }

  private buildRadar(): void {
    const layout = computeRadarLayout(
      VIEWPORT_WIDTH,
      PITCH_WIDTH,
      PITCH_HEIGHT,
      RADAR_WIDTH,
      RADAR_MARGIN,
    );

    this.radarCamera = this.cameras.add(layout.x, layout.y, layout.width, layout.height);
    this.radarCamera.setBounds(0, 0, PITCH_WIDTH, PITCH_HEIGHT);
    this.radarCamera.setZoom(layout.zoom);
    this.radarCamera.scrollX = 0;
    this.radarCamera.scrollY = 0;
    // ピッチ本体の緑と紛れないよう、ページ背景に近い濃紺にしてUIパネルとして分離させる。
    // レーダーカメラはメインカメラの後に描画されるため、この背景色がそのままピッチの上に
    // 不透明に乗る (別途"背景板"オブジェクトを重ねる必要はない)。
    this.radarCamera.setBackgroundColor(0x10141a);

    // レーダー枠 (DOM ではなく Phaser の描画で、メインカメラのみに表示するUI的矩形)
    const frame = this.add.rectangle(layout.x, layout.y, layout.width, layout.height, 0x000000, 0);
    frame.setOrigin(0, 0);
    frame.setStrokeStyle(1, 0xffffff, 0.8);
    frame.setScrollFactor(0);
    this.radarCamera.ignore(frame);

    // レーダー用の点 (実寸より大きい固定サイズにして視認性を確保。色はメイン表示と揃える)
    for (const player of this.state.players) {
      const radius = (player.isGoalkeeper ? 6 : 5) / layout.zoom;
      const dot = this.add.circle(0, 0, radius, this.colorFor(player));
      this.playerRadarDots.push(dot);
    }
    this.ballRadarDot = this.add.circle(0, 0, 4 / layout.zoom, BALL_COLOR);

    // メイン/レーダーの出し分けはプール配列から機械的に構築する (手書き列挙は
    // オブジェクト数が増えるほど漏れの元になるため)。
    this.cameras.main.ignore([...this.playerRadarDots, this.ballRadarDot]);
    this.radarCamera.ignore([
      ...this.playerArcs,
      ...this.playerFacingPips,
      ...this.goalNets,
      this.ballMain,
      this.ballShadow,
      this.cursorRing,
      this.passMarker,
    ]);
  }

  /**
   * スコアボードHUD (得点・前後半/経過分)。他のプール化オブジェクトと同じく1回だけ生成し、
   * render() では setText() のみで更新する。setScrollFactor(0) で画面固定表示にし、
   * レーダーカメラには映さない (メインカメラのUI)。
   */
  private buildHud(): void {
    const textStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: '20px',
      color: '#ffffff',
      fontStyle: 'bold',
      backgroundColor: '#00000080',
      padding: { x: 6, y: 3 },
    };
    this.scoreText = this.add.text(VIEWPORT_WIDTH / 2, 6, '0 - 0', textStyle);
    this.scoreText.setOrigin(0.5, 0);
    this.scoreText.setScrollFactor(0);

    this.clockText = this.add.text(VIEWPORT_WIDTH / 2, 32, "H1  0'", textStyle);
    this.clockText.setOrigin(0.5, 0);
    this.clockText.setScrollFactor(0);

    this.eventBannerText = this.add.text(VIEWPORT_WIDTH / 2, 58, '', textStyle);
    this.eventBannerText.setOrigin(0.5, 0);
    this.eventBannerText.setScrollFactor(0);
    this.eventBannerText.setVisible(false);

    this.radarCamera.ignore([this.scoreText, this.clockText, this.eventBannerText]);
  }

  private fixedUpdate(): void {
    if (!this.matchStarted) return; // 試合前設定UI確定待ち (マイルストーン0)
    const inputs = this.cachedInputs;
    if (!inputs) return; // update() が必ず先にサンプルするため通常発生しない
    if (Object.values(inputs.buttons).some(Boolean)) {
      this.overlay?.notifyButtonPressed();
    }
    // リプレイ記録: simulate()が呼ばれるたびに必ず1回、ここ(fixedUpdate側)で記録する
    // (update()側=実フレーム単位で記録すると、catch-upでの複数回呼び出し時に記録漏れが起きるため)。
    this.replayRecorder.record(inputs);
    const prevState = this.state;
    this.state = simulate(this.state, inputs);
    this.soundPlayer.playAll(detectSoundEvents(prevState, this.state));
  }

  update(_time: number, delta: number): void {
    this.cachedInputs = this.inputManager.sample();
    this.loop.tick(delta);
    this.overlay?.pollConnectionState(this.inputManager.isGamepadConnected());
    this.render(delta);
  }

  private render(delta: number): void {
    this.state.players.forEach((player, index) => {
      const px = vecToPx(player.pos);
      this.playerArcs[index]?.setPosition(px.x, px.y);
      this.playerRadarDots[index]?.setPosition(px.x, px.y);

      // 向き表示(facing pip): player.facingのベクトルをそのまま向きに使う (sim/の決定論的
      // DIRECTION_VECTORSを描画側で読むだけで、simulate()の入出力には一切影響しない)。
      const pip = this.playerFacingPips[index];
      if (pip) {
        const dir = DIRECTION_VECTORS[player.facing];
        const dx = toFloat(dir.x);
        const dy = toFloat(dir.y);
        // pipの初期形状は上(-Y)を向いているため、atan2(dy,dx)+90°で目的の向きに合わせる。
        pip.setRotation(Math.atan2(dy, dx) + Math.PI / 2);
        const radius = player.isGoalkeeper ? GK_RADIUS : OUTFIELD_RADIUS;
        pip.setPosition(px.x + dx * (radius * 0.55), px.y + dy * (radius * 0.55));
      }
    });

    const controlled = this.state.players[this.state.controlledPlayerIndex];
    if (controlled) {
      const px = vecToPx(controlled.pos);
      this.cursorRing.setPosition(px.x, px.y);
      // パルスアニメーション (視認性向上、実フレーム時間ベースでシミュレーションには影響しない)。
      this.cursorPulseMs += delta;
      const pulse = (Math.sin(this.cursorPulseMs / 220) + 1) / 2; // 0..1
      this.cursorRing.setScale(1 + pulse * 0.12);
      this.cursorRing.setAlpha(0.75 + pulse * 0.25);
    }

    this.renderPassMarker();

    this.scoreText.setText(formatScoreText(this.state));
    this.clockText.setText(formatClockText(this.state));

    const bannerText = formatEventBannerText(this.state);
    this.eventBannerText.setText(bannerText ?? '');
    this.eventBannerText.setVisible(bannerText !== null);

    const groundPx = vecToPx(this.state.ball.pos); // ボールの「地面位置」(影・レーダーはこちらを使う)
    const lift = ballLiftPx(this.state.ball.height);

    this.ballShadow.setPosition(groundPx.x, groundPx.y);
    this.ballMain.setPosition(groundPx.x, groundPx.y - lift); // 疑似3D: 高さ分だけ見た目を持ち上げる
    this.ballRadarDot.setPosition(groundPx.x, groundPx.y);

    // ボールの見た目回転 (視覚効果のみ、GameStateには持たない/実際の物理スピンは追跡していない)。
    // 速度に比例して回すことで「転がっている」ことが模様の変化で分かるようにする
    // (計画: 回転や位置が分かりやすいボール)。
    const speedPx = Math.hypot(toFloat(this.state.ball.vel.x), toFloat(this.state.ball.vel.y));
    this.ballVisualRotation += speedPx * BALL_VISUAL_SPIN_PER_PX;
    this.ballMain.setRotation(this.ballVisualRotation);

    // カメラ追従先はボール (Phase 1から変更なし。computeCameraY のシグネチャは不変)
    const targetVelY = this.state.ball.vel.y / 256;
    this.cameraY = computeCameraY(groundPx.y, targetVelY, this.cameraY, CAMERA_CONFIG);
    this.cameras.main.scrollY = this.cameraY;
  }

  /**
   * カーソルパスの受け手マーカー ("↓")。Team Aがボールを保持しており、かつ前方コーン内に
   * 受け手候補がいる時だけ表示する。simulate() 内の判定と同じ純関数 (findTouchPriorityPlayer /
   * selectPassTarget) を描画側でも呼び直すことで、GameStateに派生情報を持たせずに済む。
   */
  private renderPassMarker(): void {
    const touchPriorityIndex = findTouchPriorityPlayer(this.state.players, this.state.ball.pos);
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
    const px = vecToPx(receiver.pos);
    this.passMarker.setPosition(px.x, px.y - OUTFIELD_RADIUS - 6);
    this.passMarker.setVisible(true);
  }
}
