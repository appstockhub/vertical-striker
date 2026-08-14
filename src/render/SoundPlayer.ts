import Phaser from 'phaser';
import { SoundEventId } from './soundEvents';

/**
 * SoundEventId -> Phaserのサウンドキー名の対応表。実アセットは未調達のため、
 * これらのキーは現時点でどれもロードされていない (計画セクションH、CC0/自作素材の
 * 調達はスコープ外)。BootScene等で対応するキーの音声がロードされ次第、鳴るようになる。
 */
const SOUND_KEYS: Readonly<Record<SoundEventId, string>> = {
  [SoundEventId.Kick]: 'sfx-kick',
  [SoundEventId.Goal]: 'sfx-goal',
  [SoundEventId.HalfTimeWhistle]: 'sfx-whistle-long',
  [SoundEventId.FullTimeWhistle]: 'sfx-whistle-long',
  [SoundEventId.RestartWhistle]: 'sfx-whistle-short',
  [SoundEventId.GkCatch]: 'sfx-catch',
};

/**
 * detectSoundEvents() が返したイベントをPhaserのSoundManagerへ橋渡しする薄いラッパー。
 * キーに対応する音声がロードされていなければ黙って何もしない (アセットが無い間は
 * 完全に無音のまま安全に動く、既存のsim/描画パイプラインを一切ブロックしない)。
 */
export class SoundPlayer {
  constructor(private readonly scene: Phaser.Scene) {}

  play(eventId: SoundEventId): void {
    const key = SOUND_KEYS[eventId];
    if (!key || !this.scene.cache.audio.exists(key)) return;
    this.scene.sound.play(key);
  }

  playAll(eventIds: readonly SoundEventId[]): void {
    for (const eventId of eventIds) this.play(eventId);
  }
}
