/**
 * Holds the media elements against the room clock.
 *
 * The elements themselves are owned by React (keyed per track, `src` rendered),
 * so this only drives position and transport. That split matters: assigning
 * `.src` on a live element carries the previous load's state forward, which is
 * how a mid-buffer track change ends up wedged.
 *
 * Two sourcing modes:
 *
 *   download  one element carries picture and sound; it is the master.
 *   split     a video-only CDN stream plus separate audio. The audio is the
 *             master because it is served from our own box and its clock is
 *             smooth; the video is a throttled third-party stream.
 *
 * The rule that makes or breaks this: **a split video is never seeked to chase
 * the server clock.** It buffers on its own schedule, so drift-seeking it
 * restarts the buffering, which widens the drift, which seeks again - a
 * feedback loop that freezes the picture while the audio plays on. It is
 * re-anchored only when playback genuinely jumps (a seek, or a new track), and
 * otherwise kept level with the audio by trimming its playback rate.
 */

/** Beyond this the split video is snapped onto the audio rather than eased. */
const AV_HARD_SEC = 0.4;
/** Covers seek/decode latency. More than this leaves the picture ahead. */
const AV_SNAP_LEAD = 0.05;
/** Rate authority for the soft A/V correction. */
const AV_MAX_RATE = 0.12;
/** One snap at a time, so a stalled stream gets to play instead of restacking. */
const AV_SNAP_COOLDOWN_MS = 1200;
/** A/V is checked often - it is cheap and lip-sync is unforgiving. */
const AV_INTERVAL_MS = 120;

/** The master may drift this far from the room before it is corrected. */
const MASTER_DRIFT_SEC = 1.0;
/** Download mode tolerates a little more: one element, so a seek is audible. */
const DOWNLOAD_DRIFT_SEC = 1.2;
/** Master drift is checked rarely; local playback barely needs correcting. */
const MASTER_INTERVAL_MS = 3000;

/** A jump this large is a real seek or a track change, not accumulated drift. */
const ANCHOR_MOVE_SEC = 1.5;

/**
 * How long a stall must last before it counts.
 *
 * `waiting` fires for momentary dips all the time during ordinary streaming.
 * Surfacing those directly makes the spinner strobe and the transport flicker
 * between enabled and disabled - worse to look at than the stall itself. Going
 * *out* of the stalled state is never delayed, so recovery still feels instant.
 */
const STALL_GRACE_MS = 400;

/** Below this, catching up would cost more than the gap is worth. */
const CATCH_UP_SEC = 0.5;
/** Floor between catch-ups, so a seek that needs data can't retrigger itself. */
const CATCH_UP_COOLDOWN_MS = 2000;

const STALLS_BEFORE_DOWNGRADE = 2;

export type MediaHandles = {
  video: HTMLVideoElement | null;
  audio: HTMLAudioElement | null;
};

export type BufferingState = {
  /** The audible element is starved - the room waits for it. */
  blocking: boolean;
  /** Only the picture is behind; sound and the transport carry on. */
  video: boolean;
};

export class MediaEngine {
  #handles: MediaHandles = { video: null, audio: null };

  /** True when a separate audio element is the master (split sourcing). */
  #split = false;
  #playing = false;

  /**
   * Where playback was last deliberately anchored, and when. Both are needed:
   * comparing the room clock against a frozen anchor flags a "jump" the moment
   * normal playback has advanced past the threshold, which turns every snapshot
   * into a seek and the track into a permanent rebuffer loop.
   */
  #anchor = -1;
  #anchorAt = 0;
  #snapCooldown = 0;
  #stalls = 0;

  #avTimer: ReturnType<typeof setInterval> | null = null;
  #masterTimer: ReturnType<typeof setInterval> | null = null;

  /** Set when the browser refused to start unmuted audio without a gesture. */
  #buffering: BufferingState = { blocking: false, video: false };
  /** Reads the room clock. Held so a stall recovery can consult it directly. */
  #readPosition: (() => number) | null = null;
  #lastCatchUpAt = 0;
  #onBuffering: ((state: BufferingState) => void) | null = null;
  #stallTimers: Partial<Record<keyof BufferingState, ReturnType<typeof setTimeout>>> = {};
  #unbinders: (() => void)[] = [];

  #blocked = false;
  #gestureBound = false;
  #onBlockedChange: ((blocked: boolean) => void) | null = null;

  /**
   * Point at the elements and watch them stall.
   *
   * `blocking` means the audible element is starved - everything waits. `video`
   * means only the picture is behind, which under split sourcing is routine:
   * the CDN stream throttles while our own audio plays on perfectly well, and
   * freezing the room for that would be wrong.
   */
  attach(handles: MediaHandles, split: boolean): void {
    this.#unbind();
    this.#handles = handles;
    this.#split = split;
    this.#buffering = { blocking: false, video: false };

    const master = split ? handles.audio : handles.video;
    const picture = handles.video;

    const bind = (
      element: HTMLMediaElement | null,
      key: "blocking" | "video",
    ) => {
      if (!element) return;
      const stalled = () => this.#setBuffering(key, true);
      const flowing = () => this.#setBuffering(key, false);
      // `waiting` fires when playback halts for data; `playing`/`canplay` when
      // it can continue. `stalled` alone is unreliable across engines.
      element.addEventListener("waiting", stalled);
      element.addEventListener("playing", flowing);
      element.addEventListener("canplay", flowing);
      this.#unbinders.push(() => {
        element.removeEventListener("waiting", stalled);
        element.removeEventListener("playing", flowing);
        element.removeEventListener("canplay", flowing);
      });
    };

    bind(master, "blocking");
    // in download mode the single element is both, and is already bound above
    if (split) bind(picture, "video");
  }

  #setBuffering(key: keyof BufferingState, value: boolean): void {
    const pending = this.#stallTimers[key];
    if (pending) {
      clearTimeout(pending);
      delete this.#stallTimers[key];
    }
    if (value) {
      // hold off - most of these resolve within a frame or two
      if (this.#buffering[key]) return;
      this.#stallTimers[key] = setTimeout(
        () => this.#commitBuffering(key, true),
        STALL_GRACE_MS,
      );
      return;
    }
    this.#commitBuffering(key, false);
  }

  #commitBuffering(key: keyof BufferingState, value: boolean): void {
    delete this.#stallTimers[key];
    if (this.#buffering[key] === value) return;
    this.#buffering = { ...this.#buffering, [key]: value };
    if (key === "blocking") {
      // the picture waits for the audio, and resumes with it
      this.#driveVideo(this.#playing);
      // and on recovery, jump back onto the room clock rather than resuming
      // from where the stall left off - otherwise every buffer permanently
      // sets this viewer further behind everyone else in the room
      if (!value) this.#catchUp();
    }
    this.#onBuffering?.(this.#buffering);
  }

  /**
   * Re-join the room after a stall.
   *
   * A media element resumes from where it stopped, so a viewer who buffered for
   * four seconds is four seconds behind for the rest of the track, and the gap
   * only grows with each stall. Skipping forward costs the few seconds that
   * were missed, which is the point of watching together.
   */
  #catchUp(): void {
    const master = this.master;
    if (!master || !this.#playing || !this.#readPosition) return;

    const now = Date.now();
    if (now - this.#lastCatchUpAt < CATCH_UP_COOLDOWN_MS) return;

    const target = this.#readPosition();
    if (Math.abs(master.currentTime - target) < CATCH_UP_SEC) return;

    this.#lastCatchUpAt = now;
    this.#setAnchor(target);
    try {
      master.currentTime = target;
    } catch {
      // metadata not ready; the periodic guard will land it
    }
    if (this.#split) this.#snapVideo(target);
  }

  onBufferingChange(fn: (state: BufferingState) => void): void {
    this.#onBuffering = fn;
  }

  #unbind(): void {
    for (const off of this.#unbinders) off();
    this.#unbinders = [];
    for (const timer of Object.values(this.#stallTimers)) clearTimeout(timer);
    this.#stallTimers = {};
  }

  onBlockedChange(fn: (blocked: boolean) => void): void {
    this.#onBlockedChange = fn;
  }

  get master(): HTMLMediaElement | null {
    return this.#split ? this.#handles.audio : this.#handles.video;
  }

  // ── transport ──────────────────────────────────────────────────────────────

  /**
   * Apply the room's position and transport state.
   *
   * `positionSec` is the room clock. The master is nudged onto it only when it
   * has genuinely drifted; the split video is left alone entirely - the A/V
   * loop keeps it level with the audio, which is a far better reference than a
   * clock it can't keep up with.
   */
  sync(positionSec: number, playing: boolean): void {
    this.#playing = playing;

    // The picture is driven first and independently. It used to sit behind the
    // master's readiness check below, so a track whose audio hadn't loaded yet
    // left the video parked on its poster until something else happened to
    // nudge it - audible playback with a frozen thumbnail.
    this.#driveVideo(playing);

    const master = this.master;
    if (!master || !master.src) return;

    const jumped = Math.abs(positionSec - this.#expectedPosition()) > ANCHOR_MOVE_SEC;
    const tolerance = this.#split ? MASTER_DRIFT_SEC : DOWNLOAD_DRIFT_SEC;
    const drifted = Math.abs(master.currentTime - positionSec) > tolerance;

    if ((jumped || drifted) && !master.seeking) {
      this.#setAnchor(positionSec);
      try {
        master.currentTime = positionSec;
      } catch {
        // metadata isn't ready - `anchorOnLoad` lands it instead
      }
      // a real jump re-anchors the video too; ordinary drift never does
      if (jumped && this.#split) this.#snapVideo(positionSec);
    }

    if (playing) this.#play(master);
    else if (!master.paused) master.pause();
  }

  #setAnchor(positionSec: number): void {
    this.#anchor = positionSec;
    this.#anchorAt = Date.now();
  }

  /**
   * Where the anchor would have reached on its own by now.
   *
   * A discontinuity is the room clock disagreeing with *this* - not with a
   * stale mark that ordinary playback has long since moved past.
   */
  #expectedPosition(): number {
    if (this.#anchor < 0) return Number.NEGATIVE_INFINITY;
    if (!this.#playing) return this.#anchor;
    return this.#anchor + (Date.now() - this.#anchorAt) / 1000;
  }

  /**
   * Transport for the picture.
   *
   * Split video is muted, so it autoplays without a gesture and never needs the
   * blocked-autoplay dance. It is held back only while the *audio* is starved:
   * sound is the thing being watched together, so when it stalls the picture
   * waits with it rather than running on ahead.
   */
  #driveVideo(playing: boolean): void {
    const video = this.#handles.video;
    if (!this.#split || !video || !video.src) return;

    const wanted = playing && !this.#buffering.blocking;
    if (wanted && video.paused) void video.play().catch(() => {});
    else if (!wanted && !video.paused) video.pause();
  }

  /** A freshly loaded source starts at zero; put it where the room is. */
  anchorOnLoad(positionSec: number): void {
    const master = this.master;
    if (master && Math.abs(master.currentTime - positionSec) > 0.5) {
      try {
        master.currentTime = positionSec;
      } catch {
        // still not ready; the periodic guard will catch it
      }
    }
    this.#setAnchor(positionSec);
    if (this.#split) this.#snapVideo(positionSec);
    if (this.#playing && master) this.#play(master);
  }

  #snapVideo(positionSec: number): void {
    const video = this.#handles.video;
    if (!video || video.seeking) return;
    try {
      video.currentTime = positionSec;
      video.playbackRate = 1;
      this.#snapCooldown = Date.now() + AV_SNAP_COOLDOWN_MS;
    } catch {
      // not ready yet
    }
  }

  // ── autoplay ───────────────────────────────────────────────────────────────

  /**
   * Start the master, and notice when the browser refuses.
   *
   * Unmuted audio needs user activation, and a track that advances on its own
   * has no gesture behind it - so a rejection here is the whole difference
   * between sound and silence. It is retried on the next touch anywhere in the
   * document, which recovers without needing a control of its own.
   */
  #play(element: HTMLMediaElement): void {
    if (!element.paused) return;
    const attempt = element.play();
    if (!attempt) return;
    void attempt
      .then(() => this.#setBlocked(false))
      .catch((error: unknown) => {
        // an AbortError just means a seek interrupted it; only a refusal counts
        if ((error as { name?: string })?.name !== "NotAllowedError") return;
        this.#setBlocked(true);
        this.#bindGesture();
      });
  }

  #setBlocked(blocked: boolean): void {
    if (this.#blocked === blocked) return;
    this.#blocked = blocked;
    this.#onBlockedChange?.(blocked);
  }

  #bindGesture(): void {
    if (this.#gestureBound || typeof document === "undefined") return;
    this.#gestureBound = true;

    const resume = () => {
      this.#gestureBound = false;
      document.removeEventListener("pointerdown", resume, true);
      document.removeEventListener("touchend", resume, true);
      const master = this.master;
      // both elements start inside the same gesture, or the video races ahead
      if (this.#playing && master) {
        this.#play(master);
        const video = this.#handles.video;
        if (this.#split && video?.paused) void video.play().catch(() => {});
      }
    };

    document.addEventListener("pointerdown", resume, true);
    document.addEventListener("touchend", resume, true);
  }

  // ── loops ──────────────────────────────────────────────────────────────────

  /** Start the periodic controllers. Safe to call repeatedly. */
  run(readPosition: () => number): void {
    this.stop();
    this.#readPosition = readPosition;

    this.#masterTimer = setInterval(() => {
      const master = this.master;
      if (!this.#playing || !master || master.paused || master.seeking) return;
      // a starved element is behind by definition; seeking it now just restarts
      // the buffering. Recovery is handled by `#catchUp` the moment data lands.
      if (this.#buffering.blocking) return;
      const target = readPosition();
      const tolerance = this.#split ? MASTER_DRIFT_SEC : DOWNLOAD_DRIFT_SEC;
      if (Math.abs(master.currentTime - target) > tolerance) {
        try {
          master.currentTime = target;
          this.#setAnchor(target);
        } catch {
          // not ready
        }
      }
    }, MASTER_INTERVAL_MS);

    if (!this.#split) return;

    this.#avTimer = setInterval(() => {
      const { video, audio } = this.#handles;
      if (!video || !audio || audio.paused || Number.isNaN(audio.currentTime)) return;

      const drift = video.currentTime - audio.currentTime; // positive = ahead
      if (Math.abs(drift) > AV_HARD_SEC) {
        const now = Date.now();
        if (!video.seeking && now >= this.#snapCooldown) {
          video.playbackRate = 1;
          try {
            video.currentTime = audio.currentTime + AV_SNAP_LEAD;
            this.#snapCooldown = now + AV_SNAP_COOLDOWN_MS;
          } catch {
            // metadata not ready
          }
        }
        return;
      }

      // proportional ease: behind speeds up, ahead slows down
      const rate = 1 - Math.max(-AV_MAX_RATE, Math.min(AV_MAX_RATE, drift * 0.6));
      if (Math.abs(video.playbackRate - rate) > 0.005) video.playbackRate = rate;
    }, AV_INTERVAL_MS);
  }

  stop(): void {
    if (this.#masterTimer) clearInterval(this.#masterTimer);
    if (this.#avTimer) clearInterval(this.#avTimer);
    this.#masterTimer = null;
    this.#avTimer = null;
  }

  /** A stall at the current quality; two in a row asks for a lower rung. */
  noteStall(): boolean {
    this.#stalls += 1;
    if (this.#stalls < STALLS_BEFORE_DOWNGRADE) return false;
    this.#stalls = 0;
    return true;
  }

  /** A new track resets the anchor so its first sync isn't suppressed. */
  resetTrack(): void {
    this.#anchor = -1;
    this.#anchorAt = 0;
    this.#stalls = 0;
    this.#snapCooldown = 0;
  }

  destroy(): void {
    this.stop();
    this.#unbind();
    this.#onBuffering = null;
    this.#onBlockedChange = null;
    this.#handles = { video: null, audio: null };
  }
}
