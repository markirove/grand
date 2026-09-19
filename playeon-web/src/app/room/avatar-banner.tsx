"use client";

import { useEffect, useState } from "react";

import { dominantHue } from "@/lib/color";

const DARK = { l: 38, c: 0.125 };
const LIGHT = { l: 48, c: 0.175 };
const MAX_CHROMA = 1.0;

/**
 * Gradients already sampled this session, keyed by avatar URL.
 *
 * The room token rides on that URL and is minted per session, so it is stripped
 * from the key - the same picture must not be re-sampled just because the query
 * string moved. Sampling costs a decode and a 32x32 canvas read, and returning
 * to the join screen shouldn't pay it twice.
 */
const gradients = new Map<string, string>();

function cacheKey(url: string) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("token");
    return parsed.toString();
  } catch {
    return url;
  }
}

type Props = {
  avatarUrl: string | null;
  className?: string;
};

export function AvatarBanner({ avatarUrl, className }: Props) {
  const [gradient, setGradient] = useState<string | null>(() =>
    avatarUrl ? (gradients.get(cacheKey(avatarUrl)) ?? null) : null,
  );

  useEffect(() => {
    if (!avatarUrl) {
      setGradient(null);
      return;
    }

    const key = cacheKey(avatarUrl);
    const cached = gradients.get(key);
    if (cached) {
      setGradient(cached);
      return;
    }

    let cancelled = false;
    const image = new Image();

    /*
      Matches the `crossOrigin` on the avatar `<img>` the join screen paints.
      A CORS request and a plain one are separate cache entries in every
      browser, so a mismatch here meant the same avatar was fetched twice and
      the banner waited on the slower of the two before it could colour. Same
      attribute, one fetch, and this decode is usually already served from
      cache by the time it runs.
    */
    image.crossOrigin = "anonymous";

    image.onload = () => {
      if (cancelled) return;
      try {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;

        ctx.drawImage(image, 0, 0, size, size);
        const swatch = dominantHue(ctx.getImageData(0, 0, size, size).data);
        if (!swatch) return;

        const strength = Math.min(swatch.c / 0.12, MAX_CHROMA);
        const dark = `oklch(${DARK.l}% ${(DARK.c * strength).toFixed(3)} ${swatch.h.toFixed(1)})`;
        const light = `oklch(${LIGHT.l}% ${(LIGHT.c * strength).toFixed(3)} ${swatch.h.toFixed(1)})`;
        const next = `linear-gradient(90deg, ${dark} 0%, ${light} 100%)`;
        gradients.set(key, next);
        setGradient(next);
      } catch {
      }
    };

    image.src = avatarUrl;
    return () => {
      cancelled = true;
    };
  }, [avatarUrl]);

  /*
    The sampled colour rides in on a layer that is mounted from the first
    paint, so the swap is a half-second cross-fade out of the default banner
    rather than a hard cut whenever the decode lands late.
  */
  return (
    <div className={`bg-gradient-banner relative overflow-hidden ${className ?? ""}`}>
      <span
        aria-hidden
        className="absolute inset-0 opacity-0 transition-opacity duration-500 ease-out"
        style={
          gradient
            ? {
                backgroundImage: gradient,
                opacity: 1,
              }
            : undefined
        }
      />
    </div>
  );
}
