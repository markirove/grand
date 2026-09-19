"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type SyntheticEvent,
} from "react";

import { impact } from "@/lib/haptics";
import { wideFallback } from "@/lib/thumbnail";
import type { LyricLine } from "@/lib/lyrics";

import { LyricsView } from "./lyrics-view";

export type PlayRatio = "16:9" | "1:1" | "9:16";

/** The outer box: how the stage is placed in the column. */
const FRAME_CLASS: Record<PlayRatio, string> = {
  "16:9": "-mx-2.5 rounded-none",
  "1:1": "mx-auto w-full max-w-[46svh] rounded-2xl",
  "9:16": "mx-auto w-full max-w-[26svh] rounded-2xl",
};

const FLIP_MS = 520;
const FLIP_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

/** The picture itself, which keeps its shape whatever the panel below does. */
const RATIO_CLASS: Record<PlayRatio, string> = {
  "16:9": "aspect-video",
  "1:1": "aspect-square",
  "9:16": "aspect-[9/16]",
};

/**
 * How much of the viewport the lyrics take when focused. Enough for five or
 * six lines: the one being sung, a couple behind it for context, and enough
 * ahead to read into.
 */
const PANEL_HEIGHT = "calc(var(--app-height) * 0.34)";

const PANEL_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const PANEL_MS = 420;

/**
 * Clients that open a mini app in a floating window instead of filling the
 * screen - the only ones with a window left to claim.
 *
 * `macos` is the native Mac app, `tdesktop` the desktop build shipped for
 * Windows (and Linux, and Mac). Phones are deliberately absent: `android` and
 * `ios` are already fullscreen by the time the stage opens, courtesy of
 * `TelegramFullscreen`, so asking again would be noise at best. Browser
 * clients (`weba`, `webk`) are left out too - the mini app is an iframe inside
 * a page there, and what "fullscreen" means is the browser's business.
 */
const WINDOWED_PLATFORMS = new Set(["macos", "tdesktop"]);

type Props = {
  ratio?: PlayRatio;
  className?: string;
  /** Object refs, not callbacks: the follow loop reads these elements' clocks. */
  videoRef?: RefObject<HTMLVideoElement | null>;
  audioRef?: RefObject<HTMLAudioElement | null>;
  /**
   * Sources are rendered, not assigned imperatively, and the elements are keyed
   * per track so React builds a fresh one each time. Mutating `.src` on a live
   * element leaves the previous load's state attached to it, which is how a
   * mid-buffer track change ends up wedged and silent.
   */
  trackKey: string;
  videoSrc?: string | null;
  /** Present only under split sourcing, where it is the audible master. */
  audioSrc?: string | null;
  posterUrl?: string | null;
  /** Show the stall spinner over the stage. */
  buffering?: boolean;
  /** Replaces the stage with a message - a geo-block, say. */
  notice?: string | null;
  /**
   * Offer the expand control. Audio-only tracks are left out: blowing a static
   * poster up to the whole viewport gains the viewer nothing.
   */
  canExpand?: boolean;
  /**
   * Told when the stage pins itself over the viewport, so the screen around it
   * can react - the top bar lifts above the stage rather than being buried by
   * it. Reported rather than controlled: expanding is the stage's own affair,
   * and handing the state out is cheaper than hoisting it and passing it back.
   */
  onExpandedChange?: (expanded: boolean) => void;
  /** Timed lyrics for this track, when the lookup found any. */
  lyrics?: LyricLine[] | null;
  /** The room clock. A fallback here, not the thing the words follow. */
  positionSec?: () => number;
};

/**
 * Trim taken off every line's timestamp.
 *
 * LRC timings are written a beat ahead of the vocal on purpose - they are made
 * for singing along, so the line is up before you have to sing it. That lead is
 * right for karaoke and wrong for reading along with a room, so a quarter
 * second comes off the top. Negative delays the words; positive would bring
 * them forward.
 */
const OFFSET_SEC = -0.25;

/**
 * Past this the element isn't merely lagging, it is somewhere else entirely -
 * still loading, or mid-seek with `currentTime` not yet moved. The room clock
 * is the better answer then.
 */
const TRUST_LIMIT_SEC = 3;

/**
 * Stall indicator. Two rings rather than a spinning arc: the track stays put so
 * the shape reads as a fixed object with something travelling round it, which
 * is legible at this size against moving video underneath.
 */
function Spinner() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[oklch(0%_0_0/0.22)]"
    >
      <span className="size-8 animate-spin rounded-full border-[2.5px] border-white/25 border-t-white/90" />
    </span>
  );
}

function ExpandIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="size-[19px] shrink-0"
    >
      <path d="M2.5 12C2.5 7.52166 2.5 5.28249 3.89124 3.89124C5.28249 2.5 7.52166 2.5 12 2.5C16.4783 2.5 18.7175 2.5 20.1088 3.89124C21.5 5.28249 21.5 7.52166 21.5 12C21.5 16.4783 21.5 18.7175 20.1088 20.1088C18.7175 21.5 16.4783 21.5 12 21.5C7.52166 21.5 5.28249 21.5 3.89124 20.1088C2.5 18.7175 2.5 16.4783 2.5 12Z" />
      {expanded ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M11.0167 11.0167C11.5915 10.4419 11.4959 8 11.4959 8M11.0167 11.0167C10.4419 11.5915 8 11.4958 8 11.4958M11.0167 11.0167L7 7M12.9869 12.9868C13.5617 12.412 16.0036 12.5077 16.0036 12.5077M12.9869 12.9868C12.4121 13.5616 12.5078 16.0035 12.5078 16.0035M12.9869 12.9868L17 16.9999"
        />
      ) : (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7.4852 16.5149C6.9104 15.9401 7.00595 13.4982 7.00595 13.4982M7.4852 16.5149C8.06001 17.0897 10.5019 16.994 10.5019 16.994M7.4852 16.5149L11 13M16.5149 7.48512C15.9401 6.91031 13.4982 7.00596 13.4982 7.00596M16.5149 7.48512C17.0897 8.05993 16.994 10.5018 16.994 10.5018M16.5149 7.48512L13 11"
        />
      )}
    </svg>
  );
}

/** Subtitle-style mark: a frame with two lines of type in it. */
function LyricsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className="size-[17px] shrink-0"
    >
      <path d="M2.5 12C2.5 8.22876 2.5 6.34315 3.67157 5.17157C4.84315 4 6.72876 4 10.5 4H13.5C17.2712 4 19.1569 4 20.3284 5.17157C21.5 6.34315 21.5 8.22876 21.5 12C21.5 15.7712 21.5 17.6569 20.3284 18.8284C19.1569 20 17.2712 20 13.5 20H10.5C6.72876 20 4.84315 20 3.67157 18.8284C2.5 17.6569 2.5 15.7712 2.5 12Z" />
      <path d="M6.5 10.5H11.5M14.5 10.5H17.5M6.5 14H9.5M12.5 14H17.5" />
    </svg>
  );
}

export function PlayBox({
  ratio = "16:9",
  className,
  videoRef,
  audioRef,
  trackKey,
  videoSrc,
  audioSrc,
  posterUrl,
  buffering = false,
  notice,
  canExpand = false,
  onExpandedChange,
  lyrics,
  positionSec,
}: Props) {
  /**
   * Expanded is drawn, not requested.
   *
   * The browser Fullscreen API is unavailable inside Telegram's WebView, so the
   * stage pins itself over the viewport with CSS instead - which behaves the
   * same on every client, and leaves the media element untouched so nothing
   * about playback or room sync changes when it opens.
   */
  const [expanded, setExpanded] = useState(false);
  /** Portrait viewport: the stage turns sideways so the frame fills the phone. */
  const [rotate, setRotate] = useState(false);

  /**
   * Focus: the box grows downward and the words take the new room. The picture
   * above it doesn't move an inch, so focusing reads as the stage opening up
   * rather than the page rearranging itself around a new panel.
   */
  const [focused, setFocused] = useState(false);

  const hasLyrics = Boolean(lyrics && lyrics.length > 0 && positionSec);

  /**
   * The square-artwork treatment audio tracks get, and whether it's turned over.
   *
   * Video keeps the wide stage and its drop-down panel: there is a picture to
   * watch there, and turning it over to read would mean choosing between the
   * two. A static square has nothing to lose by flipping.
   */
  const card = ratio === "1:1";
  const flipped = card && focused;

  /**
   * What the listener is actually hearing.
   *
   * Not the room clock: the engine lets the audible element sit up to a second
   * behind the room before it corrects, on purpose - a seek to shave off drift
   * is more audible than the drift. That tolerance is inaudible for playback
   * and glaring for lyrics, which is a line arriving before the voice does.
   * So the words follow the element's own clock and fall back to the room's
   * only while it has nothing to say.
   */
  const lyricsPosition = useCallback(() => {
    const room = positionSec?.() ?? 0;
    const element = audioSrc ? audioRef?.current : videoRef?.current;
    if (element && element.readyState >= 1) {
      const played = element.currentTime;
      if (Math.abs(played - room) <= TRUST_LIMIT_SEC) {
        return played + OFFSET_SEC;
      }
    }
    return room + OFFSET_SEC;
  }, [positionSec, audioSrc, audioRef, videoRef]);

  // Both of these are corrections during render rather than effects: the track
  // can change under an open panel, and the fix has to land in the same commit
  // as the prop that caused it - an effect would paint one frame of a
  // fullscreen stage with no exit, or an open panel with nothing in it.
  if (expanded && !canExpand) setExpanded(false);
  if (focused && !hasLyrics) setFocused(false);

  // After the commit, so the bar it lifts moves in the same frame the stage
  // goes fullscreen. Covers the correction above too - a track that loses its
  // video drops out of fullscreen, and the bar has to be told.
  useEffect(() => {
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);

  /**
   * Turn the card over on its own when the track has words.
   *
   * The Lyrics control is only discoverable if you go looking for it, and most
   * people don't - so a track that has lyrics shows them rather than waiting to
   * be asked. This is why the words are worth fetching at all.
   *
   * Keyed on the track so it fires once per track and never again: turning the
   * card back to the artwork is a decision, and an effect that re-ran on the
   * next render would overrule it. The user can't have expressed a preference
   * before the lookup lands either, because the control doesn't exist until
   * there are lyrics to toggle.
   */
  const autoFlipped = useRef<string | null>(null);
  useEffect(() => {
    if (!card || !hasLyrics || autoFlipped.current === trackKey) return;
    autoFlipped.current = trackKey;
    setFocused(true);
  }, [card, hasLyrics, trackKey]);

  useEffect(() => {
    if (!expanded) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    const syncOrientation = () =>
      setRotate(window.innerHeight > window.innerWidth);

    /*
      Take the whole Telegram window too, not just the stage inside it.

      Pinning the stage over the viewport only ever claimed the *mini app's*
      viewport, and on desktop that is a tall, narrow window floating on a
      wide screen. The stage measured it, found it portrait, and did the thing
      it does for a portrait phone - turned the video on its side. So the
      fullscreen control produced a small, tilted picture on the one platform
      with the most screen to give. Asking Telegram for the window first makes
      it landscape, and the rotation stops being the right answer on its own.

      Desktop only, per WINDOWED_PLATFORMS - a phone has no window to claim
      and is already fullscreen anyway.

      Only ever undoing our own doing: `TelegramFullscreen` keeps the app
      windowed on desktop and fullscreen on phones on purpose, so exiting
      unconditionally here would fight it. If the app was already fullscreen
      when we arrived, we leave it exactly as we found it.
    */
    const tg = window.Telegram?.WebApp;
    const canFullscreen = Boolean(
      tg &&
        WINDOWED_PLATFORMS.has(tg.platform ?? "") &&
        tg.isVersionAtLeast("8.0") &&
        tg.requestFullscreen,
    );
    const wasFullscreen = Boolean(tg?.isFullscreen);
    const ourFullscreen = canFullscreen && !wasFullscreen;

    if (ourFullscreen) {
      try {
        tg?.requestFullscreen?.();
      } catch {
      }
    }

    syncOrientation();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", syncOrientation);
    window.addEventListener("orientationchange", syncOrientation);
    // the window changing shape under us is a Telegram event, not always a
    // `resize` - the desktop client does not reliably fire one for either
    tg?.onEvent?.("fullscreenChanged", syncOrientation);
    tg?.onEvent?.("viewportChanged", syncOrientation);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", syncOrientation);
      window.removeEventListener("orientationchange", syncOrientation);
      tg?.offEvent?.("fullscreenChanged", syncOrientation);
      tg?.offEvent?.("viewportChanged", syncOrientation);
      if (ourFullscreen) {
        try {
          tg?.exitFullscreen?.();
        } catch {
        }
      }
    };
  }, [expanded]);

  const toggleExpanded = () => {
    impact("light");
    setExpanded((open) => !open);
  };

  const toggleFocus = () => {
    impact("light");
    setFocused((open) => !open);
  };

  /**
   * The track whose video has real picture in it, once the element says so.
   *
   * Compared against `trackKey` rather than reset on change, so the next track
   * starts behind its poster again without an effect to clear this.
   */
  const [paintedKey, setPaintedKey] = useState<string | null>(null);
  const showsPicture = paintedKey === trackKey;

  /*
    `videoWidth` is the whole test, and it has to be: in download mode an
    audio-only track plays through this same video element, invisible and with
    no picture to give. Zero means there is no frame coming and the poster is
    the only thing to look at - that is artwork, not a leak.
  */
  const onVideoFrame = (event: SyntheticEvent<HTMLVideoElement>) => {
    if (event.currentTarget.videoWidth > 0) setPaintedKey(trackKey);
  };

  /** `maxresdefault` isn't always there; drop to the guaranteed variant. */
  const onPosterError = (event: SyntheticEvent<HTMLImageElement>) => {
    const fallback = wideFallback(posterUrl);
    const img = event.currentTarget;
    if (fallback && img.src !== fallback) img.src = fallback;
  };

  const lyricsButton =
    hasLyrics && !notice && !expanded ? (
      <button
        type="button"
        onClick={toggleFocus}
        aria-expanded={focused}
        aria-label={focused ? "Hide lyrics" : "Show lyrics"}
        data-open={focused ? "" : undefined}
        className="absolute bottom-2 left-2 z-10 flex h-9 cursor-pointer touch-manipulation items-center gap-1.5 rounded-lg bg-[oklch(0%_0_0/0.45)] pr-2.5 pl-2 text-[13.5px] font-[500] text-white/90 backdrop-blur-sm transition-[scale,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] select-none active:scale-[0.94] active:duration-150 active:ease-[cubic-bezier(0.33,0,0.67,1)] data-[open]:bg-[oklch(100%_0_0/0.92)] data-[open]:text-[oklch(18%_0.004_264)]"
      >
        <LyricsIcon />
        Lyrics
      </button>
    ) : null;

  /*
    The stage, lifted out of the tree so it can be a card face.

    The media elements live in here and must not move: React keys them per
    track, and a change of position would rebuild them mid-playback. Nothing
    below re-parents them - the flip only ever changes a transform.
  */
  const stage = (
    <>
      {/*
        The poster is its own layer rather than the video's `poster`
        attribute. `maxresdefault` is the only high-resolution 16:9 frame
        YouTube offers and it is not always present, so this needs an error
        fallback - which the attribute cannot give us. It sits behind the
        video and leaves it in place for audio-only tracks. On a square card
        `object-cover` takes the centre crop, which is the whole picture for
        artwork and the subject for most anything else.

        It does *not* stay put under a video that has picture. `object-cover`
        fills the stage while the video is `object-contain`, so anything whose
        shape doesn't match the frame - a 4:3 upload, a phone clip on the wide
        stage - was letterboxed onto its own thumbnail instead of onto black.
        Faded rather than dropped: the element reports its first frame a beat
        before the compositor paints it, and the fade covers that gap that a
        hard unmount would flash black through.
      */}
      {posterUrl ? (
        <img
          key={`${trackKey}-poster`}
          src={posterUrl}
          alt=""
          aria-hidden
          onError={onPosterError}
          className={`pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-200 ease-out ${showsPicture ? "opacity-0" : "opacity-100"}`}
        />
      ) : null}

      {/*
        `playsInline` keeps iOS from hijacking playback into its own
        fullscreen player, which would pull this viewer out of sync with the
        room.

        `pointer-events-none` is load-bearing, not cosmetic: mobile WebViews
        and the Telegram in-app browser bind their own tap-to-toggle to the
        video surface, so without it a tap pauses playback behind the app's
        back - and fights the autoplay retry, which is listening for the
        same taps. Playback here is driven only by room snapshots.

        `muted` is left off entirely unless a separate audio element exists;
        under split sourcing this carries picture alone, but in download mode
        it is the only thing making sound - including for an audio-only track,
        where this element is invisible and still the one playing.
      */}
      <video
        key={`${trackKey}-video`}
        ref={videoRef}
        src={videoSrc ?? undefined}
        // both, because a stream that arrives already buffered can reach
        // `playing` without a fresh `loadeddata` behind it
        onLoadedData={onVideoFrame}
        onPlaying={onVideoFrame}
        playsInline
        controls={false}
        muted={audioSrc ? true : undefined}
        preload="auto"
        className="pointer-events-none relative size-full object-contain"
      />
      {audioSrc ? (
        <audio
          key={`${trackKey}-audio`}
          ref={audioRef}
          src={audioSrc}
          preload="auto"
        />
      ) : null}
      {notice ? (
        // The stream can't play at all, so this replaces the stall indicator
        // rather than stacking with it. Frosted rather than a flat scrim: the
        // poster stays legible underneath, so the stage still reads as *this*
        // track being unavailable rather than an empty black box.
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[oklch(0%_0_0/0.35)] px-6 text-center backdrop-blur-xl backdrop-saturate-150">
          <span className="text-[15px] leading-[1.4] font-[450] text-white/95 [text-shadow:0_1px_3px_oklch(0%_0_0/0.5)]">
            {notice}
          </span>
        </span>
      ) : buffering ? (
        <Spinner />
      ) : null}

      {/* Withheld while the stage is a notice: there is no picture to expand,
          and a control that opens a full-screen apology is just a taunt. */}
      {canExpand && !notice ? (
        <button
          type="button"
          onClick={toggleExpanded}
          aria-label={expanded ? "Exit fullscreen" : "Enter fullscreen"}
          className="absolute right-2 bottom-2 z-10 flex size-9 cursor-pointer touch-manipulation items-center justify-center rounded-lg bg-[oklch(0%_0_0/0.45)] text-white/90 backdrop-blur-sm transition-[scale,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] select-none active:scale-[0.94] active:bg-[oklch(0%_0_0/0.65)] active:duration-150 active:ease-[cubic-bezier(0.33,0,0.67,1)]"
        >
          <ExpandIcon expanded={expanded} />
        </button>
      ) : null}

      {/* The control only exists for tracks that actually came back with
          words, so its presence is the answer to "does this one have
          lyrics?" - nothing has to be greyed out or explained. */}
      {lyricsButton}
    </>
  );

  /*
    The card's other side: the same artwork, blurred past legibility, with the
    words over it.

    Blurred by `filter` on the image rather than a `backdrop-filter` above it -
    a backdrop filter has to sample a stacking context, and this one lives
    inside a `preserve-3d` subtree that is mid-rotation, which is exactly where
    that gets unreliable. Scaled up because a blur eats its own edges.
  */
  const lyricsFace = (
    <>
      {posterUrl ? (
        <img
          key={`${trackKey}-lyrics-bg`}
          src={posterUrl}
          alt=""
          aria-hidden
          onError={onPosterError}
          className="pointer-events-none absolute inset-0 size-full scale-125 object-cover blur-2xl"
        />
      ) : null}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[oklch(0%_0_0/0.42)]"
      />

      {/*
        The lyrics keep their own type and motion; only their palette changes,
        and it changes by re-pointing the two tokens they read rather than by
        teaching the view about backgrounds. `text-shadow` inherits, so one
        declaration here covers every line.
      */}
      <div
        style={
          {
            "--foreground": "oklch(100% 0 0)",
            "--muted-foreground": "oklch(100% 0 0)",
          } as CSSProperties
        }
        className="absolute inset-0 [text-shadow:0_1px_6px_oklch(0%_0_0/0.5)]"
      >
        <LyricsView
          lines={lyrics ?? []}
          positionSec={lyricsPosition}
          active={flipped}
          className="size-full px-4"
        />
      </div>

      <button
        type="button"
        onClick={toggleFocus}
        aria-expanded
        aria-label="Hide lyrics"
        className="absolute bottom-2 left-2 z-10 flex h-9 cursor-pointer touch-manipulation items-center gap-1.5 rounded-lg bg-[oklch(0%_0_0/0.45)] pr-2.5 pl-2 text-[13.5px] font-[500] text-white/90 backdrop-blur-sm transition-[scale] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] select-none active:scale-[0.94] active:duration-150 active:ease-[cubic-bezier(0.33,0,0.67,1)]"
      >
        <LyricsIcon />
        Lyrics
      </button>
    </>
  );

  return (
    <div
      className={`bg-stage transition-[margin,border-radius] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${FRAME_CLASS[ratio]} ${className ?? ""}`}
    >
      {/*
        Two boxes, because expanding lifts the stage out of the column: the
        outer one keeps holding the aspect-ratio slot so nothing below it jumps
        up and back, and the inner one is what actually flies to the viewport.
      */}
      {/* `rounded-[inherit]` here is what makes the radius reach the faces:
          `inherit` takes the *parent's* computed value, so a box with no radius
          of its own resolves to 0 and every layer below it squares off. This
          box sat between the frame and the stage doing exactly that - invisible
          while the only ratio in use was the square-cornered 16:9 one. */}
      <div className={`relative rounded-[inherit] ${RATIO_CLASS[ratio]}`}>
        <div
          className={
            expanded
              ? // `touch-none`: the stage is still a descendant of the player's
                // scroller, so without it a drag over the expanded frame quietly
                // scrolls the column hidden behind it
                "fixed z-[80] flex touch-none items-center justify-center overflow-hidden bg-black"
              : card
                ? // No `overflow-hidden` here: the faces clip themselves, and a
                  // clip on the element holding the perspective flattens the
                  // rotation in some engines.
                  "absolute inset-0 rounded-[inherit] [perspective:1400px]"
                : "absolute inset-0 overflow-hidden rounded-[inherit] bg-stage"
          }
          style={
            expanded
              ? rotate
                ? {
                    // sideways: the box is measured against the *other* axis, so
                    // a portrait phone still gets a full-width landscape frame
                    top: "50%",
                    left: "50%",
                    width: "100vh",
                    height: "100vw",
                    transform: "translate(-50%, -50%) rotate(90deg)",
                  }
                : { inset: 0 }
              : undefined
          }
        >
          {card ? (
            /*
              Two faces on one turning plane. `backface-visibility` is what
              picks which is showing, so both are mounted the whole time and
              the flip costs one transform - no mount, no layout, and the
              media on the front is never touched.
            */
            <div
              className="relative size-full rounded-[inherit] [transform-style:preserve-3d]"
              style={{
                transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
                transition: `transform ${FLIP_MS}ms ${FLIP_EASE}`,
              }}
            >
              <div className="absolute inset-0 overflow-hidden rounded-[inherit] bg-stage [backface-visibility:hidden]">
                {stage}
              </div>
              <div className="absolute inset-0 overflow-hidden rounded-[inherit] bg-stage [backface-visibility:hidden] [transform:rotateY(180deg)]">
                {lyricsFace}
              </div>
            </div>
          ) : (
            stage
          )}
        </div>
      </div>

      {/*
        The wide stage's panel: always mounted once a track has lyrics, and it
        opens by height alone. Mounting it on focus would cost a layout of
        every line at the moment the animation starts, which is exactly when
        there is no frame budget to spare.

        A card has no use for it - its words are on the back - and leaving it in
        would open both at once.
      */}
      {hasLyrics && !card ? (
        <div
          style={{
            height: focused ? PANEL_HEIGHT : "0px",
            transition: `height ${PANEL_MS}ms ${PANEL_EASE}, opacity ${PANEL_MS}ms ${PANEL_EASE}`,
            opacity: focused ? 1 : 0,
          }}
          className="overflow-hidden bg-stage"
        >
          <LyricsView
            lines={lyrics ?? []}
            positionSec={lyricsPosition}
            active={focused}
            className="h-full px-3 py-1"
          />
        </div>
      ) : null}
    </div>
  );
}
