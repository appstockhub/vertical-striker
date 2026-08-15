import { describe, expect, it } from 'vitest';
import {
  gamepadToButtonState,
  gamepadToDirection8,
  gamepadToInputFrame,
  type RawPadLike,
} from '../../src/input/gamepadMapping';
import { Direction8, LogicalButton, emptyButtonState } from '../../src/input/types';

function makePad(pressedIndices: number[], axes: [number, number] = [0, 0]): RawPadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressedIndices.includes(i) }));
  return { buttons, axes };
}

describe('gamepadToButtonState', () => {
  it('maps SFC-positional buttons to Xbox standard indices', () => {
    // Xbox A (index 0) -> logical B (下)
    expect(gamepadToButtonState(makePad([0]))[LogicalButton.B]).toBe(true);
    // Xbox B (index 1) -> logical A (右)
    expect(gamepadToButtonState(makePad([1]))[LogicalButton.A]).toBe(true);
    // Xbox X (index 2) -> logical Y (左)
    expect(gamepadToButtonState(makePad([2]))[LogicalButton.Y]).toBe(true);
    // Xbox Y (index 3) -> logical X (上, 推測マッピング)
    expect(gamepadToButtonState(makePad([3]))[LogicalButton.X]).toBe(true);
    // LB/RB -> L/R
    expect(gamepadToButtonState(makePad([4]))[LogicalButton.L]).toBe(true);
    expect(gamepadToButtonState(makePad([5]))[LogicalButton.R]).toBe(true);
    // Start (W3C Standard Gamepad index 9、続編仕様④ライン操作)
    expect(gamepadToButtonState(makePad([9]))[LogicalButton.Start]).toBe(true);
  });

  it('returns all-false when nothing is pressed', () => {
    expect(gamepadToButtonState(makePad([]))).toEqual(emptyButtonState());
  });
});

describe('gamepadToDirection8', () => {
  it('prefers the d-pad over the analog stick', () => {
    const pad = makePad([12], [1, 1]); // d-pad up + stick pointing elsewhere
    expect(gamepadToDirection8(pad)).toBe(Direction8.Up);
  });

  it('reads all 4 cardinal d-pad directions', () => {
    expect(gamepadToDirection8(makePad([12]))).toBe(Direction8.Up);
    expect(gamepadToDirection8(makePad([13]))).toBe(Direction8.Down);
    expect(gamepadToDirection8(makePad([14]))).toBe(Direction8.Left);
    expect(gamepadToDirection8(makePad([15]))).toBe(Direction8.Right);
  });

  it('reads diagonal d-pad combinations', () => {
    expect(gamepadToDirection8(makePad([12, 15]))).toBe(Direction8.UpRight);
    expect(gamepadToDirection8(makePad([13, 14]))).toBe(Direction8.DownLeft);
  });

  it('discretizes the analog stick into 8 directions', () => {
    expect(gamepadToDirection8(makePad([], [0, -1]))).toBe(Direction8.Up);
    expect(gamepadToDirection8(makePad([], [1, 0]))).toBe(Direction8.Right);
    expect(gamepadToDirection8(makePad([], [1, 1]))).toBe(Direction8.DownRight);
  });

  it('ignores stick movement inside the deadzone', () => {
    expect(gamepadToDirection8(makePad([], [0.1, 0.1]))).toBe(Direction8.None);
  });

  it('returns None when nothing is pressed', () => {
    expect(gamepadToDirection8(makePad([]))).toBe(Direction8.None);
  });
});

describe('gamepadToInputFrame', () => {
  it('computes rising-edge buttonsPressed relative to previous frame', () => {
    const prev = emptyButtonState();
    const frame1 = gamepadToInputFrame(makePad([0]), prev);
    expect(frame1.buttons[LogicalButton.B]).toBe(true);
    expect(frame1.buttonsPressed[LogicalButton.B]).toBe(true);

    const frame2 = gamepadToInputFrame(makePad([0]), frame1.buttons);
    expect(frame2.buttons[LogicalButton.B]).toBe(true);
    expect(frame2.buttonsPressed[LogicalButton.B]).toBe(false); // held, not a new press
  });
});
