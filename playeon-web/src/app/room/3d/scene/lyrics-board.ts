import * as THREE from "three";

import { lineAt, type LyricLine } from "@/lib/lyrics";

const WIDTH = 1024;
const HEIGHT = 576;

const SCALE = 2;

const FONT_PX = 17.5;
const LINE_HEIGHT = 1.42;
const FONT_WEIGHT = 420;
const TRACKING = -0.2;
const LINE_PAD_Y = 9.5;
const PAD_X = 16 + 8;
const REST_X = 16;
const REST_H = 3;
const REST_W = 28;
const REST_MARGIN = 8;

const IDLE_ALPHA = 0.55;
const LIVE_ALPHA = 1;
const REST_ALPHA = 0.35;
const REST_LIVE_ALPHA = 0.6;

const FOCUS_RATIO = 0.5;
const SETTLE_MS = 420;
const COLOUR_MS = 300;

const BLUR_PX = 40;
const POSTER_ZOOM = 1.25;
const SCRIM = 0.42;

const SHADOW_Y = 1;
const SHADOW_BLUR = 6;

const FONT = "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";

const UNPAINTED = -2;

type Row = {
  top: number;
  height: number;
  rest: boolean;
  text: string[];
};

function ease(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  const x1 = 0.22;
  const x2 = 0.36;
  let low = 0;
  let high = 1;
  let u = t;

  for (let step = 0; step < 20; step += 1) {
    u = (low + high) / 2;
    const inv = 1 - u;
    const x = 3 * inv * inv * u * x1 + 3 * inv * u * u * x2 + u * u * u;
    if (x < t) low = u;
    else high = u;
  }

  const inv = 1 - u;
  return 3 * inv * inv * u + 3 * inv * u * u + u * u * u;
}

export class LyricsBoard {
  private map: THREE.CanvasTexture | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private textCanvas: HTMLCanvasElement | null = null;
  private textCtx: CanvasRenderingContext2D | null = null;

  private backdrop: HTMLCanvasElement | null = null;
  private backdropCtx: CanvasRenderingContext2D | null = null;
  private posterSource: HTMLImageElement | null = null;

  private lines: LyricLine[] = [];
  private rows: Row[] = [];
  private times = new Float64Array(0);

  private painted = UNPAINTED;
  private fading = -1;
  private colourStart = 0;

  private scrollFrom = 0;
  private scrollTo = 0;
  private scrollStart = 0;
  private scroll = 0;

  private settling = false;

  get texture(): THREE.CanvasTexture | null {
    return this.map;
  }

  setLines(lines: LyricLine[] | null): void {
    this.painted = UNPAINTED;
    this.fading = -1;
    this.settling = false;
    this.scroll = 0;
    this.scrollFrom = 0;
    this.scrollTo = 0;

    if (!lines || lines.length === 0) {
      this.lines = [];
      this.rows = [];
      this.times = new Float64Array(0);
      this.map?.dispose();
      this.map = null;
      this.canvas = null;
      this.ctx = null;
      this.textCanvas = null;
      this.textCtx = null;
      this.backdrop = null;
      this.backdropCtx = null;
      this.posterSource = null;
      return;
    }

    this.lines = lines;
    this.times = new Float64Array(lines.length);
    for (let index = 0; index < lines.length; index += 1) {
      this.times[index] = lines[index]!.t;
    }

    this.build();
    this.layout();

    this.scroll = this.offsetFor(-1);
    this.scrollFrom = this.scroll;
    this.scrollTo = this.scroll;

    this.paint(-1, performance.now(), true);
  }

  update(position: number, poster: HTMLImageElement | null): void {
    if (!this.map) return;

    const now = performance.now();

    if (poster !== this.posterSource) {
      this.posterSource = poster;
      this.bakeBackdrop();
      this.paint(this.painted, now, true);
      return;
    }

    const index = lineAt(this.times, position, this.painted);
    if (index !== this.painted) {
      this.paint(index, now, false);
      return;
    }

    if (this.settling) this.paint(index, now, false);
  }

  private build(): void {
    if (this.canvas) return;

    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");

    const text = document.createElement("canvas");
    text.width = WIDTH;
    text.height = HEIGHT;
    this.textCanvas = text;
    this.textCtx = text.getContext("2d");

    const backdrop = document.createElement("canvas");
    backdrop.width = WIDTH;
    backdrop.height = HEIGHT;
    this.backdrop = backdrop;
    this.backdropCtx = backdrop.getContext("2d");
    this.bakeBackdrop();

    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.minFilter = THREE.LinearFilter;
    map.magFilter = THREE.LinearFilter;
    map.generateMipmaps = false;
    this.map = map;
  }

  private bakeBackdrop(): void {
    const ctx = this.backdropCtx;
    if (!ctx) return;

    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#0a0a12";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const poster = this.posterSource;
    if (poster?.complete && poster.naturalWidth > 0) {
      const zoom = POSTER_ZOOM;
      const cover = Math.max(
        WIDTH / poster.naturalWidth,
        HEIGHT / poster.naturalHeight,
      );
      const width = poster.naturalWidth * cover * zoom;
      const height = poster.naturalHeight * cover * zoom;

      ctx.filter = `blur(${BLUR_PX * SCALE}px)`;
      try {
        ctx.drawImage(
          poster,
          (WIDTH - width) / 2,
          (HEIGHT - height) / 2,
          width,
          height,
        );
      } catch {
      }
      ctx.filter = "none";
    }

    ctx.fillStyle = `rgba(0,0,0,${SCRIM})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    try {
      ctx.getImageData(0, 0, 1, 1);
    } catch {
      this.posterSource = null;
      ctx.filter = "none";
      ctx.fillStyle = "#0a0a12";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
  }

  private layout(): void {
    const ctx = this.textCtx;
    if (!ctx) return;

    ctx.font = `${FONT_WEIGHT} ${FONT_PX * SCALE}px ${FONT}`;
    const limit = WIDTH - PAD_X * SCALE * 2;
    const leading = FONT_PX * LINE_HEIGHT * SCALE;

    this.rows = [];
    let top = 0;

    for (const line of this.lines) {
      if (line.text.length === 0) {
        const height = (REST_H + REST_MARGIN * 2) * SCALE;
        this.rows.push({ top, height, rest: true, text: [] });
        top += height;
        continue;
      }

      const text = wrap(ctx, line.text, limit);
      const height = text.length * leading + LINE_PAD_Y * 2 * SCALE;
      this.rows.push({ top, height, rest: false, text });
      top += height;
    }
  }

  private paint(index: number, now: number, force: boolean): void {
    const ctx = this.ctx;
    const text = this.textCtx;
    if (!ctx || !text || !this.textCanvas || !this.backdrop) return;

    if (index !== this.painted && !force) {
      this.fading = this.painted >= 0 ? this.painted : -1;
      this.painted = index;
      this.colourStart = now;
      this.scrollFrom = this.scroll;
      this.scrollTo = this.offsetFor(index);
      this.scrollStart = now;
    }

    const travel = Math.min(1, (now - this.scrollStart) / SETTLE_MS);
    const tint = Math.min(1, (now - this.colourStart) / COLOUR_MS);
    this.scroll =
      this.scrollFrom + (this.scrollTo - this.scrollFrom) * ease(travel);
    this.settling = travel < 1 || tint < 1;

    text.clearRect(0, 0, WIDTH, HEIGHT);
    text.font = `${FONT_WEIGHT} ${FONT_PX * SCALE}px ${FONT}`;
    text.textAlign = "left";
    text.textBaseline = "middle";
    text.shadowColor = "rgba(0,0,0,0.5)";
    text.shadowOffsetY = SHADOW_Y * SCALE;
    text.shadowBlur = SHADOW_BLUR * SCALE;
    try {
      text.letterSpacing = `${TRACKING * SCALE}px`;
    } catch {
    }

    const leading = FONT_PX * LINE_HEIGHT * SCALE;
    const left = PAD_X * SCALE;
    const eased = ease(tint);

    for (let i = 0; i < this.rows.length; i += 1) {
      const row = this.rows[i]!;
      const y = row.top - this.scroll;
      if (y + row.height < 0 || y > HEIGHT) continue;

      const live = i === this.painted;
      const leaving = i === this.fading;
      const base = row.rest ? REST_ALPHA : IDLE_ALPHA;
      const peak = row.rest ? REST_LIVE_ALPHA : LIVE_ALPHA;
      const alpha = live
        ? base + (peak - base) * eased
        : leaving
          ? peak - (peak - base) * eased
          : base;

      text.globalAlpha = alpha;

      text.fillStyle = "#ffffff";

      if (row.rest) {
        roundedBar(
          text,
          REST_X * SCALE,
          y + REST_MARGIN * SCALE,
          REST_W * SCALE,
          REST_H * SCALE,
        );
        continue;
      }

      for (let line = 0; line < row.text.length; line += 1) {
        text.fillText(
          row.text[line]!,
          left,
          y + LINE_PAD_Y * SCALE + line * leading + leading / 2,
        );
      }
    }

    text.globalAlpha = 1;
    text.shadowColor = "transparent";
    text.globalCompositeOperation = "destination-in";
    const mask = text.createLinearGradient(0, 0, 0, HEIGHT);
    mask.addColorStop(0, "rgba(0,0,0,0)");
    mask.addColorStop(0.14, "rgba(0,0,0,1)");
    mask.addColorStop(0.78, "rgba(0,0,0,1)");
    mask.addColorStop(1, "rgba(0,0,0,0)");
    text.fillStyle = mask;
    text.fillRect(0, 0, WIDTH, HEIGHT);
    text.globalCompositeOperation = "source-over";

    ctx.globalAlpha = 1;
    ctx.drawImage(this.backdrop, 0, 0);
    ctx.drawImage(this.textCanvas, 0, 0);

    if (this.map) this.map.needsUpdate = true;
  }

  private offsetFor(index: number): number {
    const row = this.rows[index >= 0 ? index : 0];
    if (!row) return 0;
    return row.top - HEIGHT * FOCUS_RATIO + row.height / 2;
  }

  dispose(): void {
    this.map?.dispose();
    this.map = null;
    this.canvas = null;
    this.ctx = null;
    this.textCanvas = null;
    this.textCtx = null;
    this.backdrop = null;
    this.backdropCtx = null;
    this.posterSource = null;
    this.lines = [];
    this.rows = [];
    this.times = new Float64Array(0);
    this.painted = UNPAINTED;
  }
}

function roundedBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const radius = height / 2;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, radius);
  } else {
    ctx.rect(x, y, width, height);
  }
  ctx.fill();
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  limit: number,
): string[] {
  if (ctx.measureText(text).width <= limit) return [text];

  const words = text.split(/\s+/);
  const rows: string[] = [];
  let row = "";

  for (const word of words) {
    const candidate = row ? `${row} ${word}` : word;
    if (!row || ctx.measureText(candidate).width <= limit) {
      row = candidate;
      continue;
    }
    rows.push(row);
    row = word;
  }
  if (row) rows.push(row);

  return rows.length > 0 ? rows : [text];
}
