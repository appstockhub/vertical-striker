import { describe, expect, it } from 'vitest';
import { toFixed, toFloat, ZERO_FIXED } from '../../src/core/fixed';
import { Direction8, emptyButtonState, type ButtonState } from '../../src/input/types';
import { createInitialState, TeamId, type GameState } from '../../src/sim/state';
import { simulate } from '../../src/sim/update';
import { findTouchPriorityPlayer } from '../../src/sim/ballTouch';
import {
  HIGH_ARC_SPEED_MULTIPLIER_FIXED,
  KICK_MAX_CHARGE_FRAMES,
  KICK_WINDUP_TICKS,
  STRONG_KICK_SPEED_FIXED,
  WEAK_KICK_SPEED_FIXED,
} from '../../src/sim/ballConstants';
import { runTicks } from '../../src/sim/tempo';

// テンポ変更 (24周目サイクル①) 追従: 「キック/パスが出た」のしきい値を裸の数字ではなく
// キック速度定数からの相対値にする。ドリブルタッチ(0.63)や追従(最大0.88)とは明確に
// 区別できる高さに置くこと (誤検出防止)。
const KICK_FIRED = toFloat(STRONG_KICK_SPEED_FIXED) * 0.8;
const WEAK_FIRED = toFloat(WEAK_KICK_SPEED_FIXED) * 0.85;
// 最大溜めの強キックは HIGH_ARC_SPEED_MULTIPLIER (0.7) 倍まで水平速度が落ちる仕様。
const CHARGED_FIRED =
  toFloat(STRONG_KICK_SPEED_FIXED) * toFloat(HIGH_ARC_SPEED_MULTIPLIER_FIXED) * 0.9;

/**
 * ★段階2: ボール保持時の全操作の棚卸しプローブ★
 *
 * 目的は「主観に頼らず機械的に判定できること」を全部ここで潰すこと:
 *   - 実装したはずなのに発動しない操作
 *   - 入力が無視される / 暴発する / 二重発火する
 *   - 入力から結果発生までの遅延 (tick数)
 *   - 押下時間や方向による変化が、実際に有意な差として出ているか
 *
 * `npm run ops:probe` で人間可読の棚卸し表を出す。数値が変わったら必ず表を読み直すこと。
 * 12周目に実装した続編仕様①〜⑥はいずれも実プレイ確認を経ていないため、ここが唯一の裏付け。
 */

function btn(held: Partial<Record<keyof ButtonState, boolean>>): ButtonState {
  return { ...emptyButtonState(), ...held } as ButtonState;
}
function inp(direction: Direction8, held: Partial<Record<keyof ButtonState, boolean>> = {}) {
  return { direction, buttons: btn(held) };
}
function speed(s: GameState): number {
  return Math.hypot(toFloat(s.ball.vel.x), toFloat(s.ball.vel.y));
}
function ballPos(s: GameState): { x: number; y: number } {
  return { x: toFloat(s.ball.pos.x), y: toFloat(s.ball.pos.y) };
}
function hasBall(s: GameState): boolean {
  return findTouchPriorityPlayer(s.players, s.ball.pos, s.lastTouchPlayerIndex) === s.controlledPlayerIndex;
}

const CARRIER = TeamId.A * 11 + 9;

/**
 * 人間(Team A)が中盤でボールを足元に持ち、他の22人は遠くへ退避した状態。
 * 「人間の操作 vs ゲームの応答」だけを見るための無菌室。half=1 で Team A は北(y=0)へ攻める。
 */
function carrying(opts: { facing?: Direction8; receiverAt?: { x: number; y: number } } = {}): GameState {
  const base = createInitialState(1, { difficulty: 'easy', offsideEnabled: false });
  const pos = { x: toFixed(240), y: toFixed(1000) };
  const receiverIndex = TeamId.A * 11 + 7;
  return {
    ...base,
    controlledPlayerIndex: CARRIER,
    ball: { ...base.ball, pos, vel: { x: ZERO_FIXED, y: ZERO_FIXED }, height: ZERO_FIXED, zVel: ZERO_FIXED },
    players: base.players.map((p, i) => {
      if (i === CARRIER) return { ...p, pos, facing: opts.facing ?? Direction8.Up };
      if (opts.receiverAt && i === receiverIndex) {
        return { ...p, pos: { x: toFixed(opts.receiverAt.x), y: toFixed(opts.receiverAt.y) } };
      }
      return { ...p, pos: { x: toFixed(20 + (i % 5) * 30), y: toFixed(i < 11 ? 1750 : 100) } };
    }),
    lastTouchTeam: TeamId.A,
    lastTouchPlayerIndex: CARRIER,
  };
}

/** 一定入力を n tick 流す。 */
function run(s: GameState, n: number, i: ReturnType<typeof inp>): GameState {
  let cur = s;
  for (let k = 0; k < n; k++) cur = simulate(cur, i);
  return cur;
}

/**
 * チャージキックを「発射されたちょうどそのtick」の状態で返す。
 *
 * ワインドアップ追従 (不具合#4、24周目サイクル③): B解放は即時発射ではなく、
 * KICK_WINDUP_TICKS 後に発射される。速度/zVelは発射tickで測る。
 * 待ち中は方向を入れない (待ち中の+字はカーブとして発射キックに掛かる仕様のため、
 * 「キック方向そのもの」の計測を汚さない)。
 *
 * 注意: ボールが足元にある間はドリブルタッチでも速度が出るため、「速度がしきい値を超えた
 * 最初のtick」で測ると溜め中のドリブルを誤検出する。発射tickを明示的に指定して測ること。
 */
function chargeKick(
  s: GameState,
  hold: number,
  aim: Direction8,
  extra: Partial<Record<keyof ButtonState, boolean>> = {},
): { state: GameState; speed: number; zVel: number } {
  let cur = s;
  for (let k = 0; k < hold; k++) cur = simulate(cur, inp(aim, { ...extra, B: true }));
  cur = simulate(cur, inp(aim, extra)); // Bを離す = ワインドアップ開始
  for (let k = 0; k < KICK_WINDUP_TICKS; k++) cur = simulate(cur, inp(Direction8.None, extra));
  return { state: cur, speed: speed(cur), zVel: toFloat(cur.ball.zVel) };
}

/** ボールが到達した最大の高さ (弾道の頂点)。 */
function maxHeight(s: GameState, n = 90, i = inp(Direction8.None)): number {
  let cur = s;
  let h = 0;
  for (let k = 0; k < n; k++) {
    cur = simulate(cur, i);
    h = Math.max(h, toFloat(cur.ball.height));
  }
  return h;
}

/** 直進からの横ずれ量 (カーブの検出)。キック直後の進行方向に対する垂直成分の累積。 */
function lateralDrift(s: GameState, n = 60, i = inp(Direction8.None)): number {
  const start = ballPos(s);
  let cur = s;
  // 最初の1tickの進行方向を基準軸にする。
  cur = simulate(cur, i);
  const p1 = ballPos(cur);
  const ax = p1.x - start.x;
  const ay = p1.y - start.y;
  const len = Math.hypot(ax, ay) || 1;
  const ux = ax / len;
  const uy = ay / len;
  let drift = 0;
  for (let k = 1; k < n; k++) {
    cur = simulate(cur, i);
    const p = ballPos(cur);
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    drift = dx * -uy + dy * ux; // 垂直成分 (符号付き)
  }
  return drift;
}

const rows: string[] = [];
function report(op: string, fired: boolean, detail: string): void {
  rows.push(`  ${fired ? '✅' : '❌'} ${op.padEnd(30)} ${detail}`);
}

describe('段階2: ボール保持時の操作プローブ', () => {
  it('D1. 8方向ドリブル: 入力方向へボールが動く', () => {
    const dirs: Array<[Direction8, number, number]> = [
      [Direction8.Up, 0, -1],
      [Direction8.UpRight, 1, -1],
      [Direction8.Right, 1, 0],
      [Direction8.DownRight, 1, 1],
      [Direction8.Down, 0, 1],
      [Direction8.DownLeft, -1, 1],
      [Direction8.Left, -1, 0],
      [Direction8.UpLeft, -1, -1],
    ];
    let ok = 0;
    for (const [d, sx, sy] of dirs) {
      const s0 = carrying({ facing: d });
      const s1 = run(s0, 30, inp(d));
      const p0 = ballPos(s0);
      const p1 = ballPos(s1);
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const okX = sx === 0 ? Math.abs(dx) < 12 : Math.sign(dx) === sx && Math.abs(dx) > 10;
      const okY = sy === 0 ? Math.abs(dy) < 12 : Math.sign(dy) === sy && Math.abs(dy) > 10;
      if (okX && okY) ok++;
    }
    report('8方向ドリブル', ok === 8, `${ok}/8 方向が正しく動く`);
    expect(ok).toBe(8);
  });

  it('D2. 蹴り出しドリブル (L+R): ボールが足元から前へ離れ、速くなる', () => {
    // テンポ変更追従: 蹴り出しサイクルの収束が遅くなったため、観測窓を同じ移動距離ぶん
    // (40tick→runTicks(40)=229tick) に延長 (実測: 前進123px/176px、足元距離3.4px/8.2px)。
    const N = runTicks(40);
    const normal = run(carrying(), N, inp(Direction8.Up));
    const kickDribble = run(carrying(), N, inp(Direction8.Up, { L: true, R: true }));
    const normalDist = Math.abs(ballPos(normal).y - 1000);
    const kickDist = Math.abs(ballPos(kickDribble).y - 1000);
    const gapNormal = Math.hypot(
      toFloat(normal.players[CARRIER]!.pos.x) - ballPos(normal).x,
      toFloat(normal.players[CARRIER]!.pos.y) - ballPos(normal).y,
    );
    const gapKick = Math.hypot(
      toFloat(kickDribble.players[CARRIER]!.pos.x) - ballPos(kickDribble).x,
      toFloat(kickDribble.players[CARRIER]!.pos.y) - ballPos(kickDribble).y,
    );
    const fired = kickDist > normalDist * 1.05 && gapKick > gapNormal;
    report(
      '蹴り出しドリブル(L+R)',
      fired,
      `${N}tickの前進 通常${normalDist.toFixed(0)}px / 蹴出${kickDist.toFixed(0)}px、足元との距離 ${gapNormal.toFixed(0)}→${gapKick.toFixed(0)}px`,
    );
    expect(kickDist).toBeGreaterThan(normalDist);
    expect(gapKick).toBeGreaterThan(gapNormal);
  });

  it('K1. B 溜め: 押下時間で強さと弾道が有意に変わる', () => {
    const short = chargeKick(carrying(), 2, Direction8.Up);
    const long = chargeKick(carrying(), KICK_MAX_CHARGE_FRAMES, Direction8.Up);
    const shortH = maxHeight(short.state);
    const longH = maxHeight(long.state);
    // 3D の総合的な「蹴りの強さ」= 水平速度と垂直初速の合成。
    const power = (r: { speed: number; zVel: number }) => Math.hypot(r.speed, r.zVel);
    report('B 短押し(2f)', short.speed > KICK_FIRED, `解放+${KICK_WINDUP_TICKS}tickの発射tickで発動 水平${short.speed.toFixed(2)} zVel${short.zVel.toFixed(2)} 最高到達${shortH.toFixed(1)}px 総合${power(short).toFixed(2)}`);
    report('B 長押し(最大)', long.speed > CHARGED_FIRED, `解放+${KICK_WINDUP_TICKS}tickの発射tickで発動 水平${long.speed.toFixed(2)} zVel${long.zVel.toFixed(2)} 最高到達${longH.toFixed(1)}px 総合${power(long).toFixed(2)}`);
    expect(short.speed).toBeGreaterThan(KICK_FIRED);
    expect(long.speed).toBeGreaterThan(CHARGED_FIRED);
    // 弾道は有意に変わること (溜めの意味がある) — ここはゲート。
    expect(longH).toBeGreaterThan(shortH + 10);

    // ★[report-only] CLAUDE.md 続編仕様「基本的に押す長さがそのままボールの強さになる」★
    // 現状は総合パワーが溜めで**下がる**。仕様とは逆だが、直す (HIGH_ARC_SPEED_MULTIPLIER
    // を上げる) と観戦シミュレーターの正常性基準が3件落ちる = AIバランスの再調整と不可分。
    // 段階2 (操作感) のスコープ外とし、段階4で扱う。ゲート化はその時に行う。
    if (power(long) <= power(short)) {
      report(
        '[要判断] 溜めと蹴りの強さ',
        false,
        `総合パワー 短${power(short).toFixed(2)} → 長${power(long).toFixed(2)} (仕様は「長いほど強い」。段階4で調整)`,
      );
    }
  });

  it('K2. B 方向なし = 弱いキック / 方向あり = 強いキック', () => {
    const withDir = chargeKick(carrying(), 2, Direction8.Up);
    const noDir = chargeKick(carrying(), 2, Direction8.None);
    report('B 方向なし(弱)', noDir.speed > WEAK_FIRED, `水平${noDir.speed.toFixed(2)}（方向ありは${withDir.speed.toFixed(2)}）`);
    expect(noDir.speed).toBeGreaterThan(WEAK_FIRED);
    expect(withDir.speed).toBeGreaterThan(noDir.speed);
  });

  it('K3. A = 進行方向へのグラウンダーパス (押した次のtickで出る)', () => {
    const s0 = carrying();
    const s1 = simulate(s0, inp(Direction8.Up, { A: true }));
    const fired = speed(s1) > KICK_FIRED;
    report('A 進行方向パス', fired, `1tickで発動 速度${speed(s1).toFixed(2)} zVel${toFloat(s1.ball.zVel).toFixed(2)}`);
    expect(fired).toBe(true);
    expect(toFloat(s1.ball.zVel)).toBeLessThan(1); // グラウンダー
  });

  it('K4. X = ロングフィード (高い弾道)', () => {
    const s0 = carrying();
    const s1 = simulate(s0, inp(Direction8.Up, { X: true }));
    const h = maxHeight(s1);
    // 高い弾道ぶん水平速度は落ちる (HIGH_ARC_SPEED_MULTIPLIER) ので弱キック基準で見る。
    // 弾道の高さ(px)は空間量なのでテンポ変更の影響を受けない (8pxのまま)。
    const fired = speed(s1) > WEAK_FIRED && h > 8;
    report('X ロングフィード', fired, `1tickで発動 速度${speed(s1).toFixed(2)} zVel${toFloat(s1.ball.zVel).toFixed(2)} 最高到達${h.toFixed(1)}px`);
    expect(fired).toBe(true);
    expect(h).toBeGreaterThan(8);
  });

  it('K5. Y = パスカーソル先の味方へパス', () => {
    // 前方(y小さい方)に受け手を置く。カーソルパスは前方コーン内の味方を選ぶ。
    const s0 = carrying({ receiverAt: { x: 260, y: 860 } });
    let cur = s0;
    let fired = false;
    let t = 0;
    for (let k = 0; k < 6; k++) {
      cur = simulate(cur, inp(Direction8.Up, { Y: true }));
      t++;
      if (speed(cur) > WEAK_FIRED) {
        fired = true;
        break;
      }
    }
    const dirOk = fired && toFloat(cur.ball.vel.y) < 0;
    report('Y カーソルパス', fired, fired ? `${t}tickで発動 速度${speed(cur).toFixed(2)} 受け手方向:${dirOk ? 'OK' : 'NG'}` : '発動せず');
    expect(fired).toBe(true);
  });

  it('K6. シフトキック (L or R + B) がキック方向を45度ずらす', () => {
    const ang = (s: GameState) => Math.atan2(toFloat(s.ball.vel.x), -toFloat(s.ball.vel.y)) * (180 / Math.PI);
    const a0 = ang(chargeKick(carrying(), 2, Direction8.Up).state);
    const aR = ang(chargeKick(carrying(), 2, Direction8.Up, { R: true }).state);
    const aL = ang(chargeKick(carrying(), 2, Direction8.Up, { L: true }).state);
    const firedR = Math.abs(aR - a0) > 20;
    const firedL = Math.abs(aL - a0) > 20;
    report('シフトキック R', firedR, `キック角 ${a0.toFixed(0)}° → ${aR.toFixed(0)}°`);
    report('シフトキック L', firedL, `キック角 ${a0.toFixed(0)}° → ${aL.toFixed(0)}°`);
    expect(firedR && firedL).toBe(true);
  });

  it('K7. カーブ: キック直後に別方向を入れると横へ曲がる', () => {
    // 解放tickの直後(受付ウィンドウ内)に右を入れる。ticksToKick のように解放後に
    // 何tickも空ける測り方では、6tickの受付ウィンドウが閉じてしまい必ず0になる。
    // ★24周目サイクル①: カーブの死と再生の記録★
    // (1) テンポ換算後の加算加速度 0.0036px/tick² は固定小数点の量子化下限(1/256=0.0039)を
    //     割り、カーブが事実上死んだ (実測: 全飛程で横ずれ0.31px)。
    // (2) sim側を「速度ベクトルの微小回転」方式へ再設計して修正した (ballPhysics.ts /
    //     ballConstants.ts CURVE_ROTATION_STEP_FIXED 参照。合計曲げ角17.9°は旧設計と同水準)。
    // (3) しきい値の再導出: 旧8px(絶対量)は「摩擦0.985・飛程591px」時代の校正値。摩擦を
    //     原作実測0.968へ直した今、グラウンダーの飛程は82pxなので絶対8pxは飛程の10% =
    //     旧比5倍のフックを要求してしまう。**曲がりの正しい不変量は飛程に対する比**:
    //     旧 11px/591px≈1.9% → ゲートは2%とし、実測 3.3px/82px≈4.0% で合格。
    const kicked = chargeKick(carrying(), 2, Direction8.Up).state;
    const start = ballPos(kicked);
    const curved = lateralDrift(kicked, 200, inp(Direction8.Right));
    let cur = kicked;
    for (let k = 0; k < 200; k++) cur = simulate(cur, inp(Direction8.Right));
    const end = ballPos(cur);
    const flight = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    const ratio = Math.abs(curved) / flight;
    report('カーブ (別方向入力)', ratio > 0.02, `横ずれ ${curved.toFixed(1)}px / 飛程 ${flight.toFixed(0)}px = ${(ratio * 100).toFixed(1)}%`);
    expect(ratio).toBeGreaterThan(0.02);
  });

  it('K8. カーブの暴発: 照準方向を押しっぱなしにしても「曲がらない」', () => {
    // 実プレイで最も普通の操作 = 走りながら上を押したまま蹴り、そのまま上を押し続ける。
    // このとき受付ウィンドウが「まだ押されている照準方向」を拾ってカーブ扱いすると、
    // 曲がりはしないが進行方向へ加速し続ける = 意図しない飛距離ブーストになる。
    const kicked = chargeKick(carrying(), 2, Direction8.Up).state;
    const held = run(kicked, 8, inp(Direction8.Up));
    const released = run(chargeKick(carrying(), 2, Direction8.Up).state, 8, inp(Direction8.None));
    const boost = speed(held) - speed(released);
    report('カーブ 暴発 (照準を押しっぱなし)', boost < 0.5, `8tick後の速度差 ${boost.toFixed(2)} (0に近いのが正常)`);
    expect(boost).toBeLessThan(0.5);
  });

  it('K8. リフティング: 方向反転 + B でボールが浮き、保持を継続する', () => {
    const s0 = carrying({ facing: Direction8.Up });
    // 直前の向き(Up)と正反対のDownを入れながらBのedgeを立てる。
    const s1 = simulate(s0, inp(Direction8.Down, { B: true }));
    const z = toFloat(s1.ball.zVel);
    const h = maxHeight(s1, 40, inp(Direction8.Down));
    const fired = z > 0.5;
    report('リフティング', fired, `zVel ${z.toFixed(2)} 最高到達 ${h.toFixed(1)}px 保持継続:${hasBall(s1) ? 'OK' : 'NG'}`);
    expect(fired).toBe(true);
  });

  it('K9. START = オフェンスラインを下げる (保持中)', () => {
    const s0 = carrying();
    const before = toFloat(s0.manualLineOffset);
    const s1 = run(s0, 30, inp(Direction8.None, { Start: true }));
    const after = toFloat(s1.manualLineOffset);
    const fired = Math.abs(after - before) > 1;
    report('START ライン操作', fired, `manualLineOffset ${before.toFixed(1)} → ${after.toFixed(1)} (30tick押下)`);
    expect(fired).toBe(true);
  });

  it('K10. 二重発火チェック: 1回の入力で2回蹴っていない', () => {
    // A を1tickだけ押して離し、その後 20tick 無入力。速度が跳ね上がるのは1回だけのはず。
    let cur = carrying();
    const jumps: number[] = [];
    // 「蹴った」と分かる速度ジャンプ。キック速度が1/3.3になったため相対値で判定する
    // (ドリブルタッチのジャンプは最大0.63なので誤検出しない)。
    const JUMP = toFloat(WEAK_KICK_SPEED_FIXED) * 0.75;
    let prev = speed(cur);
    cur = simulate(cur, inp(Direction8.Up, { A: true }));
    if (speed(cur) - prev > JUMP) jumps.push(1);
    prev = speed(cur);
    for (let k = 0; k < 20; k++) {
      cur = simulate(cur, inp(Direction8.Up));
      if (speed(cur) - prev > JUMP) jumps.push(k + 2);
      prev = speed(cur);
    }
    report('二重発火 (A)', jumps.length === 1, `速度が跳ねた回数 ${jumps.length} (tick: ${jumps.join(',') || 'なし'})`);
    expect(jumps.length).toBe(1);
  });

  it('prints the inventory table', () => {
    console.log('\n=== ボール保持時の操作 棚卸し (実測) ===\n' + rows.join('\n') + '\n');
    expect(rows.length).toBeGreaterThan(0);
  });
});
