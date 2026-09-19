"use client";

import { useEffect, useState } from "react";

import { sample, startSampling, type Reading } from "./lib/fps";

const SAMPLE_MS = 500;

/**
 * The readout, built to not be part of what it measures.
 *
 * Its own leaf component with its own state, because state held one level up
 * re-renders the stage - and the stage owns the canvas - twice a second.
 *
 * Painted on an opaque fill rather than the glass the pill above it uses, and
 * this is not a style slip. A `backdrop-filter` over a WebGL canvas is not
 * re-read when the filtered element's own text changes; it is re-read on every
 * frame the canvas draws, over the whole area it covers. A blurred readout
 * therefore costs more the wider it gets and drags down the very number it is
 * printing. Opaque, it is one rounded rectangle in the compositor.
 *
 * `rendered/offered` rather than a single rate: the governor can skip callbacks
 * on a stride, and 30 of 90 (the loop drawing every third frame) and 30 of 30
 * (frames that genuinely take 33 ms) are the same number with opposite causes.
 *
 * Half a second per sample is long enough that the figures are readable rather
 * than a blur of digits, and short enough that a stutter shows up while you are
 * still looking at whatever caused it.
 *
 * `w-max` because a box offset by `left-1/2` otherwise shrinks to fit what is
 * left of the line - half the pill it hangs from - and wraps over two lines.
 */
export function FrameMeter() {
  const [reading, setReading] = useState<Reading | null>(null);

  useEffect(() => {
    startSampling();
    const timer = window.setInterval(() => {
      const taken = sample();
      if (taken) setReading(taken);
    }, SAMPLE_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <span className="absolute top-full left-1/2 mt-1.5 w-max -translate-x-1/2 rounded-full bg-black/75 px-2.5 py-[6px] font-mono text-[11.5px] leading-none whitespace-nowrap text-white/85 tabular-nums">
      {reading === null
        ? "- fps"
        : `${reading.fps}/${reading.rafs} ×${reading.dpr.toFixed(2)}`}
    </span>
  );
}
