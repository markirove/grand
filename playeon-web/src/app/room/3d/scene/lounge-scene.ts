import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import {
  ANOMALY,
  BUTTON,
  COUCH,
  LIGHTS,
  REMOTE,
  ROOM,
  ROUND,
  SCREEN,
  STOOL,
  SWITCH,
  VIEW,
  WORLD,
} from "../lib/tuning";
import { Anomaly } from "../lib/anomaly";
import type {
  CarpetPaint,
  FloorPaint,
  Motif,
  Palette,
  PlankPaint,
  StonePaint,
  TilePaint,
} from "../lib/palette";
import { Crowd } from "./crowd";

const LAMPS: readonly { x: number; z: number; on: boolean }[] = [
  { x: -0.6, z: 0.5, on: true },
  { x: 0.6, z: 0.5, on: true },
  { x: 0, z: 0.05, on: true },
  { x: -0.6, z: -0.45, on: true },
  { x: 0.6, z: -0.45, on: true },
];

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function plankTexture(
  paint: PlankPaint,
  maxAnisotropy: number,
  repeatX: number,
  repeatY: number,
): THREE.CanvasTexture {
  const size = 512;
  const boards = 4;
  const height = size / boards;
  const random = rng(0x10c9e);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = paint.base;
  ctx.fillRect(0, 0, size, size);

  for (let board = 0; board < boards; board += 1) {
    const top = board * height;

    const tone = 1 - paint.variation + random() * paint.variation * 2;
    const [red, green, blue] = paint.board;
    ctx.fillStyle = `rgb(${Math.round(red * tone)}, ${Math.round(green * tone)}, ${Math.round(blue * tone)})`;
    // no gap below the board when there is no edge line to fill it
    ctx.fillRect(0, top, size, paint.edge ? height - 1 : height);

    ctx.strokeStyle = paint.grain;
    ctx.lineWidth = 1;
    for (let line = 0; line < 3; line += 1) {
      const y = top + height * (0.2 + random() * 0.6);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }

    if (paint.joint) {
      const joint = Math.round(size * (0.15 + random() * 0.7));
      ctx.fillStyle = paint.joint;
      ctx.fillRect(joint, top, 2, height - 1);
    }

    if (paint.edge) {
      ctx.fillStyle = paint.edge;
      ctx.fillRect(0, top + height - 1, size, 1.5);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = maxAnisotropy;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A slab of veined stone, tiled.
 *
 * Drawn in three passes because that is how the eye reads stone: a diffuse
 * wash that gives the surface depth before any line is on it, then the veins,
 * then the joint. The veins are quadratic curves rather than straight lines and
 * each one spawns a couple of hairline branches off itself - a vein that does
 * not fork looks like a wire lying on the floor.
 *
 * Seamless in both axes: every vein that leaves an edge is drawn again one
 * canvas over, so it arrives on the far side at the same height it left. A tile
 * this large has nowhere to hide a mismatched edge.
 */
function stoneTexture(
  paint: StonePaint,
  maxAnisotropy: number,
  repeatX: number,
  repeatY: number,
): THREE.CanvasTexture {
  const size = 512;
  const random = rng(0x5a1b);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = paint.base;
  ctx.fillRect(0, 0, size, size);

  // the drift: wide, soft, barely there on its own
  for (let cloud = 0; cloud < 26; cloud += 1) {
    const x = random() * size;
    const y = random() * size;
    const radius = size * (0.08 + random() * 0.22);
    const wash = ctx.createRadialGradient(x, y, 0, x, y, radius);
    wash.addColorStop(0, paint.wash);
    wash.addColorStop(1, "transparent");
    ctx.globalAlpha = 0.10 + random() * 0.12;
    ctx.fillStyle = wash;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  ctx.globalAlpha = 1;

  ctx.lineCap = "round";
  ctx.strokeStyle = paint.vein;

  const vein = (
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    width: number,
    alpha: number,
  ) => {
    for (const shift of [-size, 0, size]) {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(fromX + shift, fromY);
      ctx.quadraticCurveTo(
        (fromX + toX) / 2 + shift + (random() - 0.5) * size * 0.3,
        (fromY + toY) / 2 + (random() - 0.5) * size * 0.3,
        toX + shift,
        toY,
      );
      ctx.stroke();
    }
  };

  for (let main = 0; main < 5; main += 1) {
    const fromY = random() * size;
    const toY = fromY + (random() - 0.5) * size * 0.5;
    vein(0, fromY, size, toY, 1.6 + random() * 2.2, 0.22 + random() * 0.16);

    for (let branch = 0; branch < 3; branch += 1) {
      const at = 0.2 + random() * 0.6;
      const x = size * at;
      const y = fromY + (toY - fromY) * at;
      vein(
        x,
        y,
        x + (random() - 0.5) * size * 0.5,
        y + (random() - 0.5) * size * 0.4,
        0.6 + random() * 0.8,
        0.12 + random() * 0.1,
      );
    }
  }
  ctx.globalAlpha = 1;

  // the joint, on two edges only: the repeat supplies the other two
  ctx.strokeStyle = paint.grout;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0.5);
  ctx.lineTo(size, 0.5);
  ctx.moveTo(0.5, 0);
  ctx.lineTo(0.5, size);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = maxAnisotropy;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A tiled floor: the same squares as the walls, at whatever size it asks for. */
function tileFloorTexture(
  paint: TilePaint,
  maxAnisotropy: number,
  repeatX: number,
  repeatY: number,
): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  paintTiles(ctx, size, {
    count: paint.count,
    base: paint.base,
    grout: paint.grout,
    glint: paint.glint,
    variation: paint.variation,
    seed: 0x4c1d,
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = maxAnisotropy;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Carpet: pile, then wear.
 *
 * Two passes at two scales, because that is how carpet actually reads. The
 * fleck is the pile - thousands of one-pixel marks in two tones, dense enough
 * that no individual one is visible and the surface just looks *soft*. The
 * stains are broad, soft-edged and few, and they are what stops it looking like
 * paper: real carpet in a room nobody maintains is not uniformly anything.
 *
 * The stains are drawn wrapped, so the ones that fall off an edge arrive back
 * on the other side whole. At three metres a repeat, a stain cut in half at the
 * tile boundary would be the one thing in the room that gives the grid away.
 */
function carpetTexture(
  paint: CarpetPaint,
  maxAnisotropy: number,
  repeatX: number,
  repeatY: number,
): THREE.CanvasTexture {
  const size = 256;
  const random = rng(0xca7e);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = paint.base;
  ctx.fillRect(0, 0, size, size);

  for (let patch = 0; patch < 14; patch += 1) {
    const x = random() * size;
    const y = random() * size;
    const radius = size * (0.09 + random() * 0.26);
    const wash = ctx.createRadialGradient(x, y, 0, x, y, radius);
    wash.addColorStop(0, paint.stain);
    wash.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.16 + random() * 0.22;

    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        ctx.fillStyle = wash;
        ctx.fillRect(x + dx - radius, y + dy - radius, radius * 2, radius * 2);
      }
    }
  }

  ctx.globalAlpha = 1;
  for (let tuft = 0; tuft < 26000; tuft += 1) {
    ctx.fillStyle = random() > 0.5 ? paint.fleck : paint.base;
    ctx.globalAlpha = 0.1 + random() * 0.3;
    ctx.fillRect(random() * size, random() * size, 1, 1);
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = maxAnisotropy;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Whichever floor this style is laid with. */
function floorTexture(
  paint: FloorPaint,
  maxAnisotropy: number,
  repeatX: number,
  repeatY: number,
): THREE.CanvasTexture {
  if (paint.kind === "stone") {
    return stoneTexture(paint, maxAnisotropy, repeatX, repeatY);
  }
  if (paint.kind === "tiles") {
    return tileFloorTexture(paint, maxAnisotropy, repeatX, repeatY);
  }
  if (paint.kind === "carpet") {
    return carpetTexture(paint, maxAnisotropy, repeatX, repeatY);
  }
  return plankTexture(paint, maxAnisotropy, repeatX, repeatY);
}

function rugTexture(
  paint: NonNullable<Palette["rug"]>,
  motif: Motif | null,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const size = 256;
  const random = rng(0x5ea1);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = paint.base;
  ctx.fillRect(0, 0, size, size);

  /*
    The bands go on before the speckle and under the border, at half strength.

    Order is the whole trick: laid over the weave they look like paint on a rug,
    laid under it they look like the rug was woven that way. Half strength
    because a rug is a large surface at the centre of the room, and the pattern
    that reads as trim on a bezel reads as a barber's pole down there.
  */
  if (motif) {
    ctx.globalAlpha = 0.62;
    ctx.drawImage(motifTexture(motif, 1).image as HTMLCanvasElement, 0, 0);
    ctx.globalAlpha = 1;
  }

  for (let speck = 0; speck < 2600; speck += 1) {
    const light = random() > 0.5;
    ctx.fillStyle = light ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.05)";
    ctx.fillRect(random() * size, random() * size, 2, 1);
  }

  ctx.strokeStyle = paint.border;
  ctx.lineWidth = 3;
  ctx.strokeRect(9, 9, size - 18, size - 18);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = maxAnisotropy;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A motif, drawn into a tile that repeats without showing where it joins.
 *
 * All three are laid out on `cell`, which divides the tile, and everything that
 * crosses an edge is drawn again one tile over so it arrives on the far side at
 * the same place it left. That wrapped redraw is the whole trick - without it
 * every motif gets clipped at the border and the repeat becomes a grid of
 * rectangles.
 */
function motifTexture(
  motif: Motif,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = motif.ground;
  ctx.fillRect(0, 0, size, size);

  if (motif.kind === "scales") drawScales(ctx, motif, size);
  else if (motif.kind === "pebbles") drawPebbles(ctx, motif, size);
  else if (motif.kind === "cells") drawCells(ctx, motif, size);
  else if (motif.kind === "ogee") drawOgee(ctx, motif, size);
  else if (motif.kind === "grain") drawGrain(ctx, motif, size);
  else if (motif.kind === "weave") drawWeave(ctx, motif, size);
  else if (motif.kind === "flutes") drawFlutes(ctx, motif, size);
  else if (motif.kind === "tiles") {
    paintTiles(ctx, size, {
      count: Math.max(1, Math.round(size / motif.cell)),
      base: motif.ground,
      grout: motif.ink,
      glint: motif.accent,
      variation: 0.02,
      seed: 0x7113,
    });
  }
  else drawStipple(ctx, motif, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(motif.repeat, motif.repeat);
  texture.anisotropy = maxAnisotropy;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A motif sized in world metres rather than in repeats.
 *
 * Takes the surface's real dimensions and works out a repeat per axis, so the
 * cells stay square on a wall that is three and a half times wider than it is
 * tall. Falls back to the motif's own repeat when it has no metre size, which
 * is the right answer for anything small enough that its proportions are the
 * designer's problem rather than the room's.
 */
function surfaceTexture(
  motif: Motif,
  widthM: number,
  heightM: number,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const texture = motifTexture(motif, maxAnisotropy);
  if (motif.metres) {
    texture.repeat.set(widthM / motif.metres, heightM / motif.metres);
  }
  return texture;
}

/**
 * Glazed ceramic tile: a grid of squares, grout between, a highlight on two
 * edges of each.
 *
 * The highlight is the whole thing. A tile drawn as a flat square with a line
 * round it is a bathroom floor plan; a tile with a bright edge on the side the
 * light comes from and a shaded one opposite is glazed ceramic, because that is
 * what a curved glaze does with a light source. Two edges, always the same two,
 * so the whole wall agrees about where the light is.
 *
 * Every tile also gets a tone of its own within `variation`. Real tile is
 * pristine and identical - the level's own description insists on it - but
 * identical to the pixel reads as plastic, and a percent of drift reads as
 * ceramic without ever looking damaged.
 */
function paintTiles(
  ctx: CanvasRenderingContext2D,
  size: number,
  options: {
    count: number;
    base: string;
    grout: string;
    glint: string;
    variation: number;
    seed: number;
  },
): void {
  const { count, base, grout, glint, variation } = options;
  const step = size / count;
  const random = rng(options.seed);

  ctx.fillStyle = grout;
  ctx.fillRect(0, 0, size, size);

  const gap = Math.max(1, step * 0.055);
  const face = step - gap;

  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      const x = col * step + gap / 2;
      const y = row * step + gap / 2;

      ctx.globalAlpha = 1;
      ctx.fillStyle = base;
      ctx.fillRect(x, y, face, face);

      // the glaze: bright where the light lands, shaded where it does not
      ctx.globalAlpha = 0.06 + random() * variation * 6;
      ctx.fillStyle = random() > 0.5 ? glint : grout;
      ctx.fillRect(x, y, face, face);

      ctx.globalAlpha = 0.55;
      ctx.fillStyle = glint;
      ctx.fillRect(x, y, face, Math.max(1, face * 0.06));
      ctx.fillRect(x, y, Math.max(1, face * 0.06), face);

      ctx.globalAlpha = 0.18;
      ctx.fillStyle = grout;
      ctx.fillRect(x, y + face - Math.max(1, face * 0.06), face, Math.max(1, face * 0.06));
      ctx.fillRect(x + face - Math.max(1, face * 0.06), y, Math.max(1, face * 0.06), face);
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * The water's own colour, and nothing else.
 *
 * Almost flat on purpose. The painted ripples that were here were the mistake:
 * highlights drawn *into* a texture stay in the same place on the surface no
 * matter where you stand, and a highlight that does not move when you do is the
 * one thing the eye reads instantly as paint. All that is left here is a slow
 * mottle, which is the water body varying in depth, and the actual glinting is
 * the normal map's job.
 */
function waterTexture(colour: string, maxAnisotropy: number): THREE.CanvasTexture {
  const size = 128;
  const random = rng(0x33fa);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, size, size);

  for (let blot = 0; blot < 18; blot += 1) {
    const x = random() * size;
    const y = random() * size;
    const radius = size * (0.1 + random() * 0.3);
    const wash = ctx.createRadialGradient(x, y, 0, x, y, radius);
    wash.addColorStop(0, random() > 0.5 ? "#ffffff" : "#000000");
    wash.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.04 + random() * 0.05;
    ctx.fillStyle = wash;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = maxAnisotropy;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The shape of the surface, as a normal map.
 *
 * This is what makes it water. A height field is summed from a handful of
 * sine waves crossing at different angles, then differenced into normals - so
 * the surface is genuinely tilted all over, and the five ceiling lamps break
 * across it into highlights that slide as you walk. Highlights that answer to
 * where you are standing are the difference between a liquid and a green sheet
 * of glass, and no amount of painted foam gets there.
 *
 * Every frequency is a whole number of cycles per tile, which is what makes the
 * field wrap: a sine that completes an exact number of turns across the tile
 * arrives back where it started at the edge. Cross-hatched frequencies rather
 * than one big wave, because two waves at an angle interfere, and interference
 * is why real water never shows you the same ripple twice.
 *
 * Written straight into an ImageData buffer - 16k pixels of trigonometry once,
 * at build time, and nothing per frame.
 */
function waterNormalTexture(chop: number, maxAnisotropy: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);

  const waves: readonly [number, number, number, number][] = [
    // x cycles, y cycles, amplitude, phase
    [1, 2, 1, 0],
    [3, -1, 0.55, 1.7],
    [-2, 3, 0.42, 0.4],
    [5, 2, 0.22, 2.2],
    [2, -5, 0.18, 1.1],
    [7, 3, 0.1, 0.8],
  ];

  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      for (const [fx, fy, amp, phase] of waves) {
        sum +=
          amp *
          Math.sin(
            Math.PI * 2 * ((fx * x) / size + (fy * y) / size) + phase,
          );
      }
      height[y * size + x] = sum;
    }
  }

  const at = (x: number, y: number) =>
    height[((y + size) % size) * size + ((x + size) % size)]!;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * chop;
      const dy = (at(x, y - 1) - at(x, y + 1)) * chop;
      const length = Math.hypot(dx, dy, 1);

      const index = (y * size + x) * 4;
      image.data[index] = ((dx / length) * 0.5 + 0.5) * 255;
      image.data[index + 1] = ((dy / length) * 0.5 + 0.5) * 255;
      image.data[index + 2] = (1 / length) * 0.5 * 255 + 127.5;
      image.data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

/**
 * Caustics: the net of light a rippled surface throws on the floor under it.
 *
 * The thing that was missing, and the reason the water still read as a coloured
 * sheet. A person identifies shallow water almost entirely by what it does to
 * the bottom - the wobbling bright net on the tiles is more diagnostic than the
 * surface itself, which is why a swimming pool is recognisable in a photograph
 * taken straight down.
 *
 * Derived from the same kind of wave field as the surface, because that is
 * where caustics physically come from: light refracts through the surface and
 * bunches up wherever the water is curved like a lens. So the brightness here
 * is the field's curvature - its second difference - rather than its height,
 * which is what puts the light in thin closed loops instead of in stripes.
 */
function causticTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);

  const waves: readonly [number, number, number, number][] = [
    [2, 1, 1, 0.6],
    [-1, 3, 0.7, 2.1],
    [3, -2, 0.5, 1.2],
    [4, 4, 0.3, 0.2],
  ];

  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      for (const [fx, fy, amp, phase] of waves) {
        sum +=
          amp *
          Math.sin(Math.PI * 2 * ((fx * x) / size + (fy * y) / size) + phase);
      }
      height[y * size + x] = sum;
    }
  }

  const at = (x: number, y: number) =>
    height[((y + size) % size) * size + ((x + size) % size)]!;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const curve =
        at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) - 4 * at(x, y);

      // only where the surface focuses light, and sharply
      const focus = Math.max(0, curve) * 1.6;
      const glow = Math.min(1, focus * focus * 0.5);

      const index = (y * size + x) * 4;
      image.data[index] = 255;
      image.data[index + 1] = 255;
      image.data[index + 2] = 255;
      image.data[index + 3] = glow * 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = maxAnisotropy;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A milled finish: fine speckle with a brush direction through it.
 *
 * The only motif here with no motif - nothing in it has a shape, a spacing or
 * an alignment, which is exactly why it survives being wrapped round a frame's
 * corners. Mipmapping does the rest: at a distance the speckle averages back to
 * the ground colour instead of shimmering, so it fades out rather than crawling.
 *
 * The streaks are what stop it looking like sandpaper. A brushed surface has a
 * direction, and half a dozen faint lines across the tile is enough to imply
 * one without anybody being able to point at them.
 */
function drawGrain(
  ctx: CanvasRenderingContext2D,
  motif: Motif,
  size: number,
): void {
  const random = rng(0x6f1a);

  for (let speck = 0; speck < 9000; speck += 1) {
    ctx.fillStyle = random() > 0.5 ? motif.ink : motif.accent;
    ctx.globalAlpha = 0.06 + random() * 0.16;
    ctx.fillRect(random() * size, random() * size, 1.5, 1);
  }

  for (let streak = 0; streak < 26; streak += 1) {
    const y = random() * size;
    ctx.strokeStyle = random() > 0.5 ? motif.ink : motif.accent;
    ctx.globalAlpha = 0.05 + random() * 0.07;
    ctx.lineWidth = 0.6 + random();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y + (random() - 0.5) * 3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/**
 * Warp and weft, crossing over and under.
 *
 * Drawn in three passes: every vertical thread, every horizontal thread on top
 * of them, then the vertical ones again but only on alternate squares. That
 * third pass is the whole illusion - it is what puts half the crossings back on
 * top and turns a grid into something interlaced.
 *
 * Threads are inset slightly from their cell so the ground shows between them.
 * A weave with no gaps is a chequerboard.
 */
function drawWeave(
  ctx: CanvasRenderingContext2D,
  motif: Motif,
  size: number,
): void {
  const cell = motif.cell / 4;
  const thread = cell * 0.74;
  const count = size / cell;

  for (let col = 0; col < count; col += 1) {
    ctx.fillStyle = motif.ink;
    ctx.fillRect(col * cell, 0, thread, size);
  }
  for (let row = 0; row < count; row += 1) {
    ctx.fillStyle = motif.accent;
    ctx.fillRect(0, row * cell, size, thread);
  }
  for (let col = 0; col < count; col += 1) {
    for (let row = 0; row < count; row += 1) {
      if ((col + row) % 2 !== 0) continue;
      ctx.fillStyle = motif.ink;
      ctx.fillRect(col * cell, row * cell, thread, thread);
    }
  }
}

/**
 * Parallel ribs, each shaded across itself.
 *
 * Trim that survives being stretched: a rib stretched along its own length is
 * still a rib, which is why this goes on the band round the ceiling where every
 * shaped motif was getting smeared.
 *
 * The gradient runs light on one side to dark on the other rather than
 * symmetrically, so the ribs read as rounded and lit from a consistent side -
 * shade them evenly and they look like painted lines.
 */
function drawFlutes(
  ctx: CanvasRenderingContext2D,
  motif: Motif,
  size: number,
): void {
  const cell = motif.cell / 2;
  for (let x = 0; x < size; x += cell) {
    const shade = ctx.createLinearGradient(x, 0, x + cell, 0);
    shade.addColorStop(0, motif.ink);
    shade.addColorStop(0.35, motif.ground);
    shade.addColorStop(0.7, motif.accent);
    shade.addColorStop(1, motif.ink);
    ctx.fillStyle = shade;
    ctx.fillRect(x, 0, cell, size);
  }
}

/**
 * The ogee lattice: the bones of every damask wallpaper.
 *
 * Two families of arcs crossing into tall pointed ovals, with a small mark left
 * in the middle of each. Old wallpaper is built exactly this way - the lattice
 * carries the rhythm and whatever is drawn inside it carries the style - and
 * the lattice alone is enough at the contrast a dark room allows, because
 * nobody has ever seen the detail of a damask by candlelight anyway.
 *
 * Four columns of arcs across the tile with alternate rows offset by half a
 * column, which is the same staggered lattice as the scales but drawn as
 * outlines that meet rather than as discs that overlap. It tiles because both
 * the column pitch and the row pitch divide the tile.
 */
function drawOgee(
  ctx: CanvasRenderingContext2D,
  motif: Motif,
  size: number,
): void {
  const cell = motif.cell;
  const half = cell / 2;

  ctx.lineWidth = Math.max(1, cell * 0.05);
  ctx.lineCap = "round";

  let row = 0;
  for (let y = -cell; y <= size + cell; y += cell) {
    const shift = row % 2 === 0 ? 0 : half;
    for (let x = -cell; x <= size + cell; x += cell) {
      const cx = x + shift;

      /*
        One oval, drawn as four quarter-arcs struck from the corners of its own
        cell. Arcs from the corners is what makes the top and bottom come to a
        point instead of a curve - the point is the whole difference between an
        ogee and an ellipse.
      */
      ctx.strokeStyle = motif.ink;
      for (const [ox, oy, from] of [
        [-half, 0, -Math.PI / 2],
        [half, 0, 0],
      ] as const) {
        ctx.beginPath();
        ctx.arc(cx + ox, y + oy, half, from, from + Math.PI / 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + ox, y + oy, half, from - Math.PI / 2, from);
        ctx.stroke();
      }

      // the mark in the middle: a bud, at the scale a bud survives
      ctx.fillStyle = motif.accent;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.ellipse(cx, y, cell * 0.07, cell * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    row += 1;
  }
}

/**
 * Hexagonal cells, the way cooling basalt cracks.
 *
 * The lattice is fitted to the tile rather than the other way round: three
 * columns and five rows come out within a few percent of regular hexagons on a
 * square canvas, and a few percent is nothing on a wall. Trying to keep them
 * exactly regular would leave a fractional cell at one edge, which is the one
 * error a lattice cannot hide.
 *
 * Drawn as outlines with a faint fill on alternating cells, because a
 * honeycomb of filled shapes at wall scale is a pattern and a honeycomb of
 * lines is a texture.
 */
function drawCells(
  ctx: CanvasRenderingContext2D,
  motif: Motif,
  size: number,
): void {
  const cols = 3;
  const rows = 5;
  const stepX = size / cols;
  const stepY = size / rows;
  const radius = stepX * 0.58;

  ctx.lineWidth = Math.max(1, size * 0.006);
  ctx.strokeStyle = motif.ink;
  ctx.fillStyle = motif.accent;

  const hexagon = (cx: number, cy: number) => {
    ctx.beginPath();
    for (let corner = 0; corner < 6; corner += 1) {
      const angle = (Math.PI / 3) * corner;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius * (stepY / (stepX * 0.866));
      if (corner === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };

  for (let row = -1; row <= rows + 1; row += 1) {
    for (let col = -1; col <= cols + 1; col += 1) {
      const cx = col * stepX + (row % 2 === 0 ? 0 : stepX / 2);
      const cy = row * stepY;

      if ((row + col) % 3 === 0) {
        ctx.globalAlpha = 0.5;
        hexagon(cx, cy);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      hexagon(cx, cy);
      ctx.stroke();
    }
  }
}

/**
 * Overlapping arcs - waves, roof tiles, fish scales, the same shape each time.
 *
 * Rows are half a cell apart and every other one is offset by half a cell, so
 * each arc sits in the gap between the two above it. Drawn top to bottom, so a
 * row laps over the one before it the way tiles do, and the whole vertical
 * period comes to one cell.
 */
function drawScales(
  ctx: CanvasRenderingContext2D,
  motif: Motif,
  size: number,
): void {
  const cell = motif.cell;
  const radius = cell * 0.5;
  ctx.lineWidth = Math.max(1, cell * 0.045);

  let row = 0;
  for (let y = -cell; y <= size + cell; y += radius) {
    const shift = row % 2 === 0 ? 0 : radius;
    for (let x = -cell; x <= size + cell; x += cell) {
      const cx = x + shift;

      ctx.beginPath();
      ctx.arc(cx, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = motif.ground;
      ctx.fill();

      for (let ring = 3; ring >= 1; ring -= 1) {
        ctx.beginPath();
        ctx.arc(cx, y, (radius * ring) / 3, Math.PI, Math.PI * 2);
        ctx.strokeStyle = ring === 3 ? motif.accent : motif.ink;
        ctx.stroke();
      }
    }
    row += 1;
  }
}

/**
 * Chipped stone, scattered rather than placed.
 *
 * The one motif here with no lattice, which is why the rug gets it: a rug is
 * the largest patterned surface in the room and a regular grid across it would
 * announce every repeat. Each chip is drawn nine times, once per neighbouring
 * tile, so the ones that fall off an edge come back on the other side whole.
 */
function drawPebbles(
  ctx: CanvasRenderingContext2D,
  motif: Motif,
  size: number,
): void {
  const random = rng(0x9eb1);
  const tones = [motif.ink, motif.accent, motif.ground];

  for (let chip = 0; chip < 90; chip += 1) {
    const x = random() * size;
    const y = random() * size;
    const long = motif.cell * (0.16 + random() * 0.3);
    const short = long * (0.5 + random() * 0.4);
    const spin = random() * Math.PI;
    ctx.fillStyle = tones[Math.floor(random() * tones.length)]!;
    ctx.globalAlpha = 0.55 + random() * 0.35;

    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        ctx.beginPath();
        ctx.ellipse(x + dx, y + dy, long, short, spin, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * A staggered field of dots, the way a map shades sand.
 *
 * Two sizes alternating rather than one, because a single dot repeated at a
 * fixed pitch reads as perforation. The offset rows put every dot in the gap
 * between two others, which is the densest a field can be while still looking
 * scattered.
 */
function drawStipple(
  ctx: CanvasRenderingContext2D,
  motif: Motif,
  size: number,
): void {
  const cell = motif.cell;
  let row = 0;
  for (let y = 0; y < size; y += cell) {
    const shift = row % 2 === 0 ? 0 : cell / 2;
    for (let x = 0; x < size; x += cell) {
      const big = (row + x / cell) % 2 === 0;
      const radius = cell * (big ? 0.13 : 0.075);
      ctx.fillStyle = big ? motif.ink : motif.accent;

      for (const dx of [-size, 0, size]) {
        ctx.beginPath();
        ctx.arc(x + shift + dx, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    row += 1;
  }
}

function rockerTilt(on: boolean): number {
  return on ? -SWITCH.tilt : SWITCH.tilt;
}

function weld(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  return merged;
}

function rounded(
  width: number,
  height: number,
  depth: number,
  radius: number,
): THREE.BufferGeometry {
  const safe = Math.min(radius, Math.min(width, height, depth) / 2 - 1e-4);
  return new RoundedBoxGeometry(width, height, depth, ROUND.segments, safe);
}

/**
 * A flat rectangle with its corners taken off, mapped edge to edge.
 *
 * `ShapeGeometry` lays UVs straight out of the vertex positions, which for a
 * shape built around the origin means texture coordinates running from −w/2 to
 * +w/2 - video mapped through that arrives cropped, mirrored and mostly
 * offscreen. So the UVs are rewritten from the positions afterwards, which is
 * also the only way to get a picture to sit correctly on a shape whose
 * outline is not its own bounding box.
 *
 * Built at real size rather than as a unit square that gets scaled, because a
 * scaled square turns its rounded corners into ellipses the moment the video is
 * not the shape of the screen.
 */
function roundedRectShape(
  width: number,
  height: number,
  radius: number,
): THREE.Shape {
  const r = Math.min(radius, Math.min(width, height) / 2 - 1e-4);
  const halfW = width / 2;
  const halfH = height / 2;

  const shape = new THREE.Shape();
  shape.moveTo(-halfW + r, -halfH);
  shape.lineTo(halfW - r, -halfH);
  shape.quadraticCurveTo(halfW, -halfH, halfW, -halfH + r);
  shape.lineTo(halfW, halfH - r);
  shape.quadraticCurveTo(halfW, halfH, halfW - r, halfH);
  shape.lineTo(-halfW + r, halfH);
  shape.quadraticCurveTo(-halfW, halfH, -halfW, halfH - r);
  shape.lineTo(-halfW, -halfH + r);
  shape.quadraticCurveTo(-halfW, -halfH, -halfW + r, -halfH);
  return shape;
}

/**
 * Rewrites a shape-derived geometry's UVs to run 0-1 across its own extent.
 *
 * Both `ShapeGeometry` and `ExtrudeGeometry` lay UVs straight out of vertex
 * positions, so a shape built around the origin produces texture coordinates
 * running from −w/2 to +w/2 - a video mapped through that arrives cropped and
 * mostly offscreen, and a pattern arrives at whatever scale the metre happens
 * to be. Every shape-built surface here goes through this.
 */
function normalizeUv(
  geometry: THREE.BufferGeometry,
  width: number,
  height: number,
): THREE.BufferGeometry {
  const position = geometry.attributes.position!;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    uv[i * 2] = (position.getX(i) + width / 2) / width;
    uv[i * 2 + 1] = (position.getY(i) + height / 2) / height;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geometry;
}

function roundedPlane(
  width: number,
  height: number,
  radius: number,
): THREE.BufferGeometry {
  const shape = roundedRectShape(width, height, radius);
  return normalizeUv(new THREE.ShapeGeometry(shape, 8), width, height);
}

/**
 * The same outline, given depth - a panel rather than a sheet.
 *
 * Extruded rather than built as a rounded box, because a rounded box rounds
 * every edge it has, including the ones running through its thickness, and
 * three.js therefore clamps its radius to half the depth. The frame here is 9 cm
 * deep, which capped the corner at 4.5 cm no matter what was asked for - and
 * the corner has to be free to match the screen's, which is set by the picture
 * and not by how thick the frame is. Extruding a flat outline leaves the front
 * face's corners under our control and its edges square, which is what the edge
 * of a panel looks like anyway.
 */
function roundedSlab(
  width: number,
  height: number,
  depth: number,
  radius: number,
  hole?: { width: number; height: number; radius: number },
): THREE.BufferGeometry {
  const shape = roundedRectShape(width, height, radius);
  /*
    A hole makes it a frame rather than a slab, and gives it an inside.

    Extruding a shape with a hole builds side walls around the opening as well
    as around the outside - which is the surface you see when you look at a
    television from an angle, and the reason the panel behind it reads as held
    rather than as floating in front.
  */
  if (hole) {
    shape.holes.push(roundedRectShape(hole.width, hole.height, hole.radius));
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 8,
  });
  geometry.translate(0, 0, -depth / 2);
  return normalizeUv(geometry, width, height);
}

function block(
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(x, y, z);
  return geometry;
}

export class LoungeScene {
  readonly root = new THREE.Group();

  readonly picture: THREE.Mesh;
  readonly seat: THREE.Mesh;
  readonly crowd = new Crowd();

  readonly switches: THREE.Mesh[] = [];
  readonly button: THREE.Mesh;

  private readonly pictureMaterial: THREE.MeshBasicMaterial;
  private readonly glow: THREE.PointLight;
  private readonly spinner: THREE.Mesh;

  private readonly lamps: THREE.PointLight[] = [];
  private readonly rockers: THREE.Mesh[] = [];
  private readonly discs: THREE.MeshStandardMaterial[] = [];
  private readonly fill: THREE.HemisphereLight;
  private readonly ambient: THREE.AmbientLight;
  private readonly on: boolean[] = LAMPS.map((lamp) => lamp.on);
  private readonly tint = new THREE.Color(1, 1, 1);
  private tintLevel = 0;
  private showing = false;
  private readonly anomaly = new Anomaly();
  private buttonPush = 0;
  private buttonRestZ = 0;
  private failing = false;

  /**
   * Kept, because a room is repainted while it runs as well as when it is
   * built.
   *
   * The lamps, the ceiling discs, the bounced fill and the screen glow are all
   * set again every time a switch is thrown, the anomaly runs, or the picture
   * changes what it throws into the room - and each of those reaches for the
   * same colours the constructor used.
   */
  private readonly paint: Palette;

  private stage: THREE.Scene | null = null;
  private haze: THREE.Fog | null = null;
  private backdrop: THREE.Color | null = null;

  /** The water's layers and how fast they drift, for styles that have water. */
  private waterMap: THREE.Texture | null = null;
  private waterSurface: THREE.Texture | null = null;
  private causticMap: THREE.Texture | null = null;
  private caustics: THREE.MeshBasicMaterial | null = null;
  private waterDrift = 0;
  /** How far through the flicker cycle the candles are. */
  private flame = 0;

  private readonly textures: THREE.Texture[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(
    renderer: THREE.WebGLRenderer,
    paint: Palette,
    scene?: THREE.Scene,
  ) {
    this.paint = paint;

    /*
      The room's atmosphere, dimmed with the room.

      Fog is applied to a fragment after it has been shaded, so a fixed fog
      colour is a floor on how dark anything distant can ever get - switch every
      lamp off in a room with pale fog and the far walls stay pale, which is
      exactly backwards. Owned here, it can follow the lights: `refreshFill`
      scales it by how much of the room is lit, and the background with it.
    */
    if (scene) {
      this.stage = scene;
      this.haze = new THREE.Fog(paint.fog, 8, 30);
      this.backdrop = new THREE.Color(paint.fog);
      scene.fog = this.haze;
      scene.background = this.backdrop;
    }

    const aniso = Math.min(
      VIEW.maxAnisotropy,
      renderer.capabilities.getMaxAnisotropy(),
    );
    const spanX = WORLD.halfX * 2;
    const spanZ = WORLD.halfZ * 2;

    /*
      The floor's tile size and roughness come from the style, not from here.

      Boards are laid at two metres and scatter what lands on them; a stone
      slab is cut three times that and holds a highlight. Both are properties of
      the material rather than of the room, and the room is the same room.
    */
    const floorTex = floorTexture(
      paint.floor,
      aniso,
      spanX / paint.floor.tile,
      spanZ / paint.floor.tile,
    );
    this.textures.push(floorTex);

    const floorMat = this.own(
      new THREE.MeshStandardMaterial({
        map: floorTex,
        roughness: paint.floor.roughness,
        metalness: 0,
      }),
    );
    /*
      Two wall materials where there was one.

      The long walls are fourteen metres across and the short ones eleven, and a
      single texture stretched over both leaves the cells visibly wider on one
      pair. Two materials, each sized to its own wall, cost nothing here: these
      were already separate meshes, so nothing was being batched that this
      breaks.
    */
    const wallPattern = paint.patterns?.walls ?? null;
    const wallMat = this.own(
      new THREE.MeshStandardMaterial({
        color: wallPattern ? "#ffffff" : paint.walls.side,
        map: wallPattern
          ? this.keep(surfaceTexture(wallPattern, spanX, WORLD.height, aniso))
          : null,
        roughness: 0.95,
        metalness: 0,
      }),
    );
    const wallSideMat = this.own(
      new THREE.MeshStandardMaterial({
        color: wallPattern ? "#ffffff" : paint.walls.side,
        map: wallPattern
          ? this.keep(surfaceTexture(wallPattern, spanZ, WORLD.height, aniso))
          : null,
        roughness: 0.95,
        metalness: 0,
      }),
    );
    const trimMat = this.own(
      new THREE.MeshStandardMaterial({
        color: paint.walls.trim,
        roughness: 0.55,
        metalness: 0,
      }),
    );
    const screenPattern = paint.patterns?.screenWall ?? null;
    const screenWallMat = this.own(
      new THREE.MeshStandardMaterial({
        color: screenPattern ? "#ffffff" : paint.walls.screen,
        map: screenPattern
          ? this.keep(surfaceTexture(screenPattern, spanX, WORLD.height, aniso))
          : null,
        roughness: 1,
        metalness: 0,
      }),
    );
    const ceilPattern = paint.patterns?.ceiling ?? null;
    const ceilMat = this.own(
      new THREE.MeshStandardMaterial({
        color: ceilPattern ? "#ffffff" : paint.walls.ceiling,
        map: ceilPattern
          ? this.keep(surfaceTexture(ceilPattern, spanX, spanZ, aniso))
          : null,
        roughness: 1,
        metalness: 0,
      }),
    );
    /*
      The band is one welded geometry with box UVs, so every face shares a
      single repeat - and its faces are wildly different shapes. Sized off the
      underside, which is the face anybody actually sees; the 10 cm inner edge
      gets the same motif stretched, at a scale where it reads as a texture
      rather than as anything you could pick out.
    */
    const soffitPattern = paint.patterns?.soffit ?? null;
    const soffitMat = this.own(
      new THREE.MeshStandardMaterial({
        color: soffitPattern ? "#ffffff" : paint.walls.soffit,
        map: soffitPattern
          ? this.keep(
              surfaceTexture(soffitPattern, spanX, ROOM.soffitReach, aniso),
            )
          : null,
        roughness: 0.9,
        metalness: 0,
      }),
    );
    const floorGeo = this.ownGeo(new THREE.PlaneGeometry(spanX, spanZ));
    const wallXGeo = this.ownGeo(new THREE.PlaneGeometry(spanX, WORLD.height));
    const wallZGeo = this.ownGeo(new THREE.PlaneGeometry(spanZ, WORLD.height));

    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.root.add(floor);

    // A style with no rug is a floor worth leaving uncovered - nothing to build.
    if (paint.rug) {
      const rugTex = rugTexture(paint.rug, paint.patterns?.rug ?? null, aniso);
      this.textures.push(rugTex);
      const rugMat = this.own(
        new THREE.MeshStandardMaterial({
          map: rugTex,
          roughness: 0.98,
          metalness: 0,
        }),
      );
      const rugGeo = this.ownGeo(
        new THREE.PlaneGeometry(COUCH.width, ROOM.rugDepth),
      );
      const rug = new THREE.Mesh(rugGeo, rugMat);
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(COUCH.x, ROOM.rugLift, ROOM.rugZ);
      this.root.add(rug);
    }

    const ceiling = new THREE.Mesh(floorGeo, ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = WORLD.height;
    this.root.add(ceiling);

    const front = new THREE.Mesh(wallXGeo, screenWallMat);
    front.position.set(0, WORLD.height / 2, -WORLD.halfZ);
    this.root.add(front);

    const back = new THREE.Mesh(wallXGeo, wallMat);
    back.position.set(0, WORLD.height / 2, WORLD.halfZ);
    back.rotation.y = Math.PI;
    this.root.add(back);

    const left = new THREE.Mesh(wallZGeo, wallSideMat);
    left.position.set(-WORLD.halfX, WORLD.height / 2, 0);
    left.rotation.y = Math.PI / 2;
    this.root.add(left);

    const right = new THREE.Mesh(wallZGeo, wallSideMat);
    right.position.set(WORLD.halfX, WORLD.height / 2, 0);
    right.rotation.y = -Math.PI / 2;
    this.root.add(right);

    const skirtY = ROOM.skirtY / 2;
    const skirtX = WORLD.halfX - ROOM.skirtDepth / 2;
    const skirtZ = WORLD.halfZ - ROOM.skirtDepth / 2;
    const trim = weld([
      block(spanX, ROOM.skirtY, ROOM.skirtDepth, 0, skirtY, -skirtZ),
      block(spanX, ROOM.skirtY, ROOM.skirtDepth, 0, skirtY, skirtZ),
      block(ROOM.skirtDepth, ROOM.skirtY, spanZ, -skirtX, skirtY, 0),
      block(ROOM.skirtDepth, ROOM.skirtY, spanZ, skirtX, skirtY, 0),
    ]);
    this.root.add(new THREE.Mesh(this.ownGeo(trim), trimMat));

    const soffit: THREE.BufferGeometry[] = [];
    const soffitY = WORLD.height - ROOM.soffitDrop / 2;
    const soffitZ = WORLD.halfZ - ROOM.soffitReach / 2;
    const soffitX = WORLD.halfX - ROOM.soffitReach / 2;
    const sideSpan = spanZ - ROOM.soffitReach * 2;
    soffit.push(block(spanX, ROOM.soffitDrop, ROOM.soffitReach, 0, soffitY, -soffitZ));
    soffit.push(block(spanX, ROOM.soffitDrop, ROOM.soffitReach, 0, soffitY, soffitZ));
    soffit.push(block(ROOM.soffitReach, ROOM.soffitDrop, sideSpan, -soffitX, soffitY, 0));
    soffit.push(block(ROOM.soffitReach, ROOM.soffitDrop, sideSpan, soffitX, soffitY, 0));
    this.root.add(new THREE.Mesh(this.ownGeo(weld(soffit)), soffitMat));

    const discGeo = this.ownGeo(new THREE.CircleGeometry(ROOM.lampRadius, 16));
    discGeo.rotateX(Math.PI / 2);
    /*
      A fitting that emits when it is on, and is just a surface when it is not.

      These were `MeshBasicMaterial`, which is unlit - it draws its colour at
      full strength whatever the room is doing. So a lamp that had been switched
      off still put a pale disc on the ceiling of a pitch-dark room: the light
      was genuinely at zero, but the fitting was still glowing on its own
      account, which is not a thing an unpowered light does.

      A standard material with an emissive colour separates the two. `color` is
      what the fitting is made of and answers to the room's light like the
      ceiling around it; `emissive` is what it is putting out, and switching it
      off means setting that to nothing. Off in a dark room, it disappears. Off
      in a lit room, it is a dull disc - which is exactly what an unlit fitting
      looks like from below.
    */
    for (const lamp of LAMPS) {
      const material = this.own(
        new THREE.MeshStandardMaterial({
          color: paint.lamps.off,
          emissive: new THREE.Color(paint.lamps.on),
          emissiveIntensity: lamp.on ? 1 : 0,
          roughness: 0.45,
          metalness: 0,
          toneMapped: false,
        }),
      ) as THREE.MeshStandardMaterial;
      const disc = new THREE.Mesh(discGeo, material);
      disc.position.set(
        lamp.x * WORLD.halfX,
        WORLD.height - 0.008,
        lamp.z * WORLD.halfZ,
      );
      this.root.add(disc);
      this.discs.push(material);
    }

    const wallFace = -WORLD.halfZ + SCREEN.standoff;

    /*
      The frame's corner is the screen's corner plus the frame's own width.

      That sum is the whole rule, and it is what makes a border look like a
      border: the inner and outer curves are then concentric, so the frame is
      the same thickness the whole way round. Give the two edges the same radius
      instead and the corners pinch; give the outer one its own number and the
      frame fattens or thins as it turns.
    */
    const bezelGeo = this.ownGeo(
      roundedSlab(
        SCREEN.width + SCREEN.bezel * 2,
        SCREEN.height + SCREEN.bezel * 2,
        SCREEN.depth,
        SCREEN.corner + SCREEN.bezel,
        {
          /*
            The opening is a little smaller than the panel behind it, so the
            frame laps over its edge instead of meeting it exactly. Two
            surfaces that end on the same line leave a hairline of whatever is
            behind them, and at this size a hairline is a lit crack around the
            picture.
          */
          width: SCREEN.width - SCREEN.overlap * 2,
          height: SCREEN.height - SCREEN.overlap * 2,
          radius: Math.max(0.001, SCREEN.corner - SCREEN.overlap),
        },
      ),
    );
    /*
      The bezel, banded.

      The map carries the colour, so the material's own colour goes white -
      three.js multiplies the two, and leaving the bezel's pink in place would
      tint the bands a second time. Repeated four times around: the frame is
      long and thin, and one repeat across that stretches each band into a
      smear.
    */
    const bezelPattern = paint.patterns?.bezel
      ? this.keep(
          surfaceTexture(
            paint.patterns.bezel,
            SCREEN.width + SCREEN.bezel * 2,
            SCREEN.height + SCREEN.bezel * 2,
            aniso,
          ),
        )
      : null;

    const bezelMat = this.own(
      new THREE.MeshStandardMaterial({
        color: bezelPattern ? "#ffffff" : paint.screen.bezel,
        map: bezelPattern,
        roughness: 0.4,
        metalness: 0.3,
      }),
    );
    const bezel = new THREE.Mesh(bezelGeo, bezelMat);
    bezel.position.set(0, SCREEN.centreY, wallFace + SCREEN.depth / 2);
    this.root.add(bezel);

    /*
      The dead area of the panel, behind the picture.

      The picture plane is scaled to whatever the video's aspect is, so anything
      that is not 16:9 leaves part of the screen uncovered - and what showed
      through was the bezel's front face, which meant a 4:3 clip appeared to
      have grown two extra inches of bezel down its sides. A real panel does not
      change size to suit its content; it puts black bars in the space.

      Full screen size, black, sitting at the bottom of the frame's opening -
      wider than the opening, so its edges are covered by the frame that laps
      over them. Black rather than something from the palette, because this is
      the same surface as a screen with nothing playing on it, and that is
      already black in every room.
    */
    const matte = new THREE.Mesh(
      this.ownGeo(
        roundedPlane(SCREEN.width, SCREEN.height, SCREEN.corner),
      ),
      this.own(
        new THREE.MeshBasicMaterial({ color: "#000000", toneMapped: false }),
      ),
    );
    /* The panel's face: `recess` back from the front of the frame. */
    const panelZ = wallFace + SCREEN.depth - SCREEN.recess;
    matte.position.set(0, SCREEN.centreY, panelZ);
    this.root.add(matte);

    this.pictureMaterial = this.own(
      new THREE.MeshBasicMaterial({ color: "#000000", toneMapped: false }),
    ) as THREE.MeshBasicMaterial;

    this.picture = new THREE.Mesh(
      roundedPlane(SCREEN.width, SCREEN.height, SCREEN.corner),
      this.pictureMaterial,
    );
    // just off the matte, which is all the separation two coplanar planes need
    this.picture.position.set(0, SCREEN.centreY, panelZ + SCREEN.lift * 0.4);
    this.root.add(this.picture);

    this.spinner = new THREE.Mesh(
      this.ownGeo(
        new THREE.RingGeometry(
          SCREEN.loaderRadius - SCREEN.loaderWidth,
          SCREEN.loaderRadius,
          48,
          1,
          0,
          Math.PI * 1.5,
        ),
      ),
      this.own(
        new THREE.MeshBasicMaterial({
          color: paint.screen.spinner,
          toneMapped: false,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
        }),
      ),
    );
    this.spinner.position.set(0, SCREEN.centreY, panelZ + SCREEN.lift * 0.8);
    this.spinner.visible = false;
    this.root.add(this.spinner);

    this.glow = new THREE.PointLight(paint.screen.glow, 0, SCREEN.glowDistance, 2);
    this.glow.position.set(0, SCREEN.centreY, wallFace + 1.2);
    this.root.add(this.glow);

    const couchPattern = paint.patterns?.couch ?? null;
    const fabric = this.own(
      new THREE.MeshStandardMaterial({
        color: couchPattern ? "#ffffff" : paint.couch.frame,
        map: couchPattern
          ? this.keep(
              surfaceTexture(couchPattern, COUCH.width, COUCH.backY, aniso),
            )
          : null,
        roughness: 0.92,
        metalness: 0,
      }),
    );
    const cushion = this.own(
      new THREE.MeshStandardMaterial({
        color: paint.couch.cushion,
        roughness: 0.88,
        metalness: 0,
      }),
    );

    const couch = new THREE.Group();
    couch.position.set(COUCH.x, 0, COUCH.z);
    this.root.add(couch);

    const baseHeight = COUCH.seatY - 0.1;
    const baseGeo = this.ownGeo(
      rounded(COUCH.width, baseHeight, COUCH.depth, ROUND.couchBase),
    );
    const base = new THREE.Mesh(baseGeo, fabric);
    base.position.y = baseHeight / 2;
    couch.add(base);

    const seatGeo = this.ownGeo(
      rounded(
        COUCH.width - COUCH.armWidth * 2,
        0.12,
        COUCH.depth - COUCH.backDepth,
        ROUND.cushion,
      ),
    );
    this.seat = new THREE.Mesh(seatGeo, cushion);
    this.seat.position.set(0, COUCH.seatY - 0.05, -COUCH.backDepth / 2);
    couch.add(this.seat);

    const backGeo = this.ownGeo(
      rounded(COUCH.width, COUCH.backY, COUCH.backDepth, ROUND.backrest),
    );
    const backrest = new THREE.Mesh(backGeo, fabric);
    backrest.position.set(
      0,
      COUCH.backY / 2,
      COUCH.depth / 2 - COUCH.backDepth / 2,
    );
    couch.add(backrest);

    const armGeo = this.ownGeo(
      rounded(COUCH.armWidth, COUCH.armY, COUCH.depth, ROUND.arm),
    );
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, fabric);
      arm.position.set(
        (side * (COUCH.width - COUCH.armWidth)) / 2,
        COUCH.armY / 2,
        0,
      );
      couch.add(arm);
    }

    /*
      The stool, and the remote nobody put away.

      Built out of ±1 loops rather than four written-out leg positions, so the
      symmetry is a property of the arithmetic and not of four numbers staying
      in agreement. The legs are welded into a single geometry - they share a
      material and never move independently, so four meshes would only be four
      draw calls.

      Not in `fixtures`, deliberately: it is scenery. The raycast that decides
      what the crosshair is pointing at only walks the things you can actually
      do something with, and a table you cannot use should not be quietly
      stealing the aim from the screen behind it.
    */
    const stoolPattern = paint.patterns?.stool
      ? motifTexture(paint.patterns.stool, aniso)
      : null;
    if (stoolPattern) this.textures.push(stoolPattern);

    const stoolTopMat = this.own(
      new THREE.MeshStandardMaterial({
        color: stoolPattern ? "#ffffff" : paint.stool.top,
        map: stoolPattern,
        roughness: 0.55,
        metalness: 0,
      }),
    );
    const stoolLegMat = this.own(
      new THREE.MeshStandardMaterial({
        color: paint.stool.leg,
        roughness: 0.7,
        metalness: 0,
      }),
    );

    const stool = new THREE.Group();
    stool.position.set(COUCH.x, 0, STOOL.z);
    this.root.add(stool);

    const topY = STOOL.height - STOOL.topThickness / 2;
    const top = new THREE.Mesh(
      this.ownGeo(
        rounded(STOOL.width, STOOL.topThickness, STOOL.depth, STOOL.radius),
      ),
      stoolTopMat,
    );
    top.position.y = topY;
    stool.add(top);

    const legHeight = STOOL.height - STOOL.topThickness;
    const legX = STOOL.width / 2 - STOOL.legInset - STOOL.legSize / 2;
    const legZ = STOOL.depth / 2 - STOOL.legInset - STOOL.legSize / 2;
    const legs: THREE.BufferGeometry[] = [];
    for (const sideX of [-1, 1]) {
      for (const sideZ of [-1, 1]) {
        legs.push(
          block(
            STOOL.legSize,
            legHeight,
            STOOL.legSize,
            sideX * legX,
            legHeight / 2,
            sideZ * legZ,
          ),
        );
      }
    }
    stool.add(new THREE.Mesh(this.ownGeo(weld(legs)), stoolLegMat));

    const remote = new THREE.Group();
    remote.position.set(0, STOOL.height + REMOTE.thickness / 2, 0);
    remote.rotation.y = REMOTE.yaw;
    stool.add(remote);

    remote.add(
      new THREE.Mesh(
        this.ownGeo(
          rounded(
            REMOTE.width,
            REMOTE.thickness,
            REMOTE.length,
            REMOTE.radius,
          ),
        ),
        this.own(
          new THREE.MeshStandardMaterial({
            color: paint.stool.remote,
            roughness: 0.45,
            metalness: 0,
          }),
        ),
      ),
    );

    const keys: THREE.BufferGeometry[] = [];
    const keyTop = REMOTE.thickness / 2;
    for (let row = 0; row < REMOTE.keyRows; row += 1) {
      const z = (row - (REMOTE.keyRows - 1) / 2) * REMOTE.keyGap;
      for (const sideX of [-1, 1]) {
        keys.push(
          block(
            REMOTE.keySize,
            REMOTE.keySize / 3,
            REMOTE.keySize,
            (sideX * REMOTE.keyGap) / 2,
            keyTop,
            z,
          ),
        );
      }
    }
    remote.add(
      new THREE.Mesh(
        this.ownGeo(weld(keys)),
        this.own(
          new THREE.MeshStandardMaterial({
            color: paint.stool.keys,
            roughness: 0.5,
            metalness: 0,
          }),
        ),
      ),
    );

    /*
      The water: one plane, ankle deep, drifting.

      Deliberately not a volume. There is no swimming here, no buoyancy and no
      collision - you walk through it - and for water this shallow that is
      indistinguishable from the real thing until somebody tries to sit down in
      it. Transparent because the level's water is clear: what makes it read as
      water is seeing the grout lines through it, not the colour on top.

      `depthWrite` off so the tile below is not cut away by it, and rendered
      after everything else so the transparency sorts correctly against the
      couch legs standing in it.
    */
    if (paint.water) {
      const acrossX = (WORLD.halfX * 2) / paint.water.ripple;
      const acrossZ = (WORLD.halfZ * 2) / paint.water.ripple;

      const sheet = this.keep(waterTexture(paint.water.colour, aniso));
      sheet.repeat.set(acrossX, acrossZ);

      /*
        The surface repeats at a different size from the colour, and drifts at a
        different speed.

        Two layers sliding together at the same rate is a conveyor belt - the
        eye locks onto the pattern and watches it travel. Detuned, neither layer
        can be followed: the crests arrive at different moments and what you see
        is the interference, which is what a real surface does.
      */
      const surface = this.keep(
        waterNormalTexture(paint.water.chop, aniso),
      ) as THREE.CanvasTexture;
      surface.repeat.set(acrossX * 1.7, acrossZ * 1.7);

      this.waterMap = sheet;
      this.waterSurface = surface;
      this.waterDrift = paint.water.drift / paint.water.ripple;

      /*
        The light the water throws down, drawn on the floor rather than on the
        water.

        Additive, unlit and just above the tiles, so it adds brightness to
        whatever is under it instead of being a grey film over it. Its opacity
        follows the lamps - see `refreshFill` - because caustics are made of
        light, and a pool that keeps glowing after the room goes dark is a
        swimming pool in a horror film.
      */
      const causticMap = this.keep(causticTexture(aniso));
      causticMap.repeat.set(acrossX * 0.8, acrossZ * 0.8);
      this.causticMap = causticMap;
      this.caustics = this.own(
        new THREE.MeshBasicMaterial({
          map: causticMap,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      ) as THREE.MeshBasicMaterial;

      const lit = new THREE.Mesh(
        this.ownGeo(new THREE.PlaneGeometry(WORLD.halfX * 2, WORLD.halfZ * 2)),
        this.caustics,
      );
      lit.rotation.x = -Math.PI / 2;
      lit.position.y = 0.004;
      lit.renderOrder = 1;
      this.root.add(lit);

      const pool = new THREE.Mesh(
        this.ownGeo(new THREE.PlaneGeometry(WORLD.halfX * 2, WORLD.halfZ * 2)),
        this.own(
          new THREE.MeshStandardMaterial({
            map: sheet,
            normalMap: surface,
            normalScale: new THREE.Vector2(0.7, 0.7),
            transparent: true,
            opacity: paint.water.opacity,
            depthWrite: false,
            /* Wet, not damp: a tight highlight is most of what says liquid. */
            roughness: 0.04,
            metalness: 0,
          }),
        ),
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = paint.water.depth;
      pool.renderOrder = 2;
      this.root.add(pool);
    }

    this.root.add(this.crowd.root);

    this.fill = new THREE.HemisphereLight(paint.fill.sky, paint.fill.ground, 0);
    this.ambient = new THREE.AmbientLight("#ffffff", 0);
    this.root.add(this.fill);
    this.root.add(this.ambient);

    for (const lamp of LAMPS) {
      const light = new THREE.PointLight(
        paint.lamps.light,
        lamp.on ? LIGHTS.lamp * paint.lamps.power : 0,
        WORLD.halfX * 2,
        2,
      );
      light.position.set(
        lamp.x * WORLD.halfX,
        WORLD.height - ROOM.lampDrop,
        lamp.z * WORLD.halfZ,
      );
      this.root.add(light);
      this.lamps.push(light);
    }
    this.refreshFill();

    /*
      The plate's size is worked out here rather than reused from below, because
      the material has to exist before the geometry that wears it - and the
      grain has to be sized to the real plate or it lands at whatever scale the
      default repeat happens to give. Same two expressions as the geometry uses;
      both come from the lamp count.
    */
    const plateSpanW =
      (LAMPS.length - 1) * SWITCH.pitch +
      SWITCH.rockerW +
      SWITCH.gap * 2 +
      SWITCH.border * 2;
    const plateSpanH = SWITCH.rockerH + SWITCH.gap * 2 + SWITCH.border * 2;

    const platePattern = paint.patterns?.plate
      ? this.keep(
          surfaceTexture(paint.patterns.plate, plateSpanW, plateSpanH, aniso),
        )
      : null;
    const plateMat = this.own(
      new THREE.MeshStandardMaterial({
        color: platePattern ? "#ffffff" : paint.fixtures.plate,
        map: platePattern,
        roughness: 0.6,
        metalness: 0,
      }),
    );
    const rockerMat = this.own(
      new THREE.MeshStandardMaterial({
        color: paint.fixtures.rocker,
        roughness: 0.45,
        metalness: 0,
      }),
    );
    const wellMat = this.own(
      new THREE.MeshStandardMaterial({
        color: paint.fixtures.well,
        roughness: 0.9,
        metalness: 0,
      }),
    );
    const screwMat = this.own(
      new THREE.MeshStandardMaterial({
        color: paint.fixtures.screw,
        roughness: 0.5,
        metalness: 0,
      }),
    );
    const apertureW = SWITCH.rockerW + SWITCH.gap * 2;
    const apertureH = SWITCH.rockerH + SWITCH.gap * 2;
    const plateW =
      (LAMPS.length - 1) * SWITCH.pitch + apertureW + SWITCH.border * 2;
    const plateH = apertureH + SWITCH.border * 2;
    const mullionW = Math.max(0, SWITCH.pitch - apertureW);
    const plateGeo = this.ownGeo(
      new THREE.BoxGeometry(plateW, plateH, SWITCH.plateD),
    );
    const rockerGeo = this.ownGeo(
      rounded(
        SWITCH.rockerW,
        SWITCH.rockerH,
        SWITCH.rockerD,
        ROUND.rocker,
      ).translate(0, 0, SWITCH.rockerD / 2),
    );

    /*
      Left of the screen, measured off the bezel rather than off the wall.

      The gap is what was asked for and the plate's width is whatever the lamp
      count makes it, so the position is derived from both: the bezel's outer
      edge, then the gap, then half a plate. Add a sixth lamp and the switch
      still sits the same distance from the picture.

      Turned to face the room: the group is built with its fittings on local
      -z, so a half turn puts them on world +z, standing proud of the front
      wall instead of buried in it.
    */
    const mount = new THREE.Group();
    mount.position.set(
      -(SCREEN.width / 2 + SCREEN.bezel + SWITCH.screenGap + plateW / 2),
      SWITCH.y,
      -WORLD.halfZ,
    );
    mount.rotation.y = Math.PI;
    this.root.add(mount);

    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.z = -SWITCH.plateD / 2;
    mount.add(plate);

    const wellFloor = new THREE.Mesh(
      this.ownGeo(new THREE.PlaneGeometry(plateW, plateH)),
      wellMat,
    );
    wellFloor.position.z = -(SWITCH.plateD + 0.0006);
    wellFloor.rotation.y = Math.PI;
    mount.add(wellFloor);

    const frameZ = -(SWITCH.plateD + SWITCH.frameD / 2);
    const railW = plateW;
    const railH = SWITCH.border;
    const stileH = plateH - SWITCH.border * 2;
    const parts = [
      block(railW, railH, SWITCH.frameD, 0, (plateH - railH) / 2, frameZ),
      block(railW, railH, SWITCH.frameD, 0, -(plateH - railH) / 2, frameZ),
      block(
        SWITCH.border,
        stileH,
        SWITCH.frameD,
        -(plateW - SWITCH.border) / 2,
        0,
        frameZ,
      ),
      block(
        SWITCH.border,
        stileH,
        SWITCH.frameD,
        (plateW - SWITCH.border) / 2,
        0,
        frameZ,
      ),
    ];
    for (let index = 1; index < LAMPS.length && mullionW > 0; index += 1) {
      parts.push(
        block(
          mullionW,
          stileH,
          SWITCH.frameD,
          (index - 0.5 - (LAMPS.length - 1) / 2) * SWITCH.pitch,
          0,
          frameZ,
        ),
      );
    }
    mount.add(new THREE.Mesh(this.ownGeo(weld(parts)), plateMat));

    const screwProud = 0.0004;
    const screwZ = -(
      SWITCH.plateD +
      SWITCH.frameD +
      screwProud -
      SWITCH.screwD / 2
    );
    const screwX = (plateW - SWITCH.border) / 2;
    const screwHead = (x: number) => {
      const head = new THREE.CylinderGeometry(
        SWITCH.screwR,
        SWITCH.screwR,
        SWITCH.screwD,
        12,
      );
      head.rotateX(Math.PI / 2);
      head.translate(x, 0, screwZ);
      return head;
    };
    mount.add(
      new THREE.Mesh(
        this.ownGeo(weld([screwHead(-screwX), screwHead(screwX)])),
        screwMat,
      ),
    );

    for (let index = 0; index < LAMPS.length; index += 1) {
      const rocker = new THREE.Mesh(rockerGeo, rockerMat);
      const hinge = (SWITCH.rockerH / 2) * Math.sin(SWITCH.tilt);
      rocker.position.set(
        (index - (LAMPS.length - 1) / 2) * SWITCH.pitch,
        0,
        -(SWITCH.plateD + SWITCH.frameD + hinge),
      );
      rocker.rotation.x = rockerTilt(this.on[index] ?? false);
      rocker.userData.lamp = index;
      mount.add(rocker);
      this.rockers.push(rocker);
      this.switches.push(rocker);
    }

    const buttonMount = new THREE.Group();
    buttonMount.position.set(
      BUTTON.wall * WORLD.halfX,
      BUTTON.y,
      BUTTON.z,
    );
    buttonMount.rotation.y = (BUTTON.wall * Math.PI) / 2;
    this.root.add(buttonMount);

    const buttonPlate = new THREE.Mesh(
      this.ownGeo(
        new THREE.BoxGeometry(BUTTON.plateW, BUTTON.plateH, BUTTON.plateD),
      ),
      plateMat,
    );
    buttonPlate.position.z = -BUTTON.plateD / 2;
    buttonMount.add(buttonPlate);

    const buttonGeo = this.ownGeo(
      new THREE.CylinderGeometry(BUTTON.radius, BUTTON.radius, BUTTON.depth, 20),
    );
    buttonGeo.rotateX(Math.PI / 2);
    this.button = new THREE.Mesh(
      buttonGeo,
      this.own(new THREE.MeshBasicMaterial({ color: paint.fixtures.button, toneMapped: false })),
    );
    this.buttonRestZ = -(BUTTON.plateD + BUTTON.depth / 2);
    this.button.position.z = this.buttonRestZ;
    buttonMount.add(this.button);
  }

  lampOn(index: number): boolean {
    return this.on[index] ?? false;
  }

  toggleLamp(index: number): boolean {
    const on = !this.on[index];
    const next = [...this.on];
    next[index] = on;
    this.setLamps(next);
    return on;
  }

  setLamps(lights: readonly boolean[]): void {
    let changed = false;
    for (let index = 0; index < this.on.length; index += 1) {
      const on = lights[index] ?? true;
      if (this.on[index] === on) continue;
      this.on[index] = on;
      changed = true;

      this.lamps[index]!.intensity = on ? LIGHTS.lamp * this.paint.lamps.power : 0;
      const disc = this.discs[index];
      if (disc) disc.emissiveIntensity = on ? 1 : 0;
      this.rockers[index]!.rotation.x = rockerTilt(on);
    }
    if (!changed) return;
    this.refreshFill();
    this.refreshGlow();
  }

  private refreshFill(): void {
    if (this.failing) return;
    const lit = this.on.filter(Boolean).length / Math.max(1, this.on.length);
    const wash = this.tintLevel * SCREEN.contentWash * (1 - lit);
    this.fill.intensity =
      LIGHTS.fillOff + (LIGHTS.fillOn - LIGHTS.fillOff) * lit + wash;
    this.ambient.intensity =
      LIGHTS.ambientOff + (LIGHTS.ambientOn - LIGHTS.ambientOff) * lit;

    const share = this.fill.intensity > 0 ? wash / this.fill.intensity : 0;
    this.fill.color.set(this.paint.fill.sky).lerp(this.tint, share);

    this.dimAtmosphere(lit);
    if (this.caustics) this.caustics.opacity = 0.5 * lit;
  }

  /**
   * Fog and background, scaled by how much of the room is lit.
   *
   * Not to black: a room with every lamp off still has a screen in it, and the
   * far wall of a dark room is not perfectly invisible. Five per cent leaves
   * distance readable as depth while making darkness mean something.
   */
  private dimAtmosphere(lit: number): void {
    const level = 0.05 + 0.95 * lit;
    this.haze?.color.set(this.paint.fog).multiplyScalar(level);
    this.backdrop?.set(this.paint.fog).multiplyScalar(level);
  }

  setPicture(texture: THREE.Texture | null): void {
    this.pictureMaterial.map = texture;
    this.pictureMaterial.color.set(texture ? "#ffffff" : "#000000");
    this.pictureMaterial.needsUpdate = true;
    this.showing = Boolean(texture);
    this.refreshGlow();
  }

  setContentLight(color: THREE.Color, level: number): void {
    this.tint.copy(color);
    this.tintLevel = level;
    this.refreshGlow();
    this.refreshFill();
  }

  get lightsOut(): boolean {
    return !this.on.some(Boolean);
  }

  private refreshGlow(): void {
    if (this.failing) return;
    if (!this.showing) {
      this.glow.intensity = 0;
      return;
    }
    const dark = this.lightsOut && this.tintLevel > 0;
    this.glow.intensity = dark
      ? SCREEN.contentGlow * this.tintLevel
      : SCREEN.glow;
    this.glow.distance = dark ? SCREEN.contentDistance : SCREEN.glowDistance;
    this.glow.color.set(this.paint.screen.glow);
    if (dark) this.glow.color.copy(this.tint);
  }

  startAnomaly(): void {
    this.buttonPush = 1;
    this.anomaly.trigger();
  }

  get anomalous(): boolean {
    return this.anomaly.running;
  }

  updateAnomaly(dt: number): void {
    if (this.buttonPush > 0) {
      this.buttonPush = Math.max(0, this.buttonPush - dt / BUTTON.release);
      this.button.position.z = this.buttonRestZ + this.buttonPush * BUTTON.travel;
    }

    const gain = this.anomaly.update(dt);

    if (this.anomaly.running) {
      this.failing = true;
      for (let index = 0; index < this.lamps.length; index += 1) {
        const lamp = this.lamps[index]!;
        const share = this.on[index] ? 1 : ANOMALY.deadLampShare;
        lamp.intensity = Math.max(0, LIGHTS.lamp * this.paint.lamps.power * gain * share);
        // the fitting dies down with its own lamp rather than blinking on and off
        const disc = this.discs[index];
        if (disc) disc.emissiveIntensity = Math.min(1, gain * share);
      }
      const wash = Math.min(1.6, gain);
      this.fill.intensity = LIGHTS.fillOff + (LIGHTS.fillOn - LIGHTS.fillOff) * wash * 0.5;
      this.ambient.intensity = LIGHTS.ambientOff + LIGHTS.ambientOn * wash * 0.5;
      this.dimAtmosphere(Math.min(1, wash));
      return;
    }

    if (!this.failing) return;
    this.failing = false;
    for (let index = 0; index < this.lamps.length; index += 1) {
      const on = this.on[index] ?? false;
      this.lamps[index]!.intensity = on ? LIGHTS.lamp * this.paint.lamps.power : 0;
      const disc = this.discs[index];
      if (disc) disc.emissiveIntensity = on ? 1 : 0;
    }
    this.refreshFill();
    this.refreshGlow();
  }

  /**
   * Whatever in the room moves on its own.
   *
   * Only the water, so far. It drifts rather than animating: scrolling a ripple
   * texture diagonally at a few centimetres a second is not simulation, but
   * standing water that is perfectly still reads as glass, and the level's own
   * description is careful to say the water is never quite still.
   */
  /**
   * The candles, wandering.
   *
   * Each lamp gets its own pair of slow sines at frequencies that do not divide
   * into each other, so their sum never repeats and no two lamps are ever in
   * step. Five lamps dimming together is a fault in the wiring; five drifting
   * apart is five flames. A noise function would be more correct and would also
   * need a per-lamp generator and a seed - two sines are four multiplies and
   * indistinguishable at this depth.
   *
   * Skipped entirely while the anomaly has the lights, which is already driving
   * intensity for its own reasons, and skipped for every style that has no
   * flicker at all.
   */
  private gutter(dt: number): void {
    const flicker = this.paint.lamps.flicker;
    if (!flicker || this.failing) return;

    this.flame += dt * flicker.rate;
    const full = LIGHTS.lamp * this.paint.lamps.power;

    for (let index = 0; index < this.lamps.length; index += 1) {
      if (!this.on[index]) continue;
      const phase = this.flame + index * 1.7;
      const wander =
        Math.sin(phase) * 0.6 + Math.sin(phase * 2.37 + index) * 0.4;
      this.lamps[index]!.intensity = full * (1 + wander * flicker.depth);
    }
  }

  step(dt: number): void {
    this.gutter(dt);
    if (this.waterMap) {
      this.waterMap.offset.x += this.waterDrift * dt;
      this.waterMap.offset.y += this.waterDrift * dt * 0.6;
    }
    if (this.waterSurface) {
      // across the body's drift, and faster: crests travel, water does not
      this.waterSurface.offset.x -= this.waterDrift * dt * 1.45;
      this.waterSurface.offset.y += this.waterDrift * dt * 1.15;
    }
    if (this.causticMap) {
      // slower again, and a third direction - the net wanders under the crests
      this.causticMap.offset.x += this.waterDrift * dt * 0.55;
      this.causticMap.offset.y -= this.waterDrift * dt * 0.8;
    }
  }

  setLoading(loading: boolean, dt: number): void {
    this.spinner.visible = loading;
    if (!loading) return;
    this.spinner.rotation.z -= dt * SCREEN.loaderSpin;
  }

  /**
   * Resize the picture to the video's shape.
   *
   * Rebuilds the geometry rather than scaling it. Scaling a rounded rectangle
   * squashes its corners along with everything else, so a portrait clip would
   * arrive with elliptical ones - and the corners are the whole reason this is
   * not a plane. A shape of forty-odd vertices costs nothing to rebuild, and it
   * happens once per track rather than once per frame.
   */
  fitPicture(aspect: number): void {
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    const width = Math.min(SCREEN.width, SCREEN.height * aspect);
    const height = width / aspect;

    this.picture.geometry.dispose();
    this.picture.geometry = roundedPlane(width, height, SCREEN.corner);
  }

  /** Hands a texture to the scene's disposal list and gives it straight back. */
  private keep(texture: THREE.Texture): THREE.Texture {
    this.textures.push(texture);
    return texture;
  }

  private own<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  private ownGeo<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  dispose(): void {
    if (this.stage) {
      this.stage.fog = null;
      this.stage.background = null;
    }
    this.crowd.dispose();
    this.root.clear();
    for (const texture of this.textures) texture.dispose();
    for (const material of this.materials) material.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    // rebuilt by `fitPicture`, so the live one is not in the list above
    this.picture.geometry.dispose();
  }
}
