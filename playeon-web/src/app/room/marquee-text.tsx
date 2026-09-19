"use client";

import { useEffect, useRef, useState } from "react";

const SPEED_PX_PER_SEC = 32;
/** Clear space between the end of one copy and the start of the next. */
const GAP_PX = 56;

type Props = {
  text: string;
  className?: string;
};

/**
 * Scrolls overflowing text as one continuous ribbon.
 *
 * The trick is the second copy: the track travels exactly one copy-width plus
 * the gap, at which point copy two is sitting precisely where copy one started,
 * so restarting the animation is invisible. Without it there is nothing to show
 * after the text runs out and the only way back is to reverse - which is what
 * produced the back-and-forth.
 */
export function MarqueeText({ text, className }: Props) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const copyRef = useRef<HTMLSpanElement>(null);
  const [copyWidth, setCopyWidth] = useState(0);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    const copy = copyRef.current;
    if (!viewport || !copy) return;

    const measure = () => {
      // the first copy alone - `scrollWidth` on the track would count both
      const width = copy.offsetWidth;
      setCopyWidth(width);
      setOverflowing(width - viewport.clientWidth > 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(copy);
    return () => observer.disconnect();
  }, [text]);

  const travel = copyWidth + GAP_PX;
  const animate = overflowing && copyWidth > 0;
  const textClass = `block shrink-0 whitespace-nowrap ${className ?? ""}`;

  return (
    <span
      ref={viewportRef}
      className="relative block min-w-0 flex-1 overflow-hidden"
    >
      <span
        className={`flex w-max ${animate ? "marquee" : ""}`}
        style={
          animate
            ? ({
                "--marquee-distance": `-${travel}px`,
                "--marquee-duration": `${travel / SPEED_PX_PER_SEC}s`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <span ref={copyRef} className={textClass}>
          {text}
        </span>
        {animate ? (
          // decorative duplicate - the real text is already above it
          <span aria-hidden className={textClass} style={{ marginLeft: GAP_PX }}>
            {text}
          </span>
        ) : null}
      </span>
    </span>
  );
}
