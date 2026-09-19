"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

import { formatClock } from "@/lib/duration";

const SEEK_SECONDS = 10;

/**
 * Width of the range thumb in px - must match `--webkit-slider-thumb` in the
 * `seek-slider` utility.
 *
 * A native thumb doesn't travel the whole rail: its centre runs from half a
 * thumb in to half a thumb short of the end, so it can never hang off either
 * edge. Painting the fill as a plain percentage of the rail therefore leaves it
 * half a thumb behind the knob at 0%, level at 50%, and half a thumb ahead at
 * the end. The fill is mapped onto that same travel instead.
 */
const THUMB_WIDTH = 18;

function SeekIcon({ direction }: { direction: "back" | "forward" }) {
  const back = direction === "back";
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className="size-7 shrink-0"
    >
      {back ? (
        <path
          strokeLinejoin="round"
          d="M12 5L10.8961 3.45459C10.4851 2.87911 10.2795 2.59137 10.4093 2.32411C10.5391 2.05684 10.8689 2.04153 11.5286 2.01092C11.6848 2.00367 11.842 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 8.72836 3.57111 5.82368 6 3.99927"
        />
      ) : (
        <path
          strokeLinejoin="round"
          d="M12 5L13.1039 3.45459C13.5149 2.87911 13.7205 2.59137 13.5907 2.32411C13.4609 2.05684 13.1311 2.04153 12.4714 2.01092C12.3152 2.00367 12.158 2 12 2C6.4772 2 2 6.47715 2 12C2 17.5228 6.4772 22 12 22C17.5229 22 22 17.5228 22 12C22 8.72836 20.4289 5.82368 18 3.99927"
        />
      )}
      <path d="M7.99219 11.004C8.52019 10.584 9.00019 9.89143 9.30019 10.02C9.60019 10.1486 9.50419 10.572 9.50419 11.232C9.50419 11.892 9.50419 14.6847 9.50419 16.008" />
      <path d="M16.0022 12.6C16.0022 11.22 16.0682 10.848 15.8042 10.404C15.5402 9.96001 14.8802 9.99841 14.2202 9.99841C13.5602 9.99841 13.0802 9.96001 12.7622 10.32C12.3722 10.74 12.5402 11.52 12.4922 12.6C12.6002 14.04 12.3062 15.18 12.7562 15.66C13.0802 16.056 13.6553 15.996 14.3402 16.008C15.0201 15.9997 15.4322 16.032 15.7682 15.648C16.1402 15.312 15.9602 13.98 16.0022 12.6Z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      className="size-8 shrink-0 translate-x-[1px]"
    >
      <path d="M18.8906 12.846C18.5371 14.189 16.8667 15.138 13.5257 17.0361C10.296 18.8709 8.6812 19.7884 7.37983 19.4196C6.8418 19.2671 6.35159 18.9776 5.95624 18.5787C5 17.6139 5 15.7426 5 12C5 8.2574 5 6.3861 5.95624 5.42132C6.35159 5.02245 6.8418 4.73288 7.37983 4.58042C8.6812 4.21165 10.296 5.12907 13.5257 6.96393C16.8667 8.86197 18.5371 9.811 18.8906 11.154C19.0365 11.7084 19.0365 12.2916 18.8906 12.846Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="size-8 shrink-0"
    >
      <path d="M4 7C4 5.58579 4 4.87868 4.43934 4.43934C4.87868 4 5.58579 4 7 4C8.41421 4 9.12132 4 9.56066 4.43934C10 4.87868 10 5.58579 10 7V17C10 18.4142 10 19.1213 9.56066 19.5607C9.12132 20 8.41421 20 7 20C5.58579 20 4.87868 20 4.43934 19.5607C4 19.1213 4 18.4142 4 17V7Z" />
      <path d="M14 7C14 5.58579 14 4.87868 14.4393 4.43934C14.8787 4 15.5858 4 17 4C18.4142 4 19.1213 4 19.5607 4.43934C20 4.87868 20 5.58579 20 7V17C20 18.4142 20 19.1213 19.5607 19.5607C19.1213 20 18.4142 20 17 20C15.5858 20 14.8787 20 14.4393 19.5607C14 19.1213 14 18.4142 14 17V7Z" />
    </svg>
  );
}

const SIDE_BUTTON =
  "flex size-11.5 cursor-pointer touch-manipulation items-center justify-center rounded-full bg-secondary text-muted-foreground transition-[scale] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] select-none active:scale-[0.94] active:duration-150 active:ease-[cubic-bezier(0.33,0,0.67,1)] disabled:cursor-default disabled:opacity-45 disabled:active:scale-100";

type Props = {
  className?: string;
  durationSec: number;
  playing: boolean;
  /**
   * Reads the room's authoritative position. A getter, not a value: position
   * changes continuously and is painted from a rAF, so passing it as a prop
   * would re-render this subtree on every frame for no reason.
   */
  positionSec: () => number;
  onToggle: () => void;
  onSeek: (positionSec: number) => void;
  /**
   * The audible element is starved. The bar holds where it is and the transport
   * goes inert - advancing a progress bar past sound nobody can hear, or taking
   * a seek the element can't act on, both just lie to the viewer.
   */
  stalled?: boolean;
  /**
   * Whether this viewer may drive the room at all.
   *
   * Unlike `stalled` this isn't transient - the room simply isn't theirs to
   * move - so the transport reads as permanently inert rather than briefly
   * held. The handlers above already refuse; this is what stops the buttons
   * from inviting a tap that would do nothing.
   */
  canControl?: boolean;
};

export function PlaybackControls({
  className,
  durationSec,
  playing,
  positionSec,
  onToggle,
  onSeek,
  stalled = false,
  canControl = true,
}: Props) {
  /**
   * One reading shared by every control. A stall and a missing permission are
   * different reasons for the same fact - this input cannot be acted on - and
   * deriving them in one place is what keeps the seek bar, the scrubber and
   * the three buttons from ever disagreeing about whether they're live.
   */
  const inert = stalled || !canControl;
  const fillRef = useRef<HTMLDivElement>(null);
  const bloomRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const totalRef = useRef<HTMLSpanElement>(null);

  const railRef = useRef<HTMLDivElement>(null);

  /** While a finger is on the knob the room clock must not fight it. */
  const scrubbingRef = useRef(false);
  const frameRef = useRef(0);
  /** Last painted percentage, so an unchanged frame costs nothing. */
  const paintedRef = useRef(-1);
  /**
   * Last painted second.
   *
   * Tracked apart from the percentage because the two readouts quantise
   * differently: the bar moves in pixels, the clock in seconds. On a long track
   * a second is a very small fraction of the rail - under half a pixel on an
   * hour-long stream - so a single pixel-width guard would hold the clock back
   * for several seconds at a time and it would count in twos.
   */
  const paintedSecRef = useRef(-1);
  /** Rail width in px, remeasured only on resize - never inside the loop. */
  const railWidthRef = useRef(0);
  /**
   * A committed seek that the room hasn't confirmed yet.
   *
   * Letting go hands the position back to the room clock, which is still
   * reporting the *old* spot until the control message round-trips - so the
   * knob snaps backwards and then jumps forward when the snapshot lands. The
   * bar is pinned to the target until the room agrees, with a deadline so a
   * dropped message can never wedge it there.
   */
  const pendingRef = useRef<{ target: number; expires: number } | null>(null);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const measure = () => {
      railWidthRef.current = rail.clientWidth;
      paintedRef.current = -1; // force a repaint at the new width
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);

  /**
   * The transport is painted straight to the DOM in a rAF - holding position
   * in state would re-render the whole player several times a second to move
   * one div.
   *
   * Two things keep that cheap. The bloom moves by `transform`, not `left`:
   * it carries a blur filter, and shifting a blurred element by a layout
   * property forces the compositor to re-blur it every single frame. And
   * nothing is written unless the value actually moved a visible amount - on a
   * three-minute track the bar advances about half a percent per second, so
   * this drops from 60 writes a second to roughly three.
   */
  useEffect(() => {
    const paint = () => {
      frameRef.current = requestAnimationFrame(paint);
      // held, not stopped: the loop keeps running so it resumes the instant
      // data arrives, without waiting to be re-scheduled
      if (stalled && !scrubbingRef.current) return;

      const duration = durationSec > 0 ? durationSec : 0;

      let position: number;
      if (scrubbingRef.current) {
        position = Number(inputRef.current?.value ?? 0);
      } else {
        const live = positionSec();
        const pending = pendingRef.current;
        if (pending) {
          // within a second counts as arrived - the room clock ticks on while
          // the message flies, so it never lands on the exact target
          if (Math.abs(live - pending.target) < 1 || Date.now() > pending.expires) {
            pendingRef.current = null;
            position = live;
          } else {
            position = pending.target;
          }
        } else {
          position = live;
        }
      }
      const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

      // ~0.1% is well under one pixel on any phone-width rail
      if (Math.abs(pct - paintedRef.current) >= 0.1) {
        paintedRef.current = pct;
        // the knob's centre, which is where the fill has to end for the two to
        // read as one object
        const travel = Math.max(0, railWidthRef.current - THUMB_WIDTH);
        const center = THUMB_WIDTH / 2 + (travel * pct) / 100;
        if (fillRef.current) fillRef.current.style.width = `${center.toFixed(1)}px`;
        if (bloomRef.current) {
          bloomRef.current.style.transform = `translate3d(${center.toFixed(
            1,
          )}px, 0, 0) translateX(-50%)`;
        }
      }

      const second = Math.round(position);
      if (second !== paintedSecRef.current) {
        paintedSecRef.current = second;
        if (elapsedRef.current) {
          const text = formatClock(position);
          if (elapsedRef.current.textContent !== text) {
            elapsedRef.current.textContent = text;
          }
        }
        if (totalRef.current) {
          const text = formatClock(duration);
          if (totalRef.current.textContent !== text) {
            totalRef.current.textContent = text;
          }
        }
        if (inputRef.current && !scrubbingRef.current) {
          const value = String(second);
          if (inputRef.current.value !== value) inputRef.current.value = value;
        }
      }
    };

    paintedRef.current = -1;
    paintedSecRef.current = -1;
    frameRef.current = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frameRef.current);
  }, [durationSec, positionSec, stalled]);

  const hold = (target: number) => {
    pendingRef.current = { target, expires: Date.now() + 4000 };
  };

  const commitScrub = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    const target = Number(event.currentTarget.value);
    hold(target);
    onSeek(target);
  };

  const seekBy = (delta: number) => {
    const next = Math.min(durationSec, Math.max(0, positionSec() + delta));
    hold(next);
    onSeek(next);
  };

  return (
    <div
      className={`-mx-2.5 rounded- bg-car px-2.5 pt-0 pb-5 ${className ?? ""}`}
    >
      <div className="px-2.5">
        <div ref={railRef} className="relative flex h-3.5 items-center">
          {/* left-0 with the offset applied as a transform: see the paint loop */}
          <span
            ref={bloomRef}
            aria-hidden
            className="pointer-events-none absolute left-0 size-[4.5px] rounded-full bg-[oklch(59%_0.165_253)] opacity-55 blur-[5px] will-change-transform"
          />

          <div className="absolute inset-x-0 h-[5px] overflow-hidden rounded-full bg-secondary">
            <div
              ref={fillRef}
              className="relative h-full rounded-full bg-gradient-seek"
            >
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-1/2 rounded-full bg-linear-to-b from-white/25 to-transparent"
              />
            </div>
          </div>
          <input
            ref={inputRef}
            disabled={inert}
            type="range"
            min={0}
            max={Math.max(1, Math.round(durationSec))}
            step={1}
            defaultValue={0}
            onPointerDown={() => {
              scrubbingRef.current = true;
            }}
            onPointerUp={commitScrub}
            onPointerCancel={commitScrub}
            aria-label="Seek"
            // no disabled fade: the input *is* the knob, and a translucent knob
            // over the rail reads as a rendering fault rather than an inert
            // control - a stall is said by the transport buttons instead
            className="seek-slider relative w-full cursor-pointer disabled:cursor-default"
          />
        </div>

        <div className="mt-1 flex justify-between font-mono tracking-tight text-[15.2px] font-[440] text-muted-foreground">
          <span ref={elapsedRef}>0:00</span>
          <span ref={totalRef}>0:00</span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-3.5">
        <button
          type="button"
          onClick={() => seekBy(-SEEK_SECONDS)}
          disabled={inert}
          aria-label={`Back ${SEEK_SECONDS} seconds`}
          className={SIDE_BUTTON}
        >
          <SeekIcon direction="back" />
        </button>

        <button
          type="button"
          onClick={onToggle}
          disabled={inert}
          aria-label={playing ? "Pause" : "Play"}
          className="flex size-15 cursor-pointer touch-manipulation items-center justify-center rounded-full bg-primary text-primary-foreground transition-[scale] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform select-none active:scale-[0.94] active:duration-150 active:ease-[cubic-bezier(0.33,0,0.67,1)] disabled:cursor-default disabled:opacity-45 disabled:active:scale-100"
        >
          {/*
            Both icons are mounted the whole time and cross-fade in place.

            Swapping them outright was a hard cut in the middle of a control
            that is otherwise all easing, and it reads as a flicker rather than
            a change of state - more so now that the icon waits for the server,
            so the cut lands a moment after the tap with nothing leading into
            it. Stacked in one grid cell so neither is positioned absolutely
            and the button keeps sizing itself, and moving on `opacity` and
            `scale` alone, which the compositor can do without a repaint.
          */}
          <span className="grid size-8 place-items-center">
            <span
              className={`col-start-1 row-start-1 flex transition-[opacity,scale] duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${
                playing ? "scale-100 opacity-100" : "scale-[0.55] opacity-0"
              }`}
            >
              <PauseIcon />
            </span>
            <span
              className={`col-start-1 row-start-1 flex transition-[opacity,scale] duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${
                playing ? "scale-[0.55] opacity-0" : "scale-100 opacity-100"
              }`}
            >
              <PlayIcon />
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => seekBy(SEEK_SECONDS)}
          disabled={inert}
          aria-label={`Forward ${SEEK_SECONDS} seconds`}
          className={SIDE_BUTTON}
        >
          <SeekIcon direction="forward" />
        </button>
      </div>
    </div>
  );
}
