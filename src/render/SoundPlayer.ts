import { SoundEventId } from './soundEvents';

/**
 * 効果音を Web Audio API で**その場で合成**して鳴らす (15周目)。
 *
 * 音声ファイルを一切持たない理由:
 * - CLAUDE.md「名称・チーム名・選手名・グラフィック・音声は一切流用しない(完全オリジナル素材)」
 *   を最も確実に満たせる (外部素材のライセンス確認が不要、そもそも外部素材が無い)
 * - ボールのテクスチャ・選手スプライトを generateTexture で手続き的に作っている本プロジェクトの
 *   既存方針と一貫する
 * - リポジトリサイズが増えず、GitHub Pages の配信も軽いまま
 *
 * 旧実装は Phaser の SoundManager に「アセットが調達され次第鳴る」フックだけを置いており、
 * 実際には**一度も音が鳴ったことがなかった**。Phaser 依存を外して純粋な Web Audio にし、
 * 単体テスト可能なクラスにした。
 *
 * ブラウザの自動再生ポリシー対策: AudioContext はユーザー操作が無いと suspended のままなので、
 * 試合開始 (Enter/Space) などのキー入力を機に ensureStarted() を呼ぶこと。
 */

/** 全体音量 (うるさくならない控えめな値、要プレイテスト調整)。 */
const MASTER_GAIN = 0.32;

/** 同じ効果音が連射されるのを防ぐ最小間隔 (ms)。乱戦でキック音が機関銃になるのを避ける。 */
const MIN_INTERVAL_MS: Readonly<Record<SoundEventId, number>> = {
  [SoundEventId.Kick]: 45,
  [SoundEventId.Goal]: 800,
  [SoundEventId.HalfTimeWhistle]: 800,
  [SoundEventId.FullTimeWhistle]: 800,
  [SoundEventId.RestartWhistle]: 250,
  [SoundEventId.GkCatch]: 120,
  [SoundEventId.Slide]: 250,
  [SoundEventId.GkPunch]: 120,
};

type Ctx = AudioContext;

export class SoundPlayer {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly lastPlayedAt = new Map<SoundEventId, number>();
  private muted = false;

  /**
   * AudioContext を用意し、suspended なら resume する。
   * 自動再生ポリシーの都合上、必ず「ユーザー操作のイベントハンドラ内」から呼ぶこと。
   * 何度呼んでも安全 (冪等)。
   */
  ensureStarted(): void {
    if (typeof window === 'undefined') return;
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return; // Web Audio 非対応環境では単に無音のまま動く

    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = MASTER_GAIN;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : MASTER_GAIN;
  }

  isMuted(): boolean {
    return this.muted;
  }

  play(eventId: SoundEventId): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.muted || ctx.state !== 'running') return;

    const nowMs = ctx.currentTime * 1000;
    const last = this.lastPlayedAt.get(eventId);
    if (last !== undefined && nowMs - last < MIN_INTERVAL_MS[eventId]) return;
    this.lastPlayedAt.set(eventId, nowMs);

    switch (eventId) {
      case SoundEventId.Kick:
        this.kick(ctx, master);
        break;
      case SoundEventId.GkCatch:
        this.catchThud(ctx, master);
        break;
      case SoundEventId.GkPunch:
        // パンチはキャッチより硬い打撃音として、キック音を流用する (台帳L-05:
        // キャッチ(こもったthud)と弾き(鋭い打撃)の聴覚的区別が目的で、専用音源は不要)。
        this.kick(ctx, master);
        break;
      case SoundEventId.RestartWhistle:
        this.whistle(ctx, master, 0.16);
        break;
      case SoundEventId.HalfTimeWhistle:
      case SoundEventId.FullTimeWhistle:
        this.whistle(ctx, master, 0.75);
        break;
      case SoundEventId.Goal:
        this.goal(ctx, master);
        break;
      case SoundEventId.Slide:
        this.slide(ctx, master);
        break;
    }
  }

  playAll(eventIds: readonly SoundEventId[]): void {
    for (const eventId of eventIds) this.play(eventId);
  }

  // ---- 以下、各音の合成 ----------------------------------------------------

  /** ホワイトノイズ1秒ぶんのバッファ (打撃音・歓声の素材として使い回す)。 */
  private createNoiseBuffer(ctx: Ctx): AudioBuffer {
    const length = Math.floor(ctx.sampleRate);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // 見た目の乱数と違い音の質感なので Math.random で問題ない (sim/ の決定論とは無関係)。
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** ノイズを一発鳴らす (フィルタ付き)。 */
  private burst(
    ctx: Ctx,
    out: AudioNode,
    opts: { duration: number; gain: number; type: BiquadFilterType; freq: number; q?: number; attack?: number },
  ): void {
    if (!this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type;
    filter.frequency.value = opts.freq;
    if (opts.q !== undefined) filter.Q.value = opts.q;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    const attack = opts.attack ?? 0.003;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(opts.gain, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration);
    src.connect(filter).connect(gain).connect(out);
    src.start(t);
    src.stop(t + opts.duration + 0.02);
  }

  /** 単音を鳴らす (周波数を f0 → f1 へスイープ可能)。 */
  private tone(
    ctx: Ctx,
    out: AudioNode,
    opts: { type: OscillatorType; f0: number; f1?: number; duration: number; gain: number; delay?: number },
  ): void {
    const t = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(opts.f1, t + opts.duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(opts.gain, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + opts.duration + 0.02);
  }

  /** キック: 低音の「ドッ」+ 高域の打撃ノイズ。 */
  private kick(ctx: Ctx, out: AudioNode): void {
    this.tone(ctx, out, { type: 'sine', f0: 240, f1: 65, duration: 0.11, gain: 0.5 });
    this.burst(ctx, out, { duration: 0.05, gain: 0.22, type: 'bandpass', freq: 1500, q: 0.8 });
  }

  /** GKキャッチ: 手に収まる鈍い音 (キックより低く短い)。 */
  private catchThud(ctx: Ctx, out: AudioNode): void {
    this.tone(ctx, out, { type: 'sine', f0: 150, f1: 55, duration: 0.14, gain: 0.4 });
    this.burst(ctx, out, { duration: 0.07, gain: 0.14, type: 'lowpass', freq: 700 });
  }

  /** スライディング (不具合#5): 芝を滑る「シャーッ」というノイズのスウィッシュ。 */
  private slide(ctx: Ctx, out: AudioNode): void {
    this.burst(ctx, out, { duration: 0.28, gain: 0.2, type: 'bandpass', freq: 900, q: 0.6 });
    this.burst(ctx, out, { duration: 0.2, gain: 0.1, type: 'highpass', freq: 2400 });
  }

  /** 笛: 2つの近接した高音 + ゆらぎ (実際のホイッスルのビートを模す)。 */
  private whistle(ctx: Ctx, out: AudioNode, duration: number): void {
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    gain.gain.setValueAtTime(0.3, t + duration - 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    gain.connect(out);

    // わずかにずらした2音の唸りが「ピー」の芯を作る
    for (const freq of [2550, 2585]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      osc.connect(gain);
      osc.start(t);
      osc.stop(t + duration + 0.02);

      // 息のゆらぎ (ビブラート)
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 22;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 55;
      lfo.connect(lfoGain).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + duration + 0.02);
    }
    // 息のノイズ成分
    this.burst(ctx, out, { duration, gain: 0.05, type: 'bandpass', freq: 2600, q: 3, attack: 0.02 });
  }

  /**
   * 観客の歓声 (23周目に追加)。
   *
   * 旧実装のゴール音は 1.4秒のバンドパスノイズ1本だけで、「歓声」というより
   * 短いノイズのパフだった。本物の歓声は (a) 数秒かけて盛り上がって長く尾を引く
   * (b) 複数の帯域が重なる (c) 一定ではなく波打つ、の3点で成り立つので、
   * 帯域の違う3層 + ゆっくりしたLFOのうねりで作る。
   *
   * ※実録の観客音 (CC0) を差し替える計画があるが、Freesoundからの取得は
   *   アカウント作成が要るため未実施。候補は docs/asset-credits.md 参照。
   *   合成版はそれまでの繋ぎであり、差し替え時はこの関数を置き換えればよい。
   */
  private crowdRoar(ctx: Ctx, out: AudioNode, duration: number, peak: number): void {
    if (!this.noiseBuffer) return;
    const t = ctx.currentTime;
    // 低い「ゴォ」/ 中域の「ワァ」/ 高域の口笛混じり、の3層。
    const layers: Array<{ freq: number; q: number; gain: number }> = [
      { freq: 320, q: 0.5, gain: 0.36 },
      { freq: 950, q: 0.7, gain: 0.3 },
      { freq: 2400, q: 1.1, gain: 0.12 },
    ];
    for (const layer of layers) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true; // ノイズバッファは1秒しかないので繰り返して尺を稼ぐ
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = layer.freq;
      filter.Q.value = layer.q;

      // うねり: フィルタ周波数を 0.7Hz 前後でゆっくり揺らす (「波」に聞こえる要因)
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.55 + layer.q * 0.2;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = layer.freq * 0.16;
      lfo.connect(lfoGain).connect(filter.frequency);

      const gain = ctx.createGain();
      const target = layer.gain * peak;
      const attack = duration * 0.22;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(target, t + attack);
      gain.gain.setValueAtTime(target, t + duration * 0.42);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

      src.connect(filter).connect(gain).connect(out);
      src.start(t);
      lfo.start(t);
      src.stop(t + duration + 0.05);
      lfo.stop(t + duration + 0.05);
    }
  }

  /** ゴール: 歓声のうねり + 上昇する和音。 */
  private goal(ctx: Ctx, out: AudioNode): void {
    this.crowdRoar(ctx, out, 3.4, 1);
    // 明るい和音を少しずつずらして鳴らす (ファンファーレ感)
    const chord: Array<[number, number]> = [
      [523.25, 0], // C5
      [659.25, 0.07], // E5
      [783.99, 0.14], // G5
      [1046.5, 0.21], // C6
    ];
    for (const [freq, delay] of chord) {
      this.tone(ctx, out, { type: 'triangle', f0: freq, duration: 0.55, gain: 0.22, delay });
    }
  }
}
