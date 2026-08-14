import { describe, expect, it } from 'vitest';
import { FixedTimestepLoop } from '../../src/core/loop';

describe('FixedTimestepLoop', () => {
  it('calls onFixedUpdate exactly once per ~16.67ms of accumulated time', () => {
    let calls = 0;
    const loop = new FixedTimestepLoop({ onFixedUpdate: () => calls++ });

    loop.tick(1000 / 60);
    expect(calls).toBe(1);

    loop.tick(1000 / 60);
    expect(calls).toBe(2);
  });

  it('accumulates partial deltas across multiple ticks', () => {
    let calls = 0;
    const loop = new FixedTimestepLoop({ onFixedUpdate: () => calls++ });

    loop.tick(5);
    loop.tick(5);
    expect(calls).toBe(0); // 10ms < 16.67ms 分はまだ足りない

    loop.tick(10);
    expect(calls).toBe(1); // 20ms >= 16.67ms
  });

  it('runs multiple steps when a large delta arrives, up to maxStepsPerFrame', () => {
    let calls = 0;
    const loop = new FixedTimestepLoop({
      onFixedUpdate: () => calls++,
      maxStepsPerFrame: 3,
    });

    loop.tick(1000); // would be ~60 steps uncapped
    expect(calls).toBe(3);
  });

  it('exposes alpha as accumulator progress toward next step', () => {
    const loop = new FixedTimestepLoop({ onFixedUpdate: () => {}, stepMs: 10 });
    loop.tick(4);
    expect(loop.alpha).toBeCloseTo(0.4, 5);
  });
});
