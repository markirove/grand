/** sRGB channel (0-255) -> linear light */
function toLinear(channel: number) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export type Oklch = { l: number; c: number; h: number };

/** sRGB -> OKLab -> OKLCH. Hue in degrees, chroma roughly 0-0.4. */
export function rgbToOklch(r: number, g: number, b: number): Oklch {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  return {
    l: L,
    c: Math.hypot(A, B),
    h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360,
  };
}

/**
 * Dominant hue of an image, found by summing every pixel's OKLab chroma
 * vector - colourful pixels pull the result, greys cancel out - so a photo
 * with a small vivid subject on a flat background still reads correctly.
 */
export function dominantHue(pixels: Uint8ClampedArray): Oklch | null {
  let a = 0;
  let b = 0;
  let chroma = 0;
  let lightness = 0;
  let count = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3]! < 128) continue; // skip transparent
    const { l, c, h } = rgbToOklch(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
    const rad = (h * Math.PI) / 180;
    a += Math.cos(rad) * c;
    b += Math.sin(rad) * c;
    chroma += c;
    lightness += l;
    count += 1;
  }

  if (!count) return null;
  return {
    l: lightness / count,
    c: chroma / count,
    h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
  };
}
