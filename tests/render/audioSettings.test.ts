import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUDIO_SETTINGS,
  normalizeAudioSettings,
  toggleBgm,
  toggleSfx,
} from '../../src/render/audioSettings';

/**
 * BGM/効果音の個別 ON・OFF (23周目)。
 * 保存値の正規化は「壊れた localStorage で起動不能にならない」ための防壁なので、
 * 想定外の入力を明示的に並べて検証する。
 */
describe('音の設定', () => {
  it('既定は両方ON', () => {
    expect(DEFAULT_AUDIO_SETTINGS).toEqual({ bgm: true, sfx: true });
  });

  it('BGMと効果音を独立に切り替えられる (片方を切っても他方は残る)', () => {
    const bgmOff = toggleBgm(DEFAULT_AUDIO_SETTINGS);
    expect(bgmOff).toEqual({ bgm: false, sfx: true });
    const bothOff = toggleSfx(bgmOff);
    expect(bothOff).toEqual({ bgm: false, sfx: false });
    expect(toggleBgm(bothOff)).toEqual({ bgm: true, sfx: false });
  });

  it('保存された正常な値をそのまま復元する', () => {
    expect(normalizeAudioSettings({ bgm: false, sfx: true })).toEqual({ bgm: false, sfx: true });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['文字列', 'bgm'],
    ['数値', 42],
    ['配列', []],
    ['空オブジェクト', {}],
    ['型違いの値', { bgm: 'yes', sfx: 0 }],
  ])('壊れた保存値 (%s) は既定へフォールバックする', (_label, value) => {
    expect(normalizeAudioSettings(value)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('片方だけ欠けている場合、欠けた側だけ既定になる', () => {
    expect(normalizeAudioSettings({ bgm: false })).toEqual({ bgm: false, sfx: true });
    expect(normalizeAudioSettings({ sfx: false })).toEqual({ bgm: true, sfx: false });
  });
});
