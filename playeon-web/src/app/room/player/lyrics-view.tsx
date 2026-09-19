"use client";

import { useEffect, useMemo, useRef } from "react";

import { lineAt, type LyricLine } from "@/lib/lyrics";

type Props = {
  lines: LyricLine[];
  /** The room clock, read per frame - never mirrored into state. */
  positionSec: () => number;
  /** The loop only runs while the panel is open. */
  active: boolean;
  className?: string;
};

/** Where the live line sits in the panel, as a fraction of its height. */
const FOCUS_RATIO = 0.5;

const SETTLE_MS = 420;
const SETTLE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * A blank LRC line is a rest between verses. Given a height of its own it
 * reads as the panel having gone wrong, so it collapses to a short bar that
 * the follow can still land on.
 */
function isRest(line: LyricLine) {
  return line.text.length === 0;
}

/**
 * Timed lyrics that follow the room clock.
 *
 * The whole point of this component is what it *doesn't* do. There is no state
 * here, and no re-render while a track plays: one rAF reads the same
 * authoritative position the scrubber does, works out which line is live, and
 * on the two or three frames a minute where that changes it touches exactly
 * two elements and one transform. Everything else - the fade, the scale, the
 * travel - is CSS reacting to a `data-active` attribute.
 */
export function LyricsView({ lines, positionSec, active, className }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);

  const frameRef = useRef(0);
  /** Last line painted; also the hint that makes the lookup O(1). */
  const paintedRef = useRef(-2);
  /**
   * The element currently wearing `data-active`.
   *
   * Held as a node rather than derived from `paintedRef`, because that index
   * gets reset to a sentinel whenever something needs to force a repaint - a
   * reopen, a resize - and an index-based unmark quietly does nothing then,
   * stranding the highlight on the old line.
   */
  const markedRef = useRef<HTMLParagraphElement | null>(null);

  const times = useMemo(() => {
    const array = new Float64Array(lines.length);
    for (let index = 0; index < lines.length; index += 1) {
      array[index] = lines[index].t;
    }
    return array;
  }, [lines]);

  useEffect(() => {
    if (!active) return;

    // A fresh open re-paints from scratch, since the panel may have resized or
    // the track may have moved on while it was shut.
    //
    // The sweep matters as much as the reset: closing only cancels the loop, so
    // the live line keeps its attribute. It also covers the case `markedRef`
    // can't - a node that was replaced under it, leaving a lit orphan it no
    // longer points at.
    for (const node of lineRefs.current) node?.removeAttribute("data-active");
    markedRef.current = null;
    paintedRef.current = -2;

    const paint = () => {
      frameRef.current = requestAnimationFrame(paint);

      const index = lineAt(times, positionSec(), paintedRef.current);
      if (index === paintedRef.current) return;

      paintedRef.current = index;

      const element = index >= 0 ? lineRefs.current[index] : null;
      if (markedRef.current !== element) {
        markedRef.current?.removeAttribute("data-active");
        markedRef.current = element;
      }
      element?.setAttribute("data-active", "");

      const viewport = viewportRef.current;
      const track = trackRef.current;
      if (!track || !viewport) return;

      /*
        The focus point is where the live line belongs, including before there
        is one - so the column opens with the first line already sitting there
        and travels up through it, rather than starting flush against the top
        and only becoming centred once it has scrolled far enough to be.

        Both halves of that used to be prevented: the offset fell back to 0
        before the first line, and `Math.max(0, …)` clamped away the negative
        offsets. Negative is not an error here - the early lines need pushing
        *down* to reach the middle, which is precisely the offset that was
        being discarded.
      */
      const target = element ?? lineRefs.current.find(Boolean) ?? null;
      const offset = target
        ? target.offsetTop -
          viewport.clientHeight * FOCUS_RATIO +
          target.offsetHeight / 2
        : 0;

      track.style.transform = `translate3d(0, ${(-offset).toFixed(1)}px, 0)`;
    };

    frameRef.current = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frameRef.current);
  }, [active, times, positionSec]);

  // the panel's height changes as it opens, which moves the focus point
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !active) return;
    const observer = new ResizeObserver(() => {
      paintedRef.current = -2; // force the next frame to re-place the column
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [active]);

  return (
    <div
      ref={viewportRef}
      className={`relative overflow-hidden ${className ?? ""}`}
      style={{
        // soft edges instead of a hard cut, so lines arrive and leave rather
        // than pop; a mask costs nothing here because it never animates
        maskImage:
          "linear-gradient(to bottom, transparent 0%, black 14%, black 78%, transparent 100%)",
      }}
    >
      <div
        ref={trackRef}
        className="will-change-transform"
        style={{
          transform: "translate3d(0, 0, 0)",
          transition: `transform ${SETTLE_MS}ms ${SETTLE_EASE}`,
        }}
      >
        {lines.map((line, index) => (
          <p
            key={index}
            ref={(node) => {
              lineRefs.current[index] = node;
            }}
            className={
              isRest(line)
                ? "my-2 h-[3px] w-7 rounded-full bg-muted-foreground/35 transition-opacity duration-300 data-[active]:bg-foreground/60"
                : "px-2 py-[9.5px] text-[17.5px] leading-[1.42] font-[420] tracking-[-0.2px] text-muted-foreground/55 transition-[color,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] data-[active]:text-foreground"
            }
          >
            {line.text}
          </p>
        ))}
      </div>
    </div>
  );
}
