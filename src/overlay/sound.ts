/**
 * Procedural sound engine (Web Audio API).
 *
 * Why synthesized instead of downloaded clips: it keeps the app fully offline,
 * avoids any audio-licensing concerns, and adds zero binary weight. Each theme
 * supplies a tiny "sound profile" built from these primitives so every style
 * has a fitting tick + finale. To use real audio files later, drop them in and
 * swap `playDigit/playFinish` to `new Audio(...)`; the theme interface is ready.
 */

export interface ToneOpts {
  freq: number;
  type?: OscillatorType;
  dur?: number;
  gain?: number;
  attack?: number;
  release?: number;
  glideTo?: number; // frequency to glide to over the note
  detune?: number;
  delay?: number; // start offset (s)
  pan?: number; // -1..1
}

export interface NoiseOpts {
  dur?: number;
  gain?: number;
  filter?: BiquadFilterType;
  freq?: number; // filter cutoff
  q?: number;
  sweepTo?: number; // cutoff sweep target
  delay?: number;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) this.ensure();
  }

  private ensure() {
    if (this.ctx) return;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
  }

  /** Best-effort resume (autoplay policies). Safe to call repeatedly. */
  resume() {
    if (!this.enabled) return;
    this.ensure();
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  private out(): AudioNode | null {
    if (!this.enabled || !this.ctx || !this.master) return null;
    return this.master;
  }

  now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private routePan(node: AudioNode, pan?: number): AudioNode {
    if (!this.ctx || pan === undefined) return node;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p);
    return p;
  }

  tone(o: ToneOpts) {
    const dst = this.out();
    if (!dst || !this.ctx) return;
    const t0 = this.now() + (o.delay ?? 0);
    const dur = o.dur ?? 0.18;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.glideTo), t0 + dur);
    if (o.detune) osc.detune.value = o.detune;

    const peak = o.gain ?? 0.3;
    const atk = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + (o.release ?? 0.05));

    osc.connect(g);
    this.routePan(g, o.pan).connect(dst);
    osc.start(t0);
    osc.stop(t0 + dur + (o.release ?? 0.05) + 0.02);
  }

  noise(o: NoiseOpts = {}) {
    const dst = this.out();
    if (!dst || !this.ctx) return;
    const t0 = this.now() + (o.delay ?? 0);
    const dur = o.dur ?? 0.3;
    const len = Math.floor((this.ctx.sampleRate * dur) | 0) || 1;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = o.filter ?? "bandpass";
    filter.frequency.setValueAtTime(o.freq ?? 1200, t0);
    if (o.sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.sweepTo), t0 + dur);
    filter.Q.value = o.q ?? 1;

    const g = this.ctx.createGain();
    const peak = o.gain ?? 0.25;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter);
    filter.connect(g);
    g.connect(dst);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** Several tones at once (chord / cluster). */
  chord(freqs: number[], o: Omit<ToneOpts, "freq"> = {}) {
    freqs.forEach((f, i) => this.tone({ ...o, freq: f, delay: (o.delay ?? 0) + i * 0.0 }));
  }

  /** Quick ascending/descending arpeggio (used in finales). */
  arp(freqs: number[], step = 0.08, o: Omit<ToneOpts, "freq" | "delay"> = {}) {
    freqs.forEach((f, i) => this.tone({ ...o, freq: f, delay: i * step }));
  }
}
