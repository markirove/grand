import * as THREE from "three";

import { SCREEN } from "./tuning";

export type LightSource =
  | HTMLVideoElement
  | HTMLImageElement
  | HTMLCanvasElement;

export class ContentLight {
  readonly color = new THREE.Color(1, 1, 1);
  level = 0;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private readonly target = new THREE.Color(1, 1, 1);
  private targetLevel = 0;
  private nextSampleAt = 0;
  private readonly tainted = new WeakSet<LightSource>();
  private lastStill: LightSource | null = null;

  read(source: LightSource, nowMs: number): void {
    if (this.tainted.has(source)) return;
    const still = !(source instanceof HTMLVideoElement);
    if (still && this.lastStill === source) return;
    if (nowMs < this.nextSampleAt) return;
    this.nextSampleAt = nowMs + 1000 / SCREEN.contentHz;

    const ctx = this.context();
    if (!ctx || !this.canvas) return;

    const { width, height } = this.canvas;
    try {
      ctx.drawImage(source, 0, 0, width, height);
      const { data } = ctx.getImageData(0, 0, width, height);

      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]!;
        g += data[i + 1]!;
        b += data[i + 2]!;
      }
      const pixels = data.length / 4;
      this.aim(r / pixels / 255, g / pixels / 255, b / pixels / 255);
      this.lastStill = still ? source : null;
    } catch {
      this.tainted.add(source);
    }
  }

  step(dt: number): void {
    const k = 1 - Math.exp(-SCREEN.contentEase * dt);
    this.color.lerp(this.target, k);
    this.level += (this.targetLevel - this.level) * k;
  }

  dim(): void {
    this.targetLevel = 0;
    this.lastStill = null;
  }

  dispose(): void {
    this.canvas = null;
    this.ctx = null;
  }

  private aim(r: number, g: number, b: number): void {
    this.target.setRGB(r, g, b, THREE.SRGBColorSpace);

    const hsl = { h: 0, s: 0, l: 0 };
    this.target.getHSL(hsl);
    this.target.setHSL(
      hsl.h,
      Math.min(1, hsl.s * SCREEN.contentSaturation),
      0.5,
    );

    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    this.targetLevel = Math.min(1, luma / SCREEN.contentFullAt);
  }

  private context(): CanvasRenderingContext2D | null {
    if (this.ctx) return this.ctx;
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 9;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    this.canvas = canvas;
    this.ctx = ctx;
    return ctx;
  }
}
