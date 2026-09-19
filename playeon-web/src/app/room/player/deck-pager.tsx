"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { selection } from "@/lib/haptics";

const SLIDE_MS = 230;
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

const SLOP = 6;

const FLICK = 0.35;

const STALE_MS = 80;

type Props = {
  index: number;
  onIndexChange: (index: number) => void;
  onProgress?: (progress: number, ms: number) => void;
  panes: ReactNode[];
};

type Drag = {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastT: number;
  velocity: number;
  base: number;
  claimed: boolean;
};

const clamp = (n: number, min: number, max: number) =>
  n < min ? min : n > max ? max : n;

const rubber = (distance: number, width: number) => {
  const limit = width * 0.5 || 1;
  return (1 - 1 / (distance / limit + 1)) * limit;
};

export function DeckPager({ index, onIndexChange, onProgress, panes }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  /** The measured block inside each pane - the pane itself can't be measured
   *  for this: it is stretched to the viewport, so its `scrollHeight` never
   *  reports less than the height we just gave it and the pager could only
   *  ever grow. */
  const contentRefs = useRef<(HTMLDivElement | null)[]>([]);

  const widthRef = useRef(0);
  const offsetRef = useRef(0);
  const pendingRef = useRef(0);
  const frameRef = useRef(0);
  const layerRef = useRef(0);
  const indexRef = useRef(index);
  const dragRef = useRef<Drag | null>(null);

  /**
   * How tall the pager asks to be: the tallest deck, so the height doesn't
   * change under the finger when you swipe between them. It is a request, not
   * a demand - the sheet caps it, and a deck longer than the screen scrolls
   * inside its pane as before. Two short decks now get a short sheet instead
   * of a full-height one with a field of empty space under the last row.
   */
  const [height, setHeight] = useState<number | null>(null);

  const onProgressRef = useRef(onProgress);
  const onIndexChangeRef = useRef(onIndexChange);
  useEffect(() => {
    onProgressRef.current = onProgress;
    onIndexChangeRef.current = onIndexChange;
  });

  const render = useCallback((offset: number, ms: number) => {
    offsetRef.current = offset;
    const track = trackRef.current;
    if (track) {
      track.style.willChange = "transform";
      track.style.transition = ms ? `transform ${ms}ms ${EASE}` : "none";
      track.style.transform = `translate3d(${(-offset).toFixed(2)}px, 0, 0)`;
      window.clearTimeout(layerRef.current);
      if (ms) {
        layerRef.current = window.setTimeout(() => {
          track.style.willChange = "auto";
        }, ms + 60);
      }
    }
    onProgressRef.current?.(offset / (widthRef.current || 1), ms);
  }, []);

  const settle = useCallback(
    (next: number) => {
      const target = clamp(Math.round(next), 0, panes.length - 1);
      indexRef.current = target;
      render(target * widthRef.current, SLIDE_MS);
      return target;
    },
    [panes.length, render],
  );

  const paint = useCallback(() => {
    frameRef.current = 0;
    render(pendingRef.current, 0);
  }, [render]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    widthRef.current = viewport.clientWidth;
    render(indexRef.current * widthRef.current, 0);
  }, [render]);

  useEffect(() => {
    if (index === indexRef.current) return;
    settle(index);
  }, [index, settle]);

  // Measured before paint so the sheet never opens at one height and settles
  // at another. Re-measured on every content box change: a queue row landing,
  // a title wrapping onto a second line at a new width.
  useLayoutEffect(() => {
    const measure = () => {
      const tallest = contentRefs.current.reduce(
        (max, content) =>
          content ? Math.max(max, Math.ceil(content.getBoundingClientRect().height)) : max,
        0,
      );
      setHeight((current) => (current === tallest ? current : tallest));
    };

    measure();
    const observer = new ResizeObserver(measure);
    contentRefs.current.forEach((content) => {
      if (content) observer.observe(content);
    });
    return () => observer.disconnect();
  }, [panes]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      if (viewport.clientWidth === widthRef.current) return;
      widthRef.current = viewport.clientWidth;
      render(indexRef.current * widthRef.current, 0);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [render]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current);
      window.clearTimeout(layerRef.current);
    },
    [],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const abandon = () => {
      dragRef.current = null;
      viewport.removeEventListener("touchmove", onMove);
    };

    const onMove = (event: TouchEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const touch = Array.from(event.touches).find(
        (candidate) => candidate.identifier === drag.id,
      );
      if (!touch) return;

      if (!drag.claimed) {
        const dx = touch.clientX - drag.startX;
        const dy = touch.clientY - drag.startY;

        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > SLOP) {
          abandon();
          return;
        }
        if (Math.abs(dx) < SLOP) return;

        drag.claimed = true;

        const track = trackRef.current;
        const base = track
          ? -new DOMMatrixReadOnly(getComputedStyle(track).transform).m41
          : offsetRef.current;
        drag.base = base;

        drag.startX = touch.clientX;
        drag.lastX = touch.clientX;
        drag.lastT = event.timeStamp;
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
        render(base, 0);
      }

      if (event.cancelable) event.preventDefault();

      const dt = event.timeStamp - drag.lastT;
      if (dt > 0) {
        const instant = (drag.lastX - touch.clientX) / dt;
        drag.velocity = drag.velocity * 0.25 + instant * 0.75;
        drag.lastX = touch.clientX;
        drag.lastT = event.timeStamp;
      }

      const width = widthRef.current || 1;
      const limit = (panes.length - 1) * width;
      const raw = drag.base + (drag.startX - touch.clientX);
      pendingRef.current =
        raw < 0
          ? -rubber(-raw, width)
          : raw > limit
            ? limit + rubber(raw - limit, width)
            : raw;
      if (!frameRef.current) frameRef.current = requestAnimationFrame(paint);
    };

    const onEnd = (event: TouchEvent) => {
      viewport.removeEventListener("touchmove", onMove);
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag?.claimed) return;

      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;

      const from = indexRef.current;
      const progress = offsetRef.current / (widthRef.current || 1);
      const velocity =
        event.timeStamp - drag.lastT > STALE_MS ? 0 : drag.velocity;

      const target =
        velocity > FLICK
          ? Math.ceil(progress)
          : velocity < -FLICK
            ? Math.floor(progress)
            : Math.round(progress);

      const landed = settle(target);
      if (landed !== from) {
        selection();
        onIndexChangeRef.current(landed);
      }
    };

    const onStart = (event: TouchEvent) => {
      viewport.removeEventListener("touchmove", onMove);
      if (event.touches.length !== 1) {
        dragRef.current = null;
        return;
      }
      const touch = event.touches[0];
      dragRef.current = {
        id: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        lastT: event.timeStamp,
        velocity: 0,
        base: offsetRef.current,
        claimed: false,
      };
      viewport.addEventListener("touchmove", onMove, { passive: false });
    };

    viewport.addEventListener("touchstart", onStart, { passive: true });
    viewport.addEventListener("touchend", onEnd, { passive: true });
    viewport.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      viewport.removeEventListener("touchstart", onStart);
      viewport.removeEventListener("touchmove", onMove);
      viewport.removeEventListener("touchend", onEnd);
      viewport.removeEventListener("touchcancel", onEnd);
    };
  }, [panes.length, paint, render, settle]);

  return (
    // `min-h-0` with the default shrink, not `flex-1`: the height below is what
    // the pager wants, and the sheet is free to take it away when the decks are
    // longer than the screen.
    <div
      ref={viewportRef}
      style={height === null ? undefined : { height }}
      className="relative min-h-0 overflow-hidden"
    >
      <div ref={trackRef} className="absolute inset-0 flex">
        {panes.map((pane, paneIndex) => (
          <div
            key={paneIndex}
            data-sheet-scroll
            className="no-scrollbar h-full w-full shrink-0 touch-pan-y overflow-y-auto overscroll-y-contain"
          >
            <div
              ref={(node) => {
                contentRefs.current[paneIndex] = node;
              }}
              className="px-2.5 pb-3"
            >
              {pane}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
