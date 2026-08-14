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
import { TEAM_COLORS, BALL_COLOR, CURSOR_RING_COLOR, PASS_MARKER_COLOR } from './teamColors';
import { findTouchPriorityPlayer } from '../sim/ballTouch';
import { isTeamAInPossession, selectPassTarget } from '../sim/cursor';
import { toFloat } from '../core/fixed';
import { GOAL_WIDTH_FIXED } from '../sim/goalkeeperConstants';
import { formatClockText, formatScoreText } from './scoreboard';
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
  private playerRadarDots: Phaser.GameObjects.Arc[] = [];
  private cursorRing!: Phaser.GameObjects.Arc;
  private passMarker!: Phaser.GameObjects.Text;

  // スコアボードHUD (画面固定表示、カメラスクロールの影響を受けない setScrollFactor(0))。
  private scoreText!: Phaser.GameObjects.Text;
  private clockText!: Phaser.GameObjects.Text;

  private ballMain!: Phaser.GameObjects.Arc;
  private ballShadow!: Phaser.GameObjects.Ellipse;
  private ballRadarDot!: Phaser.GameObjects.Arc;

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
  }

  private colorFor(player: PlayerState): number {
    const palette = TEAM_COLORS[player.team];
    return player.isGoalkeeper ? palette.goalkeeper : palette.outfield;
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
    }

    // カーソルハイライト (縁取りのみのリング、常に操作選手の位置に表示)
    this.cursorRing = this.add.circle(0, 0, OUTFIELD_RADIUS + 5, 0x000000, 0);
    this.cursorRing.setStrokeStyle(3, CURSOR_RING_COLOR, 0.9);

    // カーソルパスの受け手マーカー (「↓」、Team Aがボール保持中かつ受け手がいる時だけ表示)
    this.passMarker = this.add.text(0, 0, '↓', {
      fontSize: '22px',
      color: '#' + PASS_MARKER_COLOR.toString(16).padStart(6, '0'),
      fontStyle: 'bold',
    });
    this.passMarker.setOrigin(0.5, 1);
    this.passMarker.setVisible(false);

    // ボール (視認性のため実物より大きめ、縁取りでピッチの緑との境界を明確にする)
    this.ballMain = this.add.circle(0, 0, BALL_RADIUS_PX, BALL_COLOR);
    this.ballMain.setStrokeStyle(2, 0x1a1a1a, 0.8);
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

    this.radarCamera.ignore([this.scoreText, this.clockText]);
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
    this.render();
  }

  private render(): void {
    this.state.players.forEach((player, index) => {
      const px = vecToPx(player.pos);
      this.playerArcs[index]?.setPosition(px.x, px.y);
      this.playerRadarDots[index]?.setPosition(px.x, px.y);
    });

    const controlled = this.state.players[this.state.controlledPlayerIndex];
    if (controlled) {
      const px = vecToPx(controlled.pos);
      this.cursorRing.setPosition(px.x, px.y);
    }

    this.renderPassMarker();

    this.scoreText.setText(formatScoreText(this.state));
    this.clockText.setText(formatClockText(this.state));

    const groundPx = vecToPx(this.state.ball.pos); // ボールの「地面位置」(影・レーダーはこちらを使う)
    const lift = ballLiftPx(this.state.ball.height);

    this.ballShadow.setPosition(groundPx.x, groundPx.y);
    this.ballMain.setPosition(groundPx.x, groundPx.y - lift); // 疑似3D: 高さ分だけ見た目を持ち上げる
    this.ballRadarDot.setPosition(groundPx.x, groundPx.y);

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
