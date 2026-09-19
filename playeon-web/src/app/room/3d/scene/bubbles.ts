import * as THREE from "three";

import { BUBBLE } from "../lib/tuning";

const WRAP_PX = 230;
const MAX_LINES = 4;

const SCALE = 3;

const LINE_PX = 20 * SCALE;

export type BubbleKind = "text" | "emoji";

function textTexture(text: string): THREE.CanvasTexture {
  const font = `500 ${15 * SCALE}px ui-sans-serif, system-ui, sans-serif`;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;

  const lines = wrap(measure, text, WRAP_PX * SCALE);

  const padX = 13 * SCALE;
  const padY = 9 * SCALE;

  let widest = 0;
  for (const line of lines) {
    widest = Math.max(widest, measure.measureText(line).width);
  }

  const width = Math.ceil(widest + padX * 2);
  const height = Math.ceil(lines.length * LINE_PX + padY * 2);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "rgba(10,10,16,0.74)";
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 11 * SCALE);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, width, height);
  }

  ctx.font = font;
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, index) => {
    ctx.fillText(line, width / 2, padY + LINE_PX * (index + 0.5));
  });

  return finish(canvas);
}

function emojiTexture(glyph: string): THREE.CanvasTexture {
  const size = 128 * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.font = `${size * 0.72}px ui-sans-serif, system-ui, "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = size * 0.06;
  ctx.fillText(glyph, size / 2, size * 0.54);

  return finish(canvas);
}

function finish(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  return texture;
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  limit: number,
): string[] {
  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= limit || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === MAX_LINES) break;
  }
  if (lines.length < MAX_LINES && line) lines.push(line);

  const last = lines[lines.length - 1];
  if (last && ctx.measureText(last).width > limit) {
    let cut = last;
    while (cut.length > 1 && ctx.measureText(`${cut}…`).width > limit) {
      cut = cut.slice(0, -1);
    }
    lines[lines.length - 1] = `${cut}…`;
  } else if (
    lines.length === MAX_LINES &&
    words.join(" ").length > lines.join(" ").length
  ) {
    lines[MAX_LINES - 1] = `${lines[MAX_LINES - 1]}…`;
  }

  return lines.length > 0 ? lines : [""];
}

export class Bubble {
  readonly sprite: THREE.Sprite;

  private readonly material: THREE.SpriteMaterial;
  private texture: THREE.CanvasTexture | null = null;

  private age = 0;
  private life = 0;
  private width = 0;
  private height = 0;
  private baseY: number = BUBBLE.y;
  private rise: number = BUBBLE.driftM;

  constructor() {
    this.material = new THREE.SpriteMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      opacity: 0,
    });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.visible = false;
    this.sprite.renderOrder = 11;
  }

  get active(): boolean {
    return this.age < this.life;
  }

  show(
    text: string,
    kind: BubbleKind,
    y: number = BUBBLE.y,
    rise: number = BUBBLE.driftM,
  ): void {
    this.texture?.dispose();
    this.rise = rise;

    if (kind === "emoji") {
      this.texture = emojiTexture(text);
      this.width = BUBBLE.emojiHeight;
      this.height = BUBBLE.emojiHeight;
      this.life = BUBBLE.emojiHoldSec + BUBBLE.fadeSec;
    } else {
      this.texture = textTexture(text);
      const image = this.texture.image as { width: number; height: number };
      const perPixel = BUBBLE.height / LINE_PX;
      this.width = image.width * perPixel;
      this.height = image.height * perPixel;
      this.life = BUBBLE.holdSec + BUBBLE.fadeSec;
    }

    this.material.map = this.texture;
    this.material.needsUpdate = true;
    this.age = 0;
    this.baseY = y;
    this.sprite.visible = true;
  }

  clear(): void {
    this.age = this.life;
    this.sprite.visible = false;
    this.material.opacity = 0;
  }

  update(dt: number): void {
    if (!this.sprite.visible) return;

    this.age += dt;
    if (this.age >= this.life) {
      this.sprite.visible = false;
      this.material.opacity = 0;
      return;
    }

    const pop = Math.min(1, this.age / BUBBLE.popSec);
    const scale = backOut(pop, BUBBLE.overshoot * 4);

    const fading = this.life - BUBBLE.fadeSec;
    this.material.opacity =
      this.age <= fading ? 1 : 1 - (this.age - fading) / BUBBLE.fadeSec;

    this.sprite.scale.set(this.width * scale, this.height * scale, 1);
    this.sprite.position.y =
      this.baseY + this.rise * (this.age / this.life) + this.height / 2;
  }

  dispose(): void {
    this.texture?.dispose();
    this.material.dispose();
  }
}

function backOut(t: number, s: number): number {
  const k = t - 1;
  return 1 + (s + 1) * k * k * k + s * k * k;
}
