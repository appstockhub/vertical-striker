import { describe, expect, it } from 'vitest';
import { KeyboardSource } from '../../src/input/keyboard';
import { mergeInputFrames } from '../../src/input/inputManager';
import { FixedTimestepLoop } from '../../src/core/loop';
import { Direction8, emptyButtonState, emptyInputFrame, type ButtonState, type InputFrame } from '../../src/input/types';

/**
 * ★入力統合層のテスト (14周目で新設)★
 *
 * 存在理由: 13周目まで、テストは sim/ (純関数) にしか存在せず、
 * 「実際のキーボードイベント → KeyboardSource → InputManager → FixedTimestepLoop → sim」
 * という実プレイの信号経路は**一度もテストされていなかった**。simのテストが392件緑でも
 * 実プレイで「ボタンが反応しない」が起こり得たのはこの穴のせい。
 * ここでは本物のイベントディスパッチとフレームレート違いのループ回しを再現して、
 * 「押した入力が必ずsimまで届く」ことを保証する。
 */

/** window の addEventListener/dispatch を再現する最小のフェイク (jsdom不要)。 */
class FakeWindow {
  private listeners = new Map<string, Set<(e: unknown) => void>>();

  addEventListener(type: string, fn: (e: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  dispatch(type: 'keydown' | 'keyup', code: string): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ code, preventDefault: () => {} });
    }
  }
}

function keyboardWith(fakeWin: FakeWindow): KeyboardSource {
  return new KeyboardSource(fakeWin as unknown as Window);
}

describe('KeyboardSource: 実際のkeydown/keyupイベントが論理ボタンに変換される', () => {
  it.each([
    ['KeyZ', 'B'],
    ['KeyX', 'A'],
    ['KeyC', 'Y'],
    ['KeyV', 'X'],
    ['KeyQ', 'L'],
    ['KeyE', 'R'],
    ['ShiftLeft', 'Start'],
  ] as const)('%s → 論理ボタン %s', (code, logical) => {
    const win = new FakeWindow();
    const kb = keyboardWith(win);
    win.dispatch('keydown', code);
    expect(kb.sample().buttons[logical]).toBe(true);
    win.dispatch('keyup', code);
    expect(kb.sample().buttons[logical]).toBe(false);
  });

  it('矢印キーとWASDの両方で8方向が出る (斜め含む)', () => {
    const win = new FakeWindow();
    const kb = keyboardWith(win);
    win.dispatch('keydown', 'ArrowUp');
    expect(kb.sample().direction).toBe(Direction8.Up);
    win.dispatch('keydown', 'ArrowRight');
    expect(kb.sample().direction).toBe(Direction8.UpRight);
    win.dispatch('keyup', 'ArrowUp');
    win.dispatch('keyup', 'ArrowRight');

    win.dispatch('keydown', 'KeyW');
    win.dispatch('keydown', 'KeyD');
    expect(kb.sample().direction).toBe(Direction8.UpRight);
  });

  it('★実プレイの中核操作★ 移動キーを押したままキックキーを押す/離す、が正しく併存する', () => {
    const win = new FakeWindow();
    const kb = keyboardWith(win);
    win.dispatch('keydown', 'ArrowUp');
    win.dispatch('keydown', 'KeyZ'); // 移動しながらB
    let f = kb.sample();
    expect(f.direction).toBe(Direction8.Up);
    expect(f.buttons.B).toBe(true);
    win.dispatch('keyup', 'KeyZ'); // Bだけ離す (キック発動のリリース)
    f = kb.sample();
    expect(f.direction).toBe(Direction8.Up);
    expect(f.buttons.B).toBe(false);
  });
});

describe('mergeInputFrames: パッドとキーボードの合成 (旧: 切替式の穴の回帰テスト)', () => {
  const frame = (over: Partial<InputFrame>): InputFrame => ({ ...emptyInputFrame(), ...over });
  const btn = (over: Partial<Record<string, boolean>>): ButtonState =>
    ({ ...emptyButtonState(), ...over }) as ButtonState;

  it('パッドが無入力ならキーボードがそのまま通る', () => {
    const kbF = frame({ direction: Direction8.Up, buttons: btn({ B: true }) });
    const merged = mergeInputFrames(emptyInputFrame(), kbF);
    expect(merged.direction).toBe(Direction8.Up);
    expect(merged.buttons.B).toBe(true);
  });

  it('★旧実装のバグの回帰★ パッドの方向入力(ドリフト等)があってもキーボードのボタンは失われない', () => {
    // 旧実装: パッドに何か入力があるとキーボード入力を丸ごと破棄していた。
    // パッドを繋いだままキーボードで遊ぶと「ボタンを押しても反応しない」の一因になる。
    const pad = frame({ direction: Direction8.Left });
    const kbF = frame({ buttons: btn({ B: true }) });
    const merged = mergeInputFrames(pad, kbF);
    expect(merged.buttons.B).toBe(true); // 旧実装ではfalseになっていた
    expect(merged.direction).toBe(Direction8.Left); // 方向は入力がある方
  });

  it('両デバイスのボタンはORで合成される', () => {
    const pad = frame({ buttons: btn({ L: true }) });
    const kbF = frame({ buttons: btn({ B: true }) });
    const merged = mergeInputFrames(pad, kbF);
    expect(merged.buttons.L).toBe(true);
    expect(merged.buttons.B).toBe(true);
  });
});

describe('FixedTimestepLoop: フレームレートが違っても入力エッジがsimに届く (PitchSceneの配線を再現)', () => {
  /**
   * PitchScene.update() と同じ配線:
   *   毎実フレーム: cached = sample(); loop.tick(delta)
   *   fixedUpdate: prevButtons と cached を比較して edge を検出 (simと同じ方式)
   * を、リフレッシュレート別のdelta列で回し、タップ(押して離す)が必ず1回のキックとして
   * 検出されることを確認する。
   */
  function runTapScenario(fps: number, tapStartFrame: number, tapFrames: number) {
    const deltaMs = 1000 / fps;
    let cached: { b: boolean } = { b: false };
    let prevB = false;
    let charge = 0;
    let releases = 0;
    const loop = new FixedTimestepLoop({
      onFixedUpdate: () => {
        if (cached.b) charge += 1;
        else if (charge > 0) {
          releases += 1; // 溜めあり→非押下 = キック解放 (updateKickChargeと同じ論理)
          charge = 0;
        }
        prevB = cached.b;
      },
    });
    const totalFrames = Math.ceil(fps); // 1秒ぶん
    for (let f = 0; f < totalFrames; f++) {
      cached = { b: f >= tapStartFrame && f < tapStartFrame + tapFrames };
      loop.tick(deltaMs);
    }
    void prevB;
    return { releases };
  }

  it('60Hz: 3フレーム(50ms)のタップでキックが1回だけ出る', () => {
    expect(runTapScenario(60, 10, 3).releases).toBe(1);
  });

  it('120Hz: 4フレーム(33ms)のタップでもキックが1回出る (高リフレッシュレート環境)', () => {
    expect(runTapScenario(120, 10, 4).releases).toBe(1);
  });

  it('144Hz: 5フレーム(35ms)のタップでもキックが1回出る', () => {
    expect(runTapScenario(144, 10, 5).releases).toBe(1);
  });

  it('30Hz(低速マシン、1フレーム2ステップ): タップでキックが1回だけ出る (二重発火しない)', () => {
    expect(runTapScenario(30, 5, 2).releases).toBe(1);
  });
});
