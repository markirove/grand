/**
 * What the render loop did, counted where it happens.
 *
 * Two counts, not one, and the pair is the whole point. The governor renders on
 * a stride - it can skip callbacks and draw every second or third one - so the
 * rate on its own cannot say whether a slow room is a slow room or a loop that
 * decided to draw a third as often. Rendered frames against callbacks answers
 * that in one glance: 30 of 90 is the stride, 30 of 30 is the cost.
 *
 * The pixel ratio rides along because it is the other thing that moves under
 * you, and reading it is a property access on a number the renderer already
 * holds.
 *
 * Module-level rather than threaded through React, because the one place that
 * knows a frame happened is inside the render loop, and the one place that
 * shows it is in the header several components away. Anything carried between
 * them would be state changing ninety times a second.
 */
export type Reading = {
  /** Frames actually rendered, per second. */
  fps: number;
  /** Frame callbacks per second - the rate the loop was offered. */
  rafs: number;
  /** The pixel ratio the governor has settled on. */
  dpr: number;
};

/** What the meter needs off the renderer - a renderer satisfies it. */
type Reporting = { getPixelRatio(): number };

let drawn = 0;
let ticks = 0;
let dpr = 0;
let at = 0;

/** Called once per frame callback, before the stride decides to skip it. */
export function markTick() {
  ticks += 1;
}

/** Called by the render loop, once per frame it actually renders. */
export function markFrame(gl: Reporting) {
  drawn += 1;
  dpr = gl.getPixelRatio();
}

/** Clears the counts, so the next sample covers only the time since this call. */
export function startSampling() {
  drawn = 0;
  ticks = 0;
  at = performance.now();
}

/** The counts since the last sample, or null if no time has passed. */
export function sample(): Reading | null {
  const now = performance.now();
  const elapsed = now - at;
  at = now;

  const frames = drawn;
  const callbacks = ticks;
  drawn = 0;
  ticks = 0;
  if (elapsed <= 0) return null;

  return {
    fps: Math.round((frames * 1000) / elapsed),
    rafs: Math.round((callbacks * 1000) / elapsed),
    dpr,
  };
}
