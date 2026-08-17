/**
 * BGM / 効果音の ON・OFF 設定 (23周目)。
 *
 * それ以前は M キーで**両方まとめて**ミュートする1本のトグルしか無く、
 * 「BGMは邪魔だが効果音は欲しい」「音を出せない場所でBGMだけ切りたい」に応えられなかった。
 *
 * 設定は localStorage に保存する。ゲームの状態 (`GameState`) には**入れない**:
 * sim は決定論とリプレイの前提を持っており、音の設定は試合結果に影響しない純粋な
 * クライアント設定なので、混ぜるとリプレイの互換性を無意味に壊す。
 */

export interface AudioSettings {
  readonly bgm: boolean;
  readonly sfx: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { bgm: true, sfx: true };

const STORAGE_KEY = 'vs.audio';

/** localStorage が使えない環境 (プライベートモード等) でも落ちないよう、全てtry/catchで包む。 */
export function loadAudioSettings(): AudioSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AUDIO_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    return normalizeAudioSettings(parsed);
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
}

export function saveAudioSettings(settings: AudioSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 保存できなくても遊べることを優先する (設定はそのセッション限りになる)。
  }
}

/**
 * 保存値・外部入力を安全な形へ正規化する純関数 (node のテストから直接検証できる)。
 * 壊れた値や欠けた値は既定 (ON) にフォールバックする。
 */
export function normalizeAudioSettings(value: unknown): AudioSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_AUDIO_SETTINGS;
  const record = value as Record<string, unknown>;
  return {
    bgm: typeof record['bgm'] === 'boolean' ? record['bgm'] : DEFAULT_AUDIO_SETTINGS.bgm,
    sfx: typeof record['sfx'] === 'boolean' ? record['sfx'] : DEFAULT_AUDIO_SETTINGS.sfx,
  };
}

export function toggleBgm(settings: AudioSettings): AudioSettings {
  return { ...settings, bgm: !settings.bgm };
}

export function toggleSfx(settings: AudioSettings): AudioSettings {
  return { ...settings, sfx: !settings.sfx };
}
