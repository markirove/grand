const MASTER = 0.9;

const DRIVE = 1.8;

const NOISE_SECONDS = 0.5;

const ATTACK = 0.0004;

const JITTER = 0.06;

const ROLLOFF = 0.1;

export type ImpactKind = "slap" | "kick";

type Layer = {
  type: BiquadFilterType;
  freq: number;
  /** Ramp the cutoff here across the decay. */
  to?: number;
  q: number;
  gain: number;
  decay: number;
  at: number;
};

type Body = {
  freq: number;
  drop: number;
  gain: number;
  decay: number;
  at: number;
};

type Hit = {
  layers: readonly Layer[];
  body: Body | null;
};

const HITS: Record<ImpactKind, Hit> = {
  /*
    Skin, not a switch. A contact click is a few milliseconds of resonant noise
    and that is exactly what this used to be - the giveaway is a high-Q peak
    that rings. A slap is broadband and an order of magnitude longer, and its
    character is the spectral centre falling: the splat opens wide and shuts
    down to a low thud within about 50ms. That fall is the sweep on the first
    layer; the Qs are low so nothing pings, and the sine underneath supplies the
    mass the switch never had.
  */
  slap: {
    layers: [
      { type: "lowpass", freq: 7400, to: 760, q: 0.9, gain: 1, decay: 0.052, at: 0 },
      { type: "bandpass", freq: 1500, to: 620, q: 1.1, gain: 0.5, decay: 0.1, at: 0.004 },
    ],
    body: { freq: 165, drop: 95, gain: 0.5, decay: 0.11, at: 0.001 },
  },
  kick: {
    layers: [
      { type: "lowpass", freq: 750, q: 1, gain: 1, decay: 0.05, at: 0 },
      { type: "bandpass", freq: 1500, q: 1.6, gain: 0.5, decay: 0.03, at: 0.001 },
      { type: "lowpass", freq: 260, q: 1.1, gain: 0.9, decay: 0.13, at: 0.006 },
    ],
    body: { freq: 110, drop: 42, gain: 0.95, decay: 0.19, at: 0 },
  },
};

function vary(value: number, spread = JITTER): number {
  return value * (1 + (Math.random() * 2 - 1) * spread);
}

export class ImpactSound {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private dead = false;

  arm(): void {
    if (this.dead) return;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) {
        this.dead = true;
        return;
      }
      const ctx = new Ctor();
      const shaper = ctx.createWaveShaper();
      shaper.curve = softClip();
      shaper.oversample = "none";

      const master = ctx.createGain();
      master.gain.value = MASTER;

      const bus = ctx.createGain();
      bus.gain.value = 1;
      bus.connect(shaper);
      shaper.connect(master);
      master.connect(ctx.destination);

      this.ctx = ctx;
      this.bus = bus;
      this.noise = buildNoise(ctx);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
  }

  play(kind: ImpactKind, distance: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.bus || !this.noise || ctx.state !== "running") return;

    const hit = HITS[kind];
    const level = 1 / (1 + distance * distance * ROLLOFF);
    const start = ctx.currentTime + 0.002;

    for (const layer of hit.layers) {
      this.burst(layer, start + vary(layer.at), level);
    }
    if (hit.body) this.thump(hit.body, start + hit.body.at, level);
  }

  private burst(layer: Layer, at: number, level: number): void {
    const ctx = this.ctx;
    const bus = this.bus;
    const noise = this.noise;
    if (!ctx || !bus || !noise) return;

    const decay = vary(layer.decay);
    const source = ctx.createBufferSource();
    source.buffer = noise;

    const filter = ctx.createBiquadFilter();
    filter.type = layer.type;
    filter.Q.value = layer.q;
    filter.frequency.setValueAtTime(vary(layer.freq), at);
    if (layer.to !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(40, vary(layer.to)),
        at + decay,
      );
    }

    const gain = ctx.createGain();
    const peak = Math.max(1e-4, layer.gain * level);
    gain.gain.setValueAtTime(1e-4, at);
    gain.gain.linearRampToValueAtTime(peak, at + ATTACK);
    gain.gain.exponentialRampToValueAtTime(1e-4, at + decay);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);

    source.start(at, Math.random() * (NOISE_SECONDS - decay - 0.01));
    source.stop(at + decay + 0.01);
  }

  private thump(body: Body, at: number, level: number): void {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;

    const decay = vary(body.decay);
    const top = vary(body.freq);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(top, at);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, top - body.drop),
      at + decay,
    );

    const gain = ctx.createGain();
    const peak = Math.max(1e-4, body.gain * level);
    gain.gain.setValueAtTime(1e-4, at);
    gain.gain.linearRampToValueAtTime(peak, at + ATTACK);
    gain.gain.exponentialRampToValueAtTime(1e-4, at + decay);

    osc.connect(gain);
    gain.connect(bus);

    osc.start(at);
    osc.stop(at + decay + 0.02);
  }

  dispose(): void {
    this.dead = true;
    this.noise = null;
    this.bus?.disconnect();
    this.bus = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

function buildNoise(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function softClip(): Float32Array<ArrayBuffer> {
  const points = 1024;
  const curve = new Float32Array(new ArrayBuffer(points * 4));
  for (let i = 0; i < points; i += 1) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * DRIVE);
  }
  return curve;
}
