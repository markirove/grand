const MASTER = 0.72;

const DRIVE = 2.4;

const NOISE_SECONDS = 0.4;

type Voice = {
  type: BiquadFilterType;
  freq: number;
  q: number;
  gain: number;
  decay: number;
  at: number;
};

const VOICES: readonly Voice[] = [
  { type: "highpass", freq: 1500, q: 0.7, gain: 1, decay: 0.004, at: 0 },
  { type: "bandpass", freq: 4300, q: 3.2, gain: 0.95, decay: 0.007, at: 0.0008 },
  { type: "bandpass", freq: 1750, q: 4, gain: 0.9, decay: 0.022, at: 0.014 },
  { type: "lowpass", freq: 340, q: 1.2, gain: 0.55, decay: 0.055, at: 0.014 },
];

const ATTACK = 0.0002;

const OFF_TILT = 0.88;

const JITTER = 0.07;

const ROLLOFF = 0.12;

function vary(value: number, spread = JITTER): number {
  return value * (1 + (Math.random() * 2 - 1) * spread);
}

export class SwitchSound {
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

  play(on: boolean, distance: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.bus || !this.noise || ctx.state !== "running") return;

    const level = 1 / (1 + distance * distance * ROLLOFF);
    const tilt = on ? 1 : OFF_TILT;
    const start = ctx.currentTime + 0.002;

    for (const voice of VOICES) {
      this.burst(voice, start + vary(voice.at), level, tilt);
    }
  }

  private burst(voice: Voice, at: number, level: number, tilt: number): void {
    const ctx = this.ctx;
    const bus = this.bus;
    const noise = this.noise;
    if (!ctx || !bus || !noise) return;

    const decay = vary(voice.decay);
    const source = ctx.createBufferSource();
    source.buffer = noise;

    const filter = ctx.createBiquadFilter();
    filter.type = voice.type;
    filter.frequency.value =
      vary(voice.freq) * (voice.type === "lowpass" ? 1 : tilt);
    filter.Q.value = voice.q;

    const gain = ctx.createGain();
    const peak = Math.max(1e-4, voice.gain * level * tilt);
    gain.gain.setValueAtTime(1e-4, at);
    gain.gain.linearRampToValueAtTime(peak, at + ATTACK);
    gain.gain.exponentialRampToValueAtTime(1e-4, at + decay);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);

    source.start(at, Math.random() * (NOISE_SECONDS - decay - 0.01));
    source.stop(at + decay + 0.01);
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
