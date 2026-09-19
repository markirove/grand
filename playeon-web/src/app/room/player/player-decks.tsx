"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import { BottomSheet } from "./bottom-sheet";
import { DeckPager } from "./deck-pager";
import { PeopleList } from "./people-list";
import { QueueList, type QueueTrack } from "./queue-list";
import type { LaneParticipant } from "./participants-lane";

type Deck = "queue" | "people";

/** What the room is doing together - the people deck is named after it. */
export type DeckMedia = "video" | "audio";

type Props = {
  queue: QueueTrack[];
  participants: LaneParticipant[];
  /** Drives the people deck's wording; audio unless the track carries video. */
  media?: DeckMedia;
  variant?: DeckVariant;
  className?: string;
};

export type DeckVariant = "solid" | "outline" | "accent";

const DECK_BASE =
  "flex h-12 flex-1 cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-full text-[16px] font-[470] tracking-[-0.1px] transition-[scale,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] select-none will-change-transform active:scale-[0.975] active:duration-150 active:ease-[cubic-bezier(0.33,0,0.67,1)]";

const DECK_VARIANT: Record<DeckVariant, string> = {
  solid: "bg-card text-card-foreground active:bg-secondary",
  outline: "text-foreground ring-1 ring-border active:bg-card",
  accent: "text-primary active:bg-primary-soft",
};

const COUNT_BASE =
  "flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 font-mono text-[13.5px] font-medium";

const COUNT_VARIANT: Record<DeckVariant, string> = {
  solid: "bg-secondary text-secondary-foreground",
  outline: "bg-secondary text-secondary-foreground",
  accent: "bg-primary-soft text-primary-soft-foreground",
};

const TAB_BASE =
  "relative z-10 flex h-9 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full text-[15.5px] font-[470] text-muted-foreground transition-colors duration-150 data-[active]:text-foreground";

const DECKS: Deck[] = ["queue", "people"];

/**
 * The roster is labelled by the activity rather than by the role: everyone in
 * the room is watching the same thing or listening to the same thing, and
 * saying which is warmer than "Participants" and tells the viewer what kind of
 * track is on without looking at the stage.
 */
const PEOPLE_LABEL: Record<DeckMedia, string> = {
  video: "Watching",
  audio: "Listening",
};

const deckLabel = (deck: Deck, media: DeckMedia) =>
  deck === "queue" ? "Up Next" : PEOPLE_LABEL[media];

const TAB_PAD = 4;
const TAB_GAP = 4;

const PAGER_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

const pillTransform = (progress: number) =>
  `translateX(calc(${progress} * (100% + ${TAB_GAP}px)))`;

function Tabs({
  active,
  media,
  barRef,
  pillRef,
  onChange,
}: {
  active: Deck;
  media: DeckMedia;
  barRef: RefObject<HTMLDivElement | null>;
  pillRef: RefObject<HTMLSpanElement | null>;
  onChange: (deck: Deck) => void;
}) {
  const [opened] = useState(() => DECKS.indexOf(active));
  const initial = pillTransform(opened);

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
          width: `calc((100% - ${TAB_PAD * 2 + TAB_GAP * (DECKS.length - 1)}px) / ${DECKS.length})`,
          transform: initial,
        }}
        className="absolute inset-y-1 left-1 rounded-full bg-sheet will-change-transform"
      />

      {DECKS.map((deck, tabIndex) => (
        <button
          key={deck}
          type="button"
          role="tab"
          aria-selected={deck === active}
          data-active={tabIndex === opened ? "" : undefined}
          onClick={() => onChange(deck)}
          className={TAB_BASE}
        >
          {deckLabel(deck, media)}
        </button>
      ))}
    </div>
  );
}

export function PlayerDecks({
  queue,
  participants,
  media = "audio",
  variant = "solid",
  className,
}: Props) {
  const [open, setOpen] = useState<Deck | null>(null);
  const button = `${DECK_BASE} ${DECK_VARIANT[variant]}`;
  const count = `${COUNT_BASE} ${COUNT_VARIANT[variant]}`;

  const pillRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef(-1);

  const onProgress = useCallback((progress: number, ms: number) => {
    const pill = pillRef.current;
    if (pill) {
      pill.style.transition = ms ? `transform ${ms}ms ${PAGER_EASE}` : "none";
      pill.style.transform = pillTransform(progress);
    }

    const next = Math.round(progress);
    if (next === focusRef.current) return;
    focusRef.current = next;
    barRef.current
      ?.querySelectorAll<HTMLElement>('[role="tab"]')
      .forEach((tab, tabIndex) =>
        tab.toggleAttribute("data-active", tabIndex === next),
      );
  }, []);

  const decks = useMemo(
    () => [
      <QueueList key="queue" tracks={queue} />,
      <PeopleList key="people" people={participants} />,
    ],
    [queue, participants],
  );

  return (
    <>
      <div className={`flex items-center gap-2 px-2 ${className ?? ""}`}>
        <button
          type="button"
          onClick={() => setOpen("queue")}
          className={button}
        >
          Up Next
          <span className={count}>{queue.length}</span>
        </button>

        <button
          type="button"
          onClick={() => setOpen("people")}
          className={button}
        >
          {PEOPLE_LABEL[media]}
          <span className={count}>{participants.length}</span>
        </button>
      </div>

      {open && (
        <BottomSheet
          title={deckLabel(open, media)}
          scroll={false}
          onClose={() => setOpen(null)}
          header={
            <Tabs
              active={open}
              media={media}
              barRef={barRef}
              pillRef={pillRef}
              onChange={setOpen}
            />
          }
        >
          <DeckPager
            index={DECKS.indexOf(open)}
            onIndexChange={(index) => setOpen(DECKS[index] ?? null)}
            onProgress={onProgress}
            panes={decks}
          />
        </BottomSheet>
      )}
    </>
  );
}
