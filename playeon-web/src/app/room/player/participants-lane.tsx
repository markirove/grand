"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { avatarHue, initial } from "@/lib/avatar";

export type Presence = "present" | "idle";

export type LaneParticipant = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  presence?: Presence;
};

export type LaneTone = "neutral" | "join" | "leave" | "info";

export type LaneNotice = { text: string; tone?: LaneTone };

const TONE_CLASS: Record<LaneTone, string> = {
  neutral: "",
  join: "text-success-soft-foreground",
  leave: "text-destructive-soft-foreground",
  info: "text-info-soft-foreground",
};

type Props = {
  participants: LaneParticipant[];
  notices?: LaneNotice[];
  noticeMs?: number;
  idleMs?: number;
};

/**
 * Clock times inside a lane line - "seeked to 1:34", and any wording the bot
 * grows later that carries one.
 *
 * Set in mono so the digits hold a column and a timestamp reads as a reading
 * off the track rather than as more prose, with the tracking pulled back in
 * because mono at this size sets loose next to the text around it. Applied by
 * matching the rendered string rather than by having the caller mark it up:
 * the lane takes plain text from the room's event vocabulary, and that is the
 * shape worth keeping.
 */
const CLOCK_RE = /\d{1,2}:\d{2}(?::\d{2})?/g;

function withClockTimes(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(CLOCK_RE)) {
    const at = match.index;
    if (at > cursor) parts.push(text.slice(cursor, at));
    parts.push(
      <span key={at} className="font-mono tracking-tight">
        {match[0]}
      </span>,
    );
    cursor = at + match[0].length;
  }

  // the overwhelmingly common case: no timestamp, so hand back the string
  // itself and leave the DOM exactly as it was
  if (!parts.length) return text;
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

type Line = { text: string; tone: LaneTone; key: number };

/**
 * The line on screen, and the one it just replaced.
 *
 * Both live in one state object so a swap is a single commit: the incoming
 * line and the outgoing line start their halves of the roll in the same frame.
 * Held apart - an effect that mounted the outgoing copy after the fact - they
 * would be a frame out of step, which is the whole animation's worth of stutter
 * at this duration.
 */
type LineState = Line & { out: Line | null };

const swapTo =
  (text: string, tone: LaneTone) =>
  (prev: LineState): LineState => ({
    text,
    tone,
    key: prev.key + 1,
    out: { text: prev.text, tone: prev.tone, key: prev.key },
  });

const MAX_AVATARS = 3;
/** Below this the stack stops being a stack, so the line gets no more room. */
const MIN_AVATARS = 1;

/** Matches the text swap above it, so the pill and its line settle together. */
const PILL_MS = 320;
/** The pager's ease: front-loaded, no long tail - reads as snappy, not floaty. */
const PILL_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

/** `size-7.5`, and the step left after the `-space-x-2` overlap. */
const AVATAR_PX = 30;
const STACK_STEP = 22;
/** `pl-[3px]` + `pr-[15.5px]` + the `gap-2.5` before the line. */
const PILL_CHROME = 3 + 15.5 + 10;
/** At `sm` the pill is centred in open space, so nothing has to give. */
const WIDE = "(min-width: 40rem)";

const stackWidth = (slots: number) =>
  slots > 0 ? AVATAR_PX + (slots - 1) * STACK_STEP : 0;

/**
 * How many avatars to keep so the line can be read.
 *
 * The stack is the part that yields: a name is decoration next to "Sushi
 * skipped Never Gonna Give You Up", and every avatar dropped buys the line
 * 22px. Counts down from the cap and takes the first that fits the notice
 * whole - including the `+N` chip, which occupies a slot of its own and so
 * partly pays back what the dropped avatar saved.
 */
function fitAvatars(textPx: number, availablePx: number, total: number) {
  for (let count = MAX_AVATARS; count > MIN_AVATARS; count -= 1) {
    const slots = Math.min(count, total) + (total > count ? 1 : 0);
    if (PILL_CHROME + stackWidth(slots) + textPx <= availablePx) return count;
  }
  return MIN_AVATARS;
}

export function ParticipantsLane({
  participants,
  notices = [],
  noticeMs = 2600,
  idleMs = 5200,
}: Props) {
  const label = `${participants.length} participant${participants.length === 1 ? "" : "s"}`;

  const [line, setLine] = useState<LineState>({
    text: label,
    tone: "neutral",
    key: 0,
    out: null,
  });

  // The label is read inside the announce effect but must not restart it -
  // a participant joining changes the label, and depending on it directly
  // would replay whatever notice is on screen.
  const labelRef = useRef(label);
  const idleRef = useRef(true);

  useEffect(() => {
    labelRef.current = label;
    if (idleRef.current) setLine(swapTo(label, "neutral"));
  }, [label]);

  /**
   * Announce each notice once, then fall back to the label.
   *
   * This used to be a `setInterval` cycling the list forever, which suits a
   * fixed demo list but not live room events: a single incoming event would
   * re-announce itself every few seconds for as long as the room stayed open.
   */
  useEffect(() => {
    if (!notices.length) return;

    let cancelled = false;
    let timer: number | undefined;
    let index = 0;

    const revert = () => {
      idleRef.current = true;
      setLine(swapTo(labelRef.current, "neutral"));
    };

    const show = () => {
      if (cancelled || index >= notices.length) return;
      const notice = notices[index]!;
      index += 1;
      idleRef.current = false;
      setLine(swapTo(notice.text, notice.tone ?? "neutral"));

      timer = window.setTimeout(() => {
        if (cancelled) return;
        revert();
        if (index < notices.length) timer = window.setTimeout(show, idleMs);
      }, noticeMs);
    };

    show();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [notices, noticeMs, idleMs]);

  /**
   * Animate the pill between its content widths.
   *
   * `width: auto` can't be transitioned, so each change is measured first: let
   * the pill lay out naturally to learn where it is going, pin it back to where
   * it was, then transition to the target. Measuring this way keeps `max-w-full`
   * and the flex shrink honoured - a long notice on a narrow screen resolves to
   * the clamped width, not an overflowing one - and it costs a few forced
   * layouts a minute, only when the content actually changes.
   */
  const pillRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);
  const widthRef = useRef(-1);

  const settleWidth = useCallback((animate: boolean) => {
    const pill = pillRef.current;
    const line = lineRef.current;
    if (!pill || !line) return;

    const from = pill.getBoundingClientRect().width;

    // The finished layout, measured before anything moves: the pill at its
    // natural width, the line free to shrink into whatever that leaves it.
    pill.style.transition = "none";
    line.style.width = "auto";
    line.style.flexShrink = "";
    pill.style.width = "auto";
    const to = pill.getBoundingClientRect().width;
    const lineTo = line.getBoundingClientRect().width;

    /*
      Hold the line at its finished width for the whole animation.

      Left to the flexbox it would instead be squeezed to fit the pill's
      *current* width, so a line that needed the extra room spent the
      transition truncated and then snapped to its full self on the last
      frame - the pill finished growing and the ellipsis vanished a beat
      later. Pinned, the text is laid out once at the size it is going to
      keep, and the pill's own `overflow-hidden` sweeps across it as it
      opens: the line is revealed rather than re-flowed.

      Ellipsis still happens where it should. `lineTo` is measured with the
      line shrinkable and the pill clamped by `max-w-full`, so a notice too
      long for the screen is pinned to the clipped width it genuinely ends
      up with, and truncates from the first frame instead of the last.
    */
    line.style.width = `${lineTo}px`;
    line.style.flexShrink = "0";

    const first = widthRef.current < 0;
    widthRef.current = to;

    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (!animate || first || reduced || Math.round(from) === Math.round(to)) {
      pill.style.width = `${to}px`;
      return;
    }

    pill.style.width = `${from}px`;
    pill.getBoundingClientRect(); // commit the start frame, or the change below is one step
    pill.style.transition = `width ${PILL_MS}ms ${PILL_EASE}`;
    pill.style.width = `${to}px`;
  }, []);

  /**
   * The line's width if nothing clipped it, measured off-layout.
   *
   * The rendered line can't answer this - it is already being squeezed by the
   * stack, so it only ever reports the width it was allowed, not the width it
   * wants. An absolutely positioned twin has no such constraint - which is why
   * the pill clips: the twin is free to run past its right edge, and unclipped
   * that would give the page something to scroll sideways to.
   */
  const ghostRef = useRef<HTMLSpanElement>(null);
  const [avatarCount, setAvatarCount] = useState(MAX_AVATARS);

  /** Bumped on resize so the pass below re-runs; a resize must not animate. */
  const [viewportTick, setViewportTick] = useState(0);
  const resizedRef = useRef(false);

  // Before paint, so neither the natural width nor a stale stack is ever a
  // frame the user sees.
  useLayoutEffect(() => {
    const pill = pillRef.current;
    const ghost = ghostRef.current;
    const room = pill?.parentElement;
    if (!pill || !ghost || !room) return;

    // At `sm` the row is sized *by* the pill, so asking it how much space there
    // is would be asking the pill about itself. It also has room to spare
    // there, which is the answer that question would have had anyway.
    const wide = window.matchMedia?.(WIDE).matches ?? false;
    const next = wide
      ? MAX_AVATARS
      : fitAvatars(
          ghost.getBoundingClientRect().width,
          room.getBoundingClientRect().width,
          participants.length,
        );

    // Re-runs on the state change and settles then, against the final stack -
    // measuring the width now would aim at a layout about to be replaced.
    if (next !== avatarCount) {
      setAvatarCount(next);
      return;
    }

    const animate = !resizedRef.current;
    resizedRef.current = false;
    settleWidth(animate);
  }, [
    settleWidth,
    avatarCount,
    line.key,
    line.text,
    participants.length,
    viewportTick,
  ]);

  // A pinned width can't reflow on its own, and the fit above was measured
  // against a viewport that just changed. Not a ResizeObserver on the row - at
  // `sm` the row is sized by the pill, so observing it would feed back.
  useEffect(() => {
    const onResize = () => {
      resizedRef.current = true;
      setViewportTick((tick) => tick + 1);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const shown = Math.min(avatarCount, participants.length);
  const overflow = participants.length - shown;

  return (
    <div
      ref={pillRef}
      /*
        `contain: layout paint` fences the roll in.

        Paint containment is the half that matters: it promises the browser
        nothing in here draws outside this box, so a frame of the animation
        dirties the pill and stops there instead of inviting the surrounding
        header - which holds a live `backdrop-filter` - into the repaint.
        Layout containment is the cheaper half: the subtree can't affect
        anything outside, so the flex row re-centring around a widening pill
        needn't reconsider what is inside it.

        Not `contain: size`, ever: the pill is measured at `width: auto` to
        learn where it is animating to, and size containment would report
        that as zero.
      */
      className="relative flex h-9 max-w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-full bg-topbar-pill pr-[15.5px] pl-[3px] text-topbar-pill-foreground [contain:layout_paint]"
    >
      <span
        ref={ghostRef}
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0 whitespace-nowrap text-[15px] leading-[18px] font-[470]"
      >
        {/* the same mono run as the rendered line: this twin exists to be
            measured, and a timestamp set in a different face here would size
            the avatar stack against a width the lane never has */}
        {withClockTimes(line.text)}
      </span>

      <div className="flex shrink-0 -space-x-2">
        {participants.slice(0, shown).map((participant) =>
          participant.avatarUrl ? (
            <img
              key={participant.id}
              src={participant.avatarUrl}
              alt=""
              width={28}
              height={28}
              className="size-7.5 rounded-full object-cover ring-2 ring-topbar-pill"
            />
          ) : (
            <span
              key={participant.id}
              style={
                {
                  "--avatar-hue": avatarHue(participant.id + participant.name),
                } as React.CSSProperties
              }
              className="bg-avatar-tint flex size-7.5 items-center justify-center rounded-full font-display text-[17px] font-medium text-[oklch(97%_0.02_var(--avatar-hue))] ring-2 ring-topbar-pill"
            >
              {initial(participant.name)}
            </span>
          ),
        )}

        {overflow > 0 ? (
          /*
            Flattened with `color-mix` rather than left at `/10`. The chip is
            the last child of a `-space-x-2` stack, so it paints over the
            avatar beside it - and a 10% tint let that face show straight
            through the "+2". Same colour it always read as, now opaque, and
            still following the two pill tokens across the theme switch.
          */
          <span className="flex size-7.5 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--topbar-pill-foreground)_10%,var(--topbar-pill))] font-display text-[14px] font-medium ring-2 ring-topbar-pill">
            +{overflow}
          </span>
        ) : null}
      </div>

      {/*
        The roll runs the pill's full height, not the text's.

        This box used to be `h-[18px]` - exactly one line - so the two halves
        of the travel happened outside it and were cut off at the text's own
        edges: the line appeared already halfway up and vanished the same way.
        Full height gives it the whole pill to move through, and the pill's
        padding is what it now moves through rather than what stops it, so
        none of that has to be given up to see the animation.

        `leading-[36px]` is the centring: the pill is `h-9`, and a line box
        that tall puts a 15px line in the middle of it with no flex or
        absolute positioning in the way of the width measuring above.
      */}
      <span
        ref={lineRef}
        className="relative block h-full min-w-0 overflow-hidden"
      >
        {/*
          The line being replaced, kept until the next swap. Absolute, so it
          is out of the flow the pill's width is measured from, and `w-max` so
          it leaves at the width it had - pinning it to the incoming line's
          width would re-truncate it on its way out.
        */}
        {line.out ? (
          <span
            key={line.out.key}
            aria-hidden
            className={`animate-lane-out absolute inset-y-0 left-0 block h-full w-max whitespace-nowrap text-[15px] leading-[36px] font-[470] ${TONE_CLASS[line.out.tone]}`}
          >
            {withClockTimes(line.out.text)}
          </span>
        ) : null}

        <span
          key={line.key}
          className={`animate-lane-in block h-full truncate text-[15px] leading-[36px] font-[470] ${TONE_CLASS[line.tone]}`}
        >
          {withClockTimes(line.text)}
        </span>
      </span>
    </div>
  );
}
