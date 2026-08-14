import Phaser from 'phaser';
import { FixedTimestepLoop } from '../core/loop';
import { createInitialState, type GameState } from '../sim/state';
import { simulate } from '../sim/update';
import { InputManager } from '../input/inputManager';
import { GamepadOverlay } from '../input/overlay';
import { vecToPx } from './fixedToPixel';
import { computeCameraY, type CameraConfig } from './camera';
import { computeRadarLayout } from './radar';
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

export class PitchScene extends Phaser.Scene {
  private state: GameState = createInitialState(DETERMINISTIC_SEED);
  private loop!: FixedTimestepLoop;
  private inputManager!: InputManager;
  private overlay: GamepadOverlay | null = null;

  private playerMain!: Phaser.GameObjects.Arc;
  private ballMain!: Phaser.GameObjects.Arc;
  private playerRadarDot!: Phaser.GameObjects.Arc;
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

  private buildEntities(): void {
    this.ballMain = this.add.circle(0, 0, 7, 0xffffff);
    this.playerMain = this.add.circle(0, 0, 12, 0xffcc33);
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

    // レーダー用の点 (実寸より大きい固定サイズにして視認性を確保)
    this.ballRadarDot = this.add.circle(0, 0, 3 / layout.zoom, 0xffffff);
    this.playerRadarDot = this.add.circle(0, 0, 4 / layout.zoom, 0xffcc33);

    // メインカメラにはレーダー専用オブジェクトを映さない / レーダーカメラにはメイン専用オブジェクトを映さない
    this.cameras.main.ignore([this.ballRadarDot, this.playerRadarDot]);
    this.radarCamera.ignore([this.ballMain, this.playerMain]);
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
    const playerPx = vecToPx(this.state.player.pos);
    const ballPx = vecToPx(this.state.ball.pos);

    this.playerMain.setPosition(playerPx.x, playerPx.y);
    this.ballMain.setPosition(ballPx.x, ballPx.y);
    this.playerRadarDot.setPosition(playerPx.x, playerPx.y);
    this.ballRadarDot.setPosition(ballPx.x, ballPx.y);

    const targetVelY = this.state.player.vel.y / 256;
    this.cameraY = computeCameraY(playerPx.y, targetVelY, this.cameraY, CAMERA_CONFIG);
    this.cameras.main.scrollY = this.cameraY;
  }
}
