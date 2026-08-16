import { describe, expect, it } from 'vitest';
import { desiredFocusWorldY, followFocusWorldY, makeCameraFollowConfig } from '../../src/render/camera';
import { createProjection, DEFAULT_PROJECTION_CONFIG } from '../../src/render/projection';
import { PITCH_HEIGHT, PITCH_WIDTH, VIEWPORT_HEIGHT } from '../../src/config/pitch';
import { BALL_HEIGHT_LIFT_SCALE, FOCUS_SCREEN_Y_FRAC } from '../../src/render/viewConstants';
import { GRAVITY_FIXED, KICK_Z_VEL_MAX_FIXED } from '../../src/sim/ballConstants';
import { toFloat } from '../../src/core/fixed';
import { PENALTY_SPOT_DEPTH } from '../../src/render/pitchGeometry';

/**
 * ★段階1: カメラ挙動の検証★
 *
 * 静止画では分からない「追従の速さ・先読み量・振れ・浮き球・セットプレー」を数値で確認する。
 * 描画専用の純関数 (render/camera.ts, render/projection.ts) だけを対象にしており、
 * sim/ には一切触れない。
 *
 * ここは「壊れていないこと」の回帰ゲートも兼ねる。閾値を緩める時は理由をコメントに残すこと。
 */

const cfg = makeCameraFollowConfig(PITCH_HEIGHT);
const projection = createProjection(DEFAULT_PROJECTION_CONFIG);
const focusScreenY = VIEWPORT_HEIGHT * FOCUS_SCREEN_Y_FRAC;

/** ボールのワールドYを、そのフレームのカメラで投影した画面Y。 */
function ballScreenY(focusWorldY: number, ballWorldY: number, ballHeightPx = 0): number {
  const cam = projection.cameraWorldYFor(focusWorldY, focusScreenY);
  const p = projection.project(PITCH_WIDTH / 2, ballWorldY, cam);
  // 描画側と同じ持ち上げ式 (PitchScene.renderBall)。
  return p.y - ballHeightPx * p.scale * BALL_HEIGHT_LIFT_SCALE;
}

describe('camera behavior (段階1)', () => {
  it('1. 追従の速さ: 静止したボールへ収束する時間', () => {
    // ボールが 300px 先へ瞬間移動した状況 (パス/クリア後の再収束) をイメージする。
    let focus = 900;
    const ball = 600;
    const ticksTo = (tolerance: number): number => {
      let f = focus;
      for (let t = 1; t <= 600; t++) {
        f = followFocusWorldY(f, ball, 0, cfg);
        if (Math.abs(f - ball) <= tolerance) return t;
      }
      return -1;
    };
    const t50 = ticksTo(150); // 誤差の半分まで
    const t90 = ticksTo(30); // ほぼ収束
    console.log(`  追従: 誤差300px → 半減まで ${t50}tick (${(t50 / 60).toFixed(2)}s) / 90%まで ${t90}tick (${(t90 / 60).toFixed(2)}s)`);

    // 遅すぎない (0.2秒以内に半減) こと。1フレームで貼り付かない (揺れの元) こと。
    expect(t50).toBeGreaterThan(1);
    expect(t50).toBeLessThanOrEqual(12);
    expect(t90).toBeLessThanOrEqual(45);
  });

  it('2. 先読み量: 速いボールで注視点が前に出る', () => {
    const ballY = PITCH_HEIGHT / 2;
    // 攻撃方向 (y が減る向き) へ最大速度で転がるボール。
    const fast = desiredFocusWorldY(ballY, -6, cfg);
    const still = desiredFocusWorldY(ballY, 0, cfg);
    const lead = still - fast;
    // 先読みぶんだけボールより奥を見るので、ボールは画面上でどれだけ下がるか。
    const ballScreenStill = ballScreenY(still, ballY);
    const ballScreenFast = ballScreenY(fast, ballY);
    console.log(
      `  先読み: ${lead.toFixed(0)}px 前方 → ボールの画面Y ${(ballScreenStill / VIEWPORT_HEIGHT * 100).toFixed(1)}% → ${(ballScreenFast / VIEWPORT_HEIGHT * 100).toFixed(1)}%`,
    );
    expect(lead).toBeGreaterThan(0);
    // ★段階1のユーザー指定の不変条件★
    // 「先読み込みでもボールが画面Y 80%を超えないこと」。下端に貼り付くと進行方向が
    // 見えなくなり、縦スクロール視点の弱点(奥が見えない)がそのまま悪化するため。
    expect(ballScreenFast).toBeLessThanOrEqual(VIEWPORT_HEIGHT * 0.8);
    expect(ballScreenFast).toBeGreaterThan(0);
  });

  it('3. 急な方向転換でカメラが不快に振れない', () => {
    // 1tickごとに速度の符号が反転する最悪ケース (競り合いでボールが往復する状況)。
    let focus = PITCH_HEIGHT / 2;
    const ball = PITCH_HEIGHT / 2;
    let maxStep = 0;
    let prev = focus;
    for (let t = 0; t < 120; t++) {
      const vel = t % 2 === 0 ? 6 : -6;
      focus = followFocusWorldY(focus, ball, vel, cfg);
      maxStep = Math.max(maxStep, Math.abs(focus - prev));
      prev = focus;
    }
    const screenStep = Math.abs(ballScreenY(focus, ball) - ballScreenY(focus + maxStep, ball));
    console.log(`  方向転換: 1tickあたり最大 ${maxStep.toFixed(1)}px (画面上 ${screenStep.toFixed(1)}px)`);
    // 1tickの揺れが画面の2%を超えると「がたつき」として知覚される。
    expect(screenStep).toBeLessThan(VIEWPORT_HEIGHT * 0.02);
  });

  it('4. 浮き球が「浮いて見える」かつ画面外へ消えない', () => {
    // 最大弾道 (zVel 上限) の頂点の高さ。h = v^2 / (2g)。
    const v = toFloat(KICK_Z_VEL_MAX_FIXED);
    const g = toFloat(GRAVITY_FIXED);
    const maxHeight = (v * v) / (2 * g);
    const ballY = PITCH_HEIGHT / 2;

    // (a) 通常の構図 (注視点が追いついている)。
    const rise = (focus: number): number =>
      ballScreenY(focus, ballY, 0) - ballScreenY(focus, ballY, maxHeight);
    const normalRise = rise(ballY);
    // (b) 最悪ケース: 注視点が 250px 後ろに取り残され、ボールが奥に見えている時。
    const worstFocus = ballY + 250;
    const worstRise = rise(worstFocus);
    const worstTop = ballScreenY(worstFocus, ballY, maxHeight);

    console.log(
      `  浮き球: 最大高さ ${maxHeight.toFixed(1)}px → 画面上の上昇量 通常 ${normalRise.toFixed(0)}px (${((normalRise / VIEWPORT_HEIGHT) * 100).toFixed(1)}%) / 最遠 ${worstRise.toFixed(0)}px (${((worstRise / VIEWPORT_HEIGHT) * 100).toFixed(1)}%)`,
    );

    // ★段階1★ 「浮いている」と分かる高さがあること (D-3)。1.6倍だった頃は通常でも
    // 画面の8%しか上がらず、ロングフィード/センタリングの手応えが無かった。
    expect(normalRise).toBeGreaterThanOrEqual(VIEWPORT_HEIGHT * 0.12);
    expect(worstRise).toBeGreaterThanOrEqual(VIEWPORT_HEIGHT * 0.08);
    // 強調しすぎて地平線より上 (スタンドの中) へ消えないこと。
    expect(worstTop).toBeGreaterThan(DEFAULT_PROJECTION_CONFIG.horizonY);
  });

  it('5. セットプレー: キッカーとゴールが同時に見える', () => {
    // PK / ゴール前のFK 相当。キッカーがボール位置、ゴールは worldY=0。
    const kickerY = PENALTY_SPOT_DEPTH;
    const focus = kickerY;
    const kickerScreenY = ballScreenY(focus, kickerY);
    const cam = projection.cameraWorldYFor(focus, focusScreenY);
    const goal = projection.project(PITCH_WIDTH / 2, 0, cam);
    console.log(
      `  セットプレー(PK): キッカー画面Y ${(kickerScreenY / VIEWPORT_HEIGHT * 100).toFixed(1)}% / ゴール画面Y ${(goal.y / VIEWPORT_HEIGHT * 100).toFixed(1)}%`,
    );
    expect(goal.visible).toBe(true);
    // ゴールが地平線に埋もれず、かつキッカーより上 (奥) に見えること。
    expect(goal.y).toBeGreaterThan(DEFAULT_PROJECTION_CONFIG.horizonY);
    expect(goal.y).toBeLessThan(kickerScreenY);
    // ゴールが画面内に十分な余裕を持って収まること。
    expect(goal.y).toBeLessThan(VIEWPORT_HEIGHT);
  });
});
