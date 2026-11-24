// Synthesised sound: clock ticks, gates, the rewind, a music box. No files.
// The context is created on the first user gesture (browsers require it).

type Ctx = BaseAudioContext;

// C major pentatonic across two octaves, music-box register.
const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760];

export class Sfx {
  private ctx: Ctx | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private tickFlip = false;
  sfxOn = true;
  musicOn = true;
  private musicTimer = 0;
  private musicStep = 0;

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.attach(new AC());
    }
    const ctx = this.ctx as AudioContext;
    if (ctx.state === 'suspended' && 'resume' in ctx) void ctx.resume();
    this.startMusic();
  }

  /** Wire the buses onto a context (a live one, or an offline one for measuring). */
  attach(ctx: Ctx): void {
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxOn ? 1 : 0;
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.55 : 0;
    this.musicBus.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Render one sound offline and measure it: peak and RMS in dBFS, plus RMS above ~500 Hz (what a phone speaker can play). */
  static async measure(play: (s: Sfx) => void, seconds = 2): Promise<{ peak: number; rms: number; rmsHigh: number }> {
    const rate = 44100;
    const off = new OfflineAudioContext(1, Math.round(rate * seconds), rate);
    const s = new Sfx();
    s.musicOn = false;
    s.attach(off);
    play(s);
    const buf = await off.startRendering();
    const d = buf.getChannelData(0);
    let peak = 0, sum = 0, sumHigh = 0, lp = 0;
    const a = Math.exp((-2 * Math.PI * 500) / rate);
    for (let i = 0; i < d.length; i++) {
      peak = Math.max(peak, Math.abs(d[i]));
      sum += d[i] * d[i];
      lp = a * lp + (1 - a) * d[i];
      const hp = d[i] - lp;
      sumHigh += hp * hp;
    }
    // RMS over the part that actually sounds, not the trailing silence
    let last = d.length - 1;
    while (last > 0 && Math.abs(d[last]) < 1e-4) last--;
    const n = Math.max(1, last + 1);
    const db = (x: number) => Math.round(20 * Math.log10(Math.max(1e-9, x)) * 10) / 10;
    return { peak: db(peak), rms: db(Math.sqrt(sum / n)), rmsHigh: db(Math.sqrt(sumHigh / n)) };
  }

  setSfx(on: boolean): void {
    this.sfxOn = on;
    if (this.ctx) this.sfxBus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.2);
  }

  // ---------- primitives ----------

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; at?: number; to?: number; attack?: number; bus?: GainNode } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (opts.at ?? 0);
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (opts.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(opts.bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hiss(dur: number, opts: { freq?: number; to?: number; q?: number; gain?: number; at?: number; type?: BiquadFilterType } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (opts.at ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq ?? 2000, t);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    f.Q.value = opts.q ?? 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** A struck music-box tine: fundamental plus a bright inharmonic partial. */
  private tine(freq: number, at = 0, gain = 0.12, bus?: GainNode): void {
    this.tone(freq, 1.2, { gain, at, bus, attack: 0.002 });
    this.tone(freq * 2.76, 0.35, { gain: gain * 0.35, at, bus, attack: 0.002 });
    this.tone(freq * 5.4, 0.12, { gain: gain * 0.12, at, bus, attack: 0.001 });
  }

  // ---------- game sounds ----------

  tick(): void {
    this.tickFlip = !this.tickFlip;
    const f = this.tickFlip ? 3400 : 2500;
    this.hiss(0.035, { freq: f, q: 3, gain: 1.6 });
    this.tone(this.tickFlip ? 1900 : 1500, 0.05, { gain: 0.22, type: 'triangle' });
  }

  bump(): void {
    this.tone(160, 0.14, { to: 80, gain: 0.5, type: 'sine' });
    // A woody knock up where phone speakers can play it
    this.tone(760, 0.05, { to: 420, gain: 0.3, type: 'triangle' });
    this.hiss(0.06, { freq: 900, q: 1, gain: 0.5, type: 'lowpass' });
  }

  push(): void {
    this.hiss(0.16, { freq: 700, to: 420, q: 1.2, gain: 1.1 });
    this.tone(90, 0.12, { gain: 0.3 });
    this.tone(230, 0.08, { gain: 0.14, type: 'triangle' });
  }

  plate(on: boolean, color: number): void {
    const base = [392, 494, 587, 698][color] ?? 440;
    this.hiss(0.03, { freq: on ? 1800 : 2600, q: 3, gain: 1.0 });
    this.tone(on ? base : base * 1.5, 0.18, { gain: 0.35, type: 'triangle' });
  }

  door(open: boolean, color: number): void {
    const base = [392, 494, 587, 698][color] ?? 440;
    this.hiss(0.24, { freq: open ? 300 : 1400, to: open ? 1500 : 300, q: 2, gain: 0.7 });
    this.tone(base * (open ? 2 : 1), 0.5, { gain: 0.3, at: 0.05 });
    this.tone(base * (open ? 3 : 1.5), 0.3, { gain: 0.14, at: 0.08 });
  }

  jam(): void {
    this.tone(220, 0.08, { gain: 0.22, type: 'square' });
    this.tone(233, 0.1, { gain: 0.16, type: 'square', at: 0.04 });
  }

  sentry(): void {
    this.hiss(0.025, { freq: 1100, q: 3, gain: 0.35 });
  }

  caught(present: boolean): void {
    for (const [f, g] of [[420, 0.24], [1130, 0.14], [1870, 0.08], [2650, 0.05]] as const) this.tone(f, 0.9, { gain: g * (present ? 1 : 0.7), attack: 0.001 });
    this.tone(900, 0.55, { to: 120, gain: 0.18, type: 'triangle', at: 0.05 });
  }

  /** Time winding back: a falling sweep plus a reversed arpeggio. */
  rewind(seconds: number): void {
    this.hiss(seconds, { freq: 5000, to: 240, q: 1.8, gain: 0.45 });
    const n = 8;
    for (let k = 0; k < n; k++) this.tine(SCALE[n - k], (k / n) * seconds * 0.9, 0.09);
  }

  /** A new self winds up: ratchet clicks climbing. */
  windUp(): void {
    for (let k = 0; k < 6; k++) {
      this.hiss(0.02, { freq: 1800 + k * 350, q: 4, gain: 0.8, at: k * 0.045 });
    }
    this.tine(SCALE[5], 0.3, 0.12);
  }

  refuse(): void {
    this.tone(180, 0.09, { gain: 0.18, type: 'square' });
  }

  win(): void {
    const notes = [0, 2, 4, 5, 7, 9];
    notes.forEach((n, k) => this.tine(SCALE[n], k * 0.11, 0.17));
    // Tower bell: low, long, with a minor-third hum.
    this.tone(196, 3.2, { gain: 0.26, at: 0.75, attack: 0.003 });
    this.tone(392 * 1.19, 2.2, { gain: 0.06, at: 0.75 });
    this.tone(784 * 1.5, 1.2, { gain: 0.04, at: 0.75 });
  }

  ui(): void {
    this.hiss(0.02, { freq: 3000, q: 3, gain: 0.5 });
  }

  // ---------- music box ----------

  private startMusic(): void {
    if (this.musicTimer || !this.ctx || !(this.ctx instanceof AudioContext)) return;
    // A slow, wandering music-box line; never loud, never repeating exactly.
    const phrase = [4, 5, 7, 5, 4, 2, 0, 2, 4, 2, 0, -1, 2, 4, 5, 4];
    const run = () => {
      if (!this.ctx) return;
      if (this.musicOn && this.ctx.state === 'running') {
        const k = this.musicStep++;
        const n = phrase[k % phrase.length];
        if (n >= 0) {
          const shift = Math.floor(k / phrase.length) % 3 === 2 ? 1 : 0;
          this.tine(SCALE[Math.min(SCALE.length - 1, n + shift)] / 2, 0, 0.1, this.musicBus);
          if (k % 4 === 0) this.tine(SCALE[(n + 4) % 5] / 4, 0.02, 0.07, this.musicBus);
        }
      }
      this.musicTimer = window.setTimeout(run, 620 + (this.musicStep % 8 === 7 ? 620 : 0));
    };
    this.musicTimer = window.setTimeout(run, 800);
  }
}
