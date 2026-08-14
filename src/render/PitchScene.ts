import Phaser from 'phaser';
import { FixedTimestepLoop } from '../core/loop';
import { createInitialState, type GameState, type PlayerState } from '../sim/state';
import { simulate } from '../sim/update';
import { InputManager } from '../input/inputManager';
import { GamepadOverlay } from '../input/overlay';
import { ballLiftPx, vecToPx } from './fixedToPixel';
import { computeCameraY, type CameraConfig } from './camera';
import { computeRadarLayout } from './radar';
import { TEAM_COLORS, BALL_COLOR, CURSOR_RING_COLOR } from './teamColors';
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

  // プール化された表示オブジェクト。生成は buildEntities()/buildRadar() で1回だけ行い、
  // render() では setPosition()/setVisible() のみを呼ぶ (60fps維持のガードレール、
  // 毎フレーム Arc/Text を生成/破棄しない)。
  private playerArcs: Phaser.GameObjects.Arc[] = [];
  private playerRadarDots: Phaser.GameObjects.Arc[] = [];
  private cursorRing!: Phaser.GameObjects.Arc;

  private ballMain!: Phaser.GameObjects.Arc;
  private ballShadow!: Phaser.GameObjects.Ellipse;
  private ballRadarDot!: Phaser.GameObjects.Arc;

  private radarCamera!: Phaser.Cameras.Scene2D.Camera;
  private cameraY = 0;

  constructor() {
    super('Pitch');
  }

  create(): void {
    this.inputManager = new InputManager(window);

    const overlayEl = document.getElementById('gamepad-overlay');
    if (overlayEl) {
      this.overlay = new GamepadOverlay(overlayEl);
    }

    this.buildPitch();
    this.buildEntities();
    this.buildRadar();

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
    this.radarCamera.ignore([...this.playerArcs, this.ballMain, this.ballShadow, this.cursorRing]);
  }

  private fixedUpdate(): void {
    const inputs = this.inputManager.sample();
    if (Object.values(inputs.buttons).some(Boolean)) {
      this.overlay?.notifyButtonPressed();
    }
    this.state = simulate(this.state, inputs);
  }

  update(_time: number, delta: number): void {
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
}
