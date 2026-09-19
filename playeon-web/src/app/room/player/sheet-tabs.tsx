"use client";

import { useState, type RefObject } from "react";

const TAB_PAD = 4;
const TAB_GAP = 4;

/**
 * The tab's own height, which is what sets the pill's.
 *
 * A height rather than vertical padding, because the label is centred in it
 * either way and a fixed height is the one thing that keeps all the tabs - and
 * so the sliding pill behind them - the same size whatever their labels do.
 * Everything else here is measured off it: the bar's height, the pill's inset,
 * and the width each tab lands at.
 */
const TAB_BASE =
  "relative z-10 flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full text-[15.5px] font-[470] text-muted-foreground transition-colors duration-150 data-[active]:text-foreground";

export const pillTransform = (progress: number) =>
  `translateX(calc(${progress} * (100% + ${TAB_GAP}px)))`;

export function SheetTabs({
  labels,
  active,
  badges,
  barRef,
  pillRef,
  onChange,
}: {
  labels: string[];
  active: number;
  badges?: boolean[];
  barRef: RefObject<HTMLDivElement | null>;
  pillRef: RefObject<HTMLSpanElement | null>;
  onChange: (index: number) => void;
}) {
  const [opened] = useState(() => active);

  return (
    <div
      ref={barRef}
      role="tablist"
      className="relative flex gap-1 rounded-full bg-secondary p-1"
    >
      <span
        ref={pillRef}
        aria-hidden
        style={{
          width: `calc((100% - ${TAB_PAD * 2 + TAB_GAP * (labels.length - 1)}px) / ${labels.length})`,
          transform: pillTransform(opened),
        }}
        className="absolute inset-y-1 left-1 rounded-full bg-sheet will-change-transform"
      />

      {labels.map((label, tabIndex) => (
        <button
          key={label}
          type="button"
          role="tab"
          aria-selected={tabIndex === active}
          data-active={tabIndex === opened ? "" : undefined}
          onClick={() => onChange(tabIndex)}
          className={TAB_BASE}
        >
          {label}
          {badges?.[tabIndex] ? (
            <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
          ) : null}
        </button>
      ))}
    </div>
  );
}
