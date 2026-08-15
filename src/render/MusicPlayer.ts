/**
 * 試合中のBGMを Web Audio API で**その場で合成**して鳴らす (18周目)。
 *
 * ★実装の動機 (原作調査)★
 * 当時のレビューで「BGMは試合の前半後半で異なる曲が流れ、いずれもゲームにあった
 * **アップテンポで盛り上がる曲**」と記録されている。またファミ通レビューは原作の核を
 * 「**テンポのよさ、それがキモ**」「とにかく速い、速い」と評しており、BGMは
 * その「速さ」の体感を作る主要因のひとつ。現状の本作はBGMが完全に無く、
 * 効果音だけが時々鳴る「無音のゲーム」だった (docs/original-gap-list.md S1)。
 *
 * 音声ファイルを持たない理由は SoundPlayer.ts と同じ (CLAUDE.md「完全オリジナル素材」)。
 * 矩形波/三角波のオシレータとノイズだけで、コード進行とベース、ハイハットを組む。
 *
 * 決定論には一切関与しない (描画層と同じ扱い。GameStateを読むだけで書かない)。
 */

/** BGM全体の音量。効果音(0.32)より控えめにして、笛やキック音を埋もれさせない。 */
const MUSIC_GAIN = 0.13;

/** 1拍の長さ (秒)。150BPM = 0.4秒/拍。原作評の「アップテンポ」に合わせて速めにする。 */
const BEAT_SEC = 0.4;
/** 1小節の拍数。 */
const BEATS_PER_BAR = 4;

/** 音名 → 周波数 (A4=440Hz の12平均律)。 */
function note(semitonesFromA4: number): number {
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

/**
 * 前半/後半で別の曲にする (原作の記録どおり)。
 * どちらも4小節ループ。数値は「A4からの半音数」。
 */
interface Tune {
  /** 各小節のコードのルート音。 */
  readonly bass: readonly number[];
  /** 主旋律 (8分音符 × 8 / 小節)。null は休符。 */
  readonly lead: ReadonlyArray<readonly (number | null)[]>;
}

/** 前半: 明るい進行 (I - V - vi - IV 相当)。 */
const FIRST_HALF: Tune = {
  bass: [-9, -2, -12, -5], // C, G, A(低), F 相当
  lead: [
    [3, null, 7, null, 10, null, 7, null],
    [2, null, 7, null, 11, null, 7, null],
    [0, null, 3, null, 7, null, 3, null],
    [5, null, 9, null, 12, null, 9, null],
  ],
};

/** 後半: 少し緊張感のある進行 (vi - IV - I - V 相当)、旋律も動きを増やす。 */
const SECOND_HALF: Tune = {
  bass: [-12, -5, -9, -2],
  lead: [
    [0, 3, 7, 3, 10, 7, 3, 0],
    [5, 9, 12, 9, 5, 9, 12, 14],
    [3, 7, 10, 7, 3, 7, 10, 12],
    [2, 7, 11, 7, 2, 7, 11, 14],
  ],
};

export type MusicTrack = 'firstHalf' | 'secondHalf';

export class MusicPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private current: MusicTrack | null = null;
  /** 次にスケジュールすべき小節の開始時刻 (AudioContext時間)。 */
  private nextBarTime = 0;
  private barIndex = 0;
  private timer: number | null = null;

  /** ユーザー操作のハンドラ内から呼ぶこと (自動再生ポリシー)。冪等。 */
  ensureStarted(ctx?: AudioContext): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AC: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = ctx ?? new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MUSIC_GAIN;
      this.master.connect(this.ctx.destination);
    }
    void this.ctx.resume?.();
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : MUSIC_GAIN;
  }

  /**
   * 指定のトラックを再生する (既に同じトラックなら何もしない)。
   * ハーフタイムやフルタイムで曲を切り替える/止めるのに使う。
   */
  play(track: MusicTrack): void {
    if (!this.ctx || !this.master) return;
    if (this.current === track && this.timer !== null) return;
    this.current = track;
    this.barIndex = 0;
    this.nextBarTime = this.ctx.currentTime + 0.05;
    if (this.timer === null) {
      // 先読みスケジューラ (Web Audio の定番構成: タイマーで先の小節を積む)。
      this.timer = window.setInterval(() => this.schedule(), 100);
    }
    this.schedule();
  }

  stop(): void {
    this.current = null;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 先の 0.5 秒ぶんまで小節を積む。 */
  private schedule(): void {
    const ctx = this.ctx;
    const track = this.current;
    if (!ctx || !this.master || !track) return;
    const tune = track === 'firstHalf' ? FIRST_HALF : SECOND_HALF;
    const barSec = BEAT_SEC * BEATS_PER_BAR;
    while (this.nextBarTime < ctx.currentTime + 0.5) {
      this.scheduleBar(tune, this.barIndex % tune.bass.length, this.nextBarTime);
      this.nextBarTime += barSec;
      this.barIndex++;
    }
  }

  private scheduleBar(tune: Tune, bar: number, at: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    // ベース: 小節頭と3拍目に短く。
    const root = tune.bass[bar] ?? -9;
    for (const beat of [0, 2]) {
      this.blip(note(root), at + beat * BEAT_SEC, BEAT_SEC * 0.8, 'triangle', 0.5);
    }
    // 主旋律: 8分音符。
    const lead = tune.lead[bar] ?? [];
    for (let i = 0; i < lead.length; i++) {
      const n = lead[i];
      if (n === null || n === undefined) continue;
      this.blip(note(n + 12), at + (i * BEAT_SEC) / 2, BEAT_SEC * 0.42, 'square', 0.22);
    }
    // ハイハット代わりの短いノイズ: 8分で刻んでテンポを感じさせる。
    for (let i = 0; i < 8; i++) {
      this.tick(at + (i * BEAT_SEC) / 2, i % 2 === 0 ? 0.055 : 0.03);
    }
  }

  /** 単音 (エンベロープ付き)。 */
  private blip(freq: number, at: number, dur: number, type: OscillatorType, gain: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /** ハイハット相当の短いノイズ。 */
  private tick(at: number, gain: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(7800, at);
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0005, at + 0.035);
    osc.connect(g);
    g.connect(master);
    osc.start(at);
    osc.stop(at + 0.05);
  }
}
