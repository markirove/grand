"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { impact } from "@/lib/haptics";

type Props = {
  title: string;
  header?: ReactNode;
  scroll?: boolean;
  /**
   * Pixels of screen the sheet must stay clear of at the bottom.
   *
   * The on-screen keyboard, in practice. A sheet with a text field in it has to
   * sit above the keyboard rather than under it, and the panel's ceiling has to
   * come down by the same amount or a tall sheet simply grows off the top of
   * the screen instead. Zero for every sheet that does not take typing.
   */
  lift?: number;
  onClose: () => void;
  children: ReactNode;
};

const ENTER_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

const EXIT_EASE = ENTER_EASE;

const OPEN_MS = 240;
const CLOSE_MS = 190;
const SETTLE_MS = 280;

const PROJECTION_MS = 90;

const DISMISS_RATIO = 0.34;

const DISMISS_VELOCITY = 0.45;

const STALE_MS = 80;

const SLOP = 4;

/**
 * The sheet is always as tall as what's in it, up to this ceiling - it never
 * reserves the height it is allowed to have. A short list in a full-height
 * panel reads as content that failed to load rather than a list that is
 * simply short.
 */
const MAX_HEIGHT = "max-h-[calc(var(--app-height)-var(--content-top)-1.5rem)]";

const clamp = (n: number, min: number, max: number) =>
  n < min ? min : n > max ? max : n;

const rubber = (distance: number, dimension: number) => {
  const limit = dimension * 0.55 || 1;
  return (1 - 1 / (distance / limit + 1)) * limit;
};

type Drag = {
  id: number;
  startX: number;
  startY: number;
  lastY: number;
  lastT: number;
  velocity: number;
  base: number;
  active: boolean;
  grab: boolean;
  scroller: HTMLElement | null;
};

export function BottomSheet({
  title,
  header,
  scroll = true,
  lift = 0,
  onClose,
  children,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLButtonElement>(null);

  const offsetRef = useRef(0);
  const heightRef = useRef(0);
  const frameRef = useRef(0);
  const timerRef = useRef(0);
  const closingRef = useRef(false);
  const reducedRef = useRef(false);
  const dragRef = useRef<Drag | null>(null);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const armLayer = useCallback(() => {
    const panel = panelRef.current;
    if (panel) panel.style.willChange = "transform";
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onSettled = (event: TransitionEvent) => {
      if (event.target !== panel || event.propertyName !== "transform") return;
      if (dragRef.current || closingRef.current) return;
      panel.style.willChange = "auto";
    };
    panel.addEventListener("transitionend", onSettled);
    return () => panel.removeEventListener("transitionend", onSettled);
  }, []);

  const paint = useCallback(() => {
    frameRef.current = 0;
    const panel = panelRef.current;
    if (!panel) return;
    const offset = offsetRef.current;
    panel.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0)`;
    const scrim = scrimRef.current;
    if (scrim && heightRef.current > 0) {
      const fade = 1 - Math.max(0, offset) / heightRef.current;
      scrim.style.opacity = clamp(fade, 0, 1).toFixed(3);
    }
  }, []);

  const beginDrag = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return 0;
    panel.style.willChange = "transform";
    const base = new DOMMatrixReadOnly(
      getComputedStyle(panel).transform,
    ).m42;
    heightRef.current = panel.offsetHeight;
    offsetRef.current = base;
    panel.style.transition = "none";
    panel.style.transform = `translate3d(0, ${base.toFixed(2)}px, 0)`;
    if (scrimRef.current) scrimRef.current.style.transition = "none";
    return base;
  }, []);

  const moveTo = useCallback(
    (raw: number) => {
      offsetRef.current =
        raw >= 0 ? raw : -rubber(-raw, heightRef.current || 1);
      if (!frameRef.current) frameRef.current = requestAnimationFrame(paint);
    },
    [paint],
  );

  const close = useCallback((velocity = 0) => {
    if (closingRef.current) return;
    closingRef.current = true;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    dragRef.current = null;

    const panel = panelRef.current;
    const scrim = scrimRef.current;
    const height = heightRef.current || panel?.offsetHeight || 0;
    const remaining = Math.max(0, height - offsetRef.current);

    const ms = reducedRef.current
      ? 0
      : clamp(velocity > 0.05 ? remaining / velocity : CLOSE_MS, 130, CLOSE_MS);

    if (panel) {
      panel.style.willChange = "transform";
      panel.style.transition = `transform ${ms}ms ${EXIT_EASE}`;
      panel.style.transform = "translate3d(0, 100%, 0)";
    }
    if (scrim) {
      scrim.style.transition = `opacity ${ms}ms linear`;
      scrim.style.opacity = "0";
    }
    timerRef.current = window.setTimeout(() => onCloseRef.current(), ms);
  }, []);

  const settle = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    offsetRef.current = 0;
    const panel = panelRef.current;
    if (panel) {
      panel.style.transition = `transform ${
        reducedRef.current ? 0 : SETTLE_MS
      }ms ${ENTER_EASE}`;
      panel.style.transform = "translate3d(0, 0, 0)";
    }
    const scrim = scrimRef.current;
    if (scrim) {
      scrim.style.transition = "opacity 160ms ease-out";
      scrim.style.opacity = "1";
    }
  }, []);

  const release = useCallback(
    (velocity: number) => {
      const height = heightRef.current || 1;
      const projected = offsetRef.current + velocity * PROJECTION_MS;
      if (velocity > DISMISS_VELOCITY || projected > height * DISMISS_RATIO) {
        impact("soft");
        close(velocity);
      } else {
        settle();
      }
    },
    [close, settle],
  );

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    if (!panel) return;

    reducedRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    heightRef.current = panel.offsetHeight;
    // The panel is content-sized, and the content settles a beat after this
    // runs (and again whenever it changes). The dismiss threshold and the
    // scrim's fade are both fractions of this, so it can't be a mount-time
    // snapshot of an empty panel.
    const observer = new ResizeObserver(() => {
      heightRef.current = panel.offsetHeight;
    });
    observer.observe(panel);

    const ms = reducedRef.current ? 0 : OPEN_MS;
    armLayer();
    panel.style.transition = `transform ${ms}ms ${ENTER_EASE}`;
    panel.style.transform = "translate3d(0, 0, 0)";
    if (scrim) {
      scrim.style.transition = `opacity ${Math.max(ms - 80, 0)}ms ease-out`;
      scrim.style.opacity = "1";
    }
    impact("light");

    return () => {
      observer.disconnect();
      document.body.style.overflow = previousOverflow;
    };
  }, [armLayer]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current);
      window.clearTimeout(timerRef.current);
    },
    [],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const abandon = () => {
      dragRef.current = null;
      panel.removeEventListener("touchmove", onMove);
    };

    const onMove = (event: TouchEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const touch = Array.from(event.touches).find(
        (candidate) => candidate.identifier === drag.id,
      );
      if (!touch) return;

      if (!drag.active) {
        const dy = touch.clientY - drag.startY;
        const dx = touch.clientX - drag.startX;

        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SLOP) {
          abandon();
          return;
        }
        if (Math.abs(dy) < SLOP) return;

        if (!drag.grab && (dy < 0 || (drag.scroller?.scrollTop ?? 0) > 0)) {
          abandon();
          return;
        }
        drag.active = true;
        drag.base = beginDrag();

        drag.startY = touch.clientY;
        drag.lastY = touch.clientY;
        drag.lastT = event.timeStamp;
      }

      if (event.cancelable) event.preventDefault();

      const dt = event.timeStamp - drag.lastT;
      if (dt > 0) {
        const instant = (touch.clientY - drag.lastY) / dt;
        drag.velocity = drag.velocity * 0.25 + instant * 0.75;
        drag.lastY = touch.clientY;
        drag.lastT = event.timeStamp;
      }
      moveTo(drag.base + (touch.clientY - drag.startY));
    };

    const onStart = (event: TouchEvent) => {
      panel.removeEventListener("touchmove", onMove);
      if (closingRef.current || event.touches.length !== 1) {
        dragRef.current = null;
        return;
      }
      const touch = event.touches[0];
      const target = event.target as HTMLElement | null;
      const grab = !!target?.closest("[data-sheet-grab]");
      const scroller = target?.closest<HTMLElement>("[data-sheet-scroll]");

      if (!grab && scroller && scroller.scrollTop > 0) {
        dragRef.current = null;
        return;
      }

      dragRef.current = {
        id: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        lastY: touch.clientY,
        lastT: event.timeStamp,
        velocity: 0,
        base: 0,
        active: false,
        grab,
        scroller: scroller ?? null,
      };
      panel.addEventListener("touchmove", onMove, { passive: false });
    };

    const onEnd = (event: TouchEvent) => {
      panel.removeEventListener("touchmove", onMove);
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      if (!drag.active) return;
      release(event.timeStamp - drag.lastT > STALE_MS ? 0 : drag.velocity);
    };

    panel.addEventListener("touchstart", onStart, { passive: true });
    panel.addEventListener("touchend", onEnd, { passive: true });
    panel.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      panel.removeEventListener("touchstart", onStart);
      panel.removeEventListener("touchmove", onMove);
      panel.removeEventListener("touchend", onEnd);
      panel.removeEventListener("touchcancel", onEnd);
    };
  }, [beginDrag, moveTo, release]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" || event.button !== 0) return;
    if (closingRef.current) return;

    const base = beginDrag();
    const startY = event.clientY;
    let last = { y: startY, t: performance.now() };
    let velocity = 0;

    const move = (moveEvent: PointerEvent) => {
      const now = performance.now();
      const dt = now - last.t;
      if (dt > 0) {
        velocity = velocity * 0.25 + ((moveEvent.clientY - last.y) / dt) * 0.75;
        last = { y: moveEvent.clientY, t: now };
      }
      moveTo(base + (moveEvent.clientY - startY));
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      release(performance.now() - last.t > STALE_MS ? 0 : velocity);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col justify-end"
      style={lift ? { paddingBottom: lift } : undefined}
    >
      <button
        ref={scrimRef}
        type="button"
        aria-label="Close"
        onClick={() => close()}
        style={{ opacity: 0 }}
        className="absolute inset-0 cursor-default bg-overlay will-change-[opacity]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          transform: "translate3d(0, 100%, 0)",
          ...(lift
            ? {
                maxHeight: `calc(var(--app-height) - var(--content-top) - 1.5rem - ${lift}px)`,
              }
            : null),
        }}
        className={`relative flex flex-col rounded-t-sheet bg-sheet pb-sheet shadow-sheet ${MAX_HEIGHT}`}
      >
        <div
          data-sheet-grab
          onPointerDown={onPointerDown}
          className="shrink-0 cursor-grab touch-none px-2.5 pt-2.5 pb-1.5 select-none active:cursor-grabbing"
        >
          <span className="mx-auto block h-1 w-9 rounded-full bg-border-strong" />
        </div>

        <div data-sheet-grab className="shrink-0 touch-none px-2.5 pt-1.5 pb-3">
          {header ?? (
            <span className="block text-center text-[15px] font-medium">
              {title}
            </span>
          )}
        </div>

        {/* `min-h-0` and the default shrink rather than `flex-1`: the body
            takes the height its content asks for and gives it back only when
            the panel runs into its ceiling. `flex-1` would grow it to fill
            whatever the panel had, which is the thing being fixed. */}
        {scroll ? (
          <div
            data-sheet-scroll
            className="no-scrollbar min-h-0 touch-pan-y overflow-y-auto overscroll-contain px-2.5 pb-3"
          >
            {children}
          </div>
        ) : (
          <div className="flex min-h-0 flex-col">{children}</div>
        )}
      </div>
    </div>
  );
}
