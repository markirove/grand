import { ANOMALY } from "./tuning";

export class Anomaly {
  private t = -1;
  private held = 1;
  private until = 0;

  get running(): boolean {
    return this.t >= 0;
  }

  trigger(): void {
    if (this.running) return;
    this.t = 0;
    this.until = 0;
    this.held = 1;
  }

  update(dt: number): number {
    if (!this.running) return 1;

    this.t += dt;
    const t = this.t;
    if (t >= ANOMALY.duration) {
      this.t = -1;
      return 1;
    }

    const onset = 1 - clamp01((t - ANOMALY.flickerAt) / ANOMALY.flickerIn);
    const recovery = clamp01((t - ANOMALY.healAt) / ANOMALY.healOut);
    const force = Math.max(onset, recovery * 0.8, ANOMALY.flickerFloor);

    if (t >= this.until) {
      this.until =
        t + ANOMALY.flickerHoldMin + Math.random() * ANOMALY.flickerHoldSpread;
      const roll = Math.random();
      this.held = roll < 0.55 ? 0 : roll < 0.85 ? 0.35 : 1.6;
    }

    return 1 + (this.held - 1) * force;
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
