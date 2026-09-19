"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { TelegramFullscreen } from "@/app/telegram-fullscreen";
import { viewerCountry } from "@/lib/geo";
import { MediaEngine, type BufferingState } from "@/lib/media-engine";
import { roomDisplayName } from "@/lib/room-name";
import { withRoomToken, type RoomTrack } from "@/lib/room-protocol";
import { wideThumbnail } from "@/lib/thumbnail";
import { siteConfig } from "@/site/config";

import { RoomUnavailable } from "../room-unavailable";
import { useRoomSession } from "../session-provider";
import { RoomLiveProvider, useRoom, useRoomStore } from "./live-provider";
import { ParticipantsLane, type LaneNotice } from "./participants-lane";
import { PersonChip } from "./person-chip";
import { PlaybackControls } from "./playback-controls";
import { PlayBox, type PlayRatio } from "./play-box";
import { EmptyState } from "./empty-state";
import { PlayerDecks } from "./player-decks";
import type { QueueTrack } from "./queue-list";
import { TrackTitle } from "./track-title";
import { useLyrics } from "./use-lyrics";

/** Wording for the activity lane, mirroring the bot's own event vocabulary. */
const EVENT_COPY: Record<string, (actor: string, detail?: string) => string> = {
  join: (actor) => `${actor} joined`,
  leave: (actor) => `${actor} left`,
  add: (actor, detail) => (detail ? `${actor} queued ${detail}` : `${actor} queued a track`),
  skip: (actor) => `${actor} skipped the track`,
  clear: (actor) => `${actor} cleared the queue`,
  // the bot sends the landing point as `detail`, already clock-formatted
  seek: (actor, detail) => (detail ? `${actor} seeked to ${detail}` : `${actor} seeked`),
  pause: (actor) => `${actor} paused`,
  resume: (actor) => `${actor} resumed`,
};

const EVENT_TONE: Record<string, LaneNotice["tone"]> = {
  join: "join",
  leave: "leave",
  add: "info",
  skip: "info",
  clear: "info",
  seek: "info",
  pause: "info",
  resume: "info",
};

/** Country names for the codes we bother to spell out. */
const GEO_NAMES: Record<string, string> = { sg: "Singapore" };

/**
 * A googlevideo URL carries `gcr` when the stream is locked to one country.
 * Nothing client-side can get around it, so say so plainly rather than letting
 * the viewer stare at a stage that will never load.
 *
 * Unless the viewer is already in that country - then the lock is not their
 * problem and telling them to reach for a VPN would be wrong twice over: the
 * stream plays, and the advice would break it if taken.
 */
function geoNotice(url: string | null | undefined, viewerIn: string | null): string | null {
  if (!url) return null;
  try {
    const code = new URL(url).searchParams.get("gcr")?.toLowerCase();
    if (!code || code === viewerIn) return null;
    const where = GEO_NAMES[code] ?? code.toUpperCase();
    return `Use ${where} VPN to access this content`;
  } catch {
    return null;
  }
}

/**
 * Resolved after mount, never during render: the server's own country is not
 * the viewer's, and rendering it would both mislead and mismatch on hydration.
 * Until it lands the notice behaves exactly as it did before - shown.
 */
function useViewerCountry(): string | null {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    setCode(viewerCountry());
  }, []);
  return code;
}

function toQueueTrack(track: RoomTrack): QueueTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist || (track.video ? "Video" : "Audio"),
    durationSec: track.duration ?? undefined,
    artworkUrl: wideThumbnail(track.thumbnail),
    requestedBy: { name: track.requestedBy },
  };
}

function PlayerBody({ token }: { token: string }) {
  const store = useRoomStore();

  const snapshot = useRoom((state) => state.snapshot);
  const current = useRoom((state) => state.snapshot?.current ?? null);
  /**
   * Whether the room is running, straight from the server and nowhere else.
   *
   * Nothing here anticipates a tap. A control is a request, and until the
   * answer arrives this client has no more idea what the room is doing than
   * anyone else in it - so the button, the scrubber and the media all wait
   * together rather than one of them getting ahead.
   */
  const playing = useRoom((state) => state.snapshot?.playing ?? false);
  const participants = useRoom((state) => state.snapshot?.participants);
  const queue = useRoom((state) => state.snapshot?.queue);
  const self = useRoom((state) => state.self);
  const event = useRoom((state) => state.event);
  /**
   * Socket state, read only for the top bar.
   *
   * `reconnecting` is specifically a connection that had been open and is being
   * retried - the first connect is `connecting`, and there is no pill on screen
   * then anyway, because the bar waits for a snapshot before it renders.
   */
  const reconnecting = useRoom((state) => state.status === "reconnecting");
  const country = useViewerCountry();

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const engine = useMemo(() => new MediaEngine(), []);

  /**
   * Stall state, in React because it changes rarely and gates real UI. The two
   * halves are deliberately separate: a throttled CDN video is routine and must
   * not freeze the room, whereas starved audio is the room stopping.
   */
  const [buffering, setBuffering] = useState<BufferingState>({
    blocking: false,
    video: false,
  });

  useEffect(() => {
    engine.onBufferingChange(setBuffering);
  }, [engine]);

  /**
   * Sources, derived rather than assigned.
   *
   * `split` needs both a mode *and* a URL, and the bot mints the video URL
   * asynchronously - so the first snapshot of a split track says "split" with
   * no `videoUrl` yet. Recomputing every snapshot lets the track pick the mode
   * up the moment it lands; latching it on the first one strands the track in
   * the wrong mode for its whole duration.
   */
  const sources = useMemo(() => {
    if (!current) return { key: "idle", video: null, audio: null, split: false };
    const split = current.sourceMode === "split" && Boolean(current.videoUrl);
    const ladder = [...(current.videoQualities ?? [])].sort(
      (a, b) => b.height - a.height,
    );
    const media = withRoomToken(current.mediaUrl, token);
    return {
      // the mode is part of the key: when split arrives late the elements must
      // be rebuilt, not repointed
      key: `${current.id}-${split ? "split" : "download"}`,
      video: split ? (ladder[0]?.url ?? current.videoUrl ?? null) : media,
      audio: split ? media : null,
      split,
    };
  }, [current, token]);

  useEffect(() => {
    engine.resetTrack();
    engine.attach({ video: videoRef.current, audio: audioRef.current }, sources.split);
    engine.run(() => store.positionSec());

    const master = sources.split ? audioRef.current : videoRef.current;
    const onLoaded = () => engine.anchorOnLoad(store.positionSec());
    master?.addEventListener("loadedmetadata", onLoaded);

    const video = videoRef.current;
    const onStall = () => engine.noteStall();
    video?.addEventListener("stalled", onStall);
    video?.addEventListener("waiting", onStall);

    return () => {
      master?.removeEventListener("loadedmetadata", onLoaded);
      video?.removeEventListener("stalled", onStall);
      video?.removeEventListener("waiting", onStall);
      engine.stop();
    };
  }, [engine, store, sources.key, sources.split]);

  useEffect(() => () => engine.destroy(), [engine]);

  // transport changes land immediately; the loops handle everything else
  useEffect(() => {
    if (!current) return;
    engine.sync(store.positionSec(), playing);
  }, [
    engine,
    store,
    current,
    playing,
    snapshot?.startedAt,
    snapshot?.pausedPositionSec,
  ]);

  const canControl = self?.canControl ?? false;

  const onToggle = useCallback(() => {
    if (!canControl) return;
    // the room's state, which is the only state there is - a second tap during
    // a round trip simply re-sends the request already in flight
    store.control({ action: playing ? "pause" : "play" });
  }, [store, canControl, playing]);

  const onSeek = useCallback(
    (positionSec: number) => {
      if (!canControl) return;
      store.control({ action: "seek", positionSec });
    },
    [store, canControl],
  );

  const position = useCallback(() => store.positionSec(), [store]);

  /**
   * Looked up per track, off the render path - nothing below waits on it, and
   * a track without timed lyrics simply never produces any, so the stage keeps
   * the shape it already had.
   */
  const lyrics = useLyrics(
    current && { ...current, artist: current.lyricsArtist ?? current.artist },
  );

  const lane = useMemo(
    () =>
      (participants ?? []).map((participant) => ({
        id: participant.id,
        name: participant.id === self?.id ? "You" : participant.name,
        avatarUrl: withRoomToken(participant.photoUrl, token),
        presence: participant.present ? ("present" as const) : ("idle" as const),
      })),
    [participants, self?.id, token],
  );

  // The lane cycles a list, but the socket delivers one event at a time - so
  // the latest becomes a single-entry list, keyed by seq so a repeat replays.
  const notices = useMemo<LaneNotice[]>(() => {
    if (!event) return [];
    const copy = EVENT_COPY[event.kind];
    if (!copy) return [];
    const actor = event.actorId === self?.id ? "You" : event.actor;
    return [{ text: copy(actor, event.detail), tone: EVENT_TONE[event.kind] }];
  }, [event, self?.id]);

  const queueTracks = useMemo(() => (queue ?? []).map(toQueueTrack), [queue]);

  /**
   * Nothing authoritative has arrived yet.
   *
   * Keyed on the snapshot rather than the socket status: a reconnect keeps the
   * last snapshot on screen, which is right - the room did not stop existing
   * because the connection blipped, and blanking it would be a worse lie than
   * showing state a second out of date.
   */
  const loading = !snapshot;
  /** Connected, but the room has nothing playing - everything below the stage
   *  would be describing a track that doesn't exist. */
  const empty = !loading && !current;

  const roomName = roomDisplayName({
    roomName: snapshot?.roomName,
    title: snapshot?.title,
    groupId: snapshot?.groupId,
    viewerId: self?.id,
  });
  const avatarUrl = withRoomToken(snapshot?.avatarUrl, token);

  /**
   * Audio gets a square card, video keeps the wide stage.
   *
   * Left wide while nothing is loaded: the shape can't be known before the
   * track is, and guessing square would mean every video track opened with the
   * stage collapsing from a box to a strip.
   */
  const ratio: PlayRatio = current && !current.video ? "1:1" : "16:9";

  /**
   * The header's height, handed to the scroller as padding.
   *
   * Lifting the pills out of the flow is what lets the column pass behind
   * them, and it also means nothing reserves their space any more - left
   * alone the stage would jump up under the room pill. Measured rather than
   * written down: the bar wraps to two rows below `sm`, its first row is
   * sized by a Telegram safe-area variable that only exists at runtime, and
   * it is empty until the room resolves. Every one of those changes the
   * number, and the observer catches all three.
   */
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  /**
   * Whether the stage has pinned itself over the viewport.
   *
   * Only used to reorder the bar against it. Held here rather than in the
   * stage because the bar is not the stage's to move.
   */
  const [stageExpanded, setStageExpanded] = useState(false);

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    /*
      Rounded before it reaches React, and read off the observer's own
      measurement rather than by asking the DOM again.

      `getBoundingClientRect()` inside a ResizeObserver callback forces a
      synchronous layout, and a subpixel-jittery height would hand setState a
      new number for a bar that had not actually moved - re-rendering the
      whole player mid-animation. `borderBoxSize` is already measured by the
      time the callback runs, so it costs nothing, and the compare means a
      height that only wobbled in the hundredths never reaches React at all.
    */
    const apply = (height: number) =>
      setHeaderHeight((prev) =>
        Math.round(prev) === Math.round(height) ? prev : height,
      );

    apply(header.getBoundingClientRect().height);

    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.borderBoxSize?.[0];
      apply(box ? box.blockSize : header.getBoundingClientRect().height);
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background">
      <TelegramFullscreen />

      {/*
        Out of the flow, so the column scrolls behind the pills instead of
        being cut off at a band above them. There is no background here to
        make transparent - the bar was only ever the page showing through, and
        what read as a solid strip holding the pills in place was the layout
        row they sat in reserving that space.

        `pointer-events-none`: the pills are labels, nothing in here is
        tappable, and a bar spanning the top of a scroller would otherwise eat
        every swipe that started on it.
      */}
      <header
        ref={headerRef}
        className={`pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-center justify-center gap-x-2 gap-y-2.5 px-2.5 pt-[var(--safe-top)] ${stageExpanded ? "z-[90]" : "z-50"}`}
      >
        <div className="flex h-[var(--tg-content-safe-area-inset-top,3.5rem)] max-w-full min-w-0 items-center">
          {loading ? null : (
            /* Glass, now that the column runs behind it: enough of the
               scrolled content shows through to place the pill above the page
               rather than on it, while the blur and the saturation lift keep
               the room name readable over whatever passes under. Same pairing
               the stage's geo notice uses. */
            <div className="flex h-[31.8px] max-w-full min-w-0 items-center gap-2 rounded-full bg-topbar-pill/70 pr-3 pl-[2.6px] text-topbar-pill-foreground backdrop-blur-xl backdrop-saturate-150">
              {/*
                Drained of colour while the socket is being retried, on a fade
                rather than a cut - a blip that resolves in a few hundred ms
                should register as the bar going quiet, not as a flicker. The
                initial stays the room's own letter: the avatar is identity, and
                identity did not change because the connection did.
              */}
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  width={27}
                  height={27}
                  className={`size-[27px] shrink-0 rounded-full object-cover transition-[filter] duration-300 ease-out ${reconnecting ? "grayscale" : ""}`}
                />
              ) : (
                <span
                  className={`bg-gradient-avatar flex size-[26px] shrink-0 items-center justify-center rounded-full font-display text-[13px] font-medium text-[oklch(97%_0.020_268)] transition-[filter] duration-300 ease-out ${reconnecting ? "grayscale" : ""}`}
                >
                  {roomName.trim().charAt(0).toUpperCase()}
                </span>
              )}
              {/* The room did not stop existing because the connection blipped,
                  so the snapshot below stays on screen - this line is the one
                  place that admits the bar is out of touch with it. */}
              <span className="truncate text-[14px] font-medium">
                {reconnecting ? "Connecting" : roomName}
              </span>
            </div>
          )}
        </div>

        {/*
          Hidden in fullscreen, not unmounted. The room pill has to hold
          its exact position, and dropping this from the flow would move
          it - the bar centres its row, so at `sm` the pill would slide
          across to take the space back. It would also shrink the header,
          and the scroller pads itself by the header height, so the whole
          column behind the stage would reflow and jump on the way out.
          `invisible` keeps the box and skips the paint.
        */}
        <div
          className={`flex min-w-0 basis-full justify-center sm:h-[var(--tg-content-safe-area-inset-top,3.5rem)] sm:basis-auto sm:items-center ${stageExpanded ? "invisible" : ""}`}
        >
          {loading ? null : <ParticipantsLane participants={lane} notices={notices} />}
        </div>
      </header>

      <main
        style={{ paddingTop: headerHeight }}
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 pb-safe"
      >
        <PlayBox
          ratio={ratio}
          className="mt-5.5"
          videoRef={videoRef}
          audioRef={audioRef}
          trackKey={sources.key}
          videoSrc={sources.video}
          audioSrc={sources.audio}
          posterUrl={wideThumbnail(current?.thumbnail)}
          buffering={Boolean(current) && (buffering.blocking || buffering.video)}
          notice={geoNotice(sources.video, country)}
          canExpand={Boolean(current?.video)}
          onExpandedChange={setStageExpanded}
          lyrics={lyrics}
          positionSec={position}
        />

        {/* Nothing authoritative yet: the stage above holds the layout and the
            rest stays blank until the snapshot lands. Placeholder content goes
            back here once it's worth showing. */}
        {loading ? null : empty ? (
          /* No track: the title, chips, transport and decks all describe a
             track that doesn't exist, so they're replaced wholesale rather
             than left to render dashes and a dead scrubber. */
          <EmptyState className="mt-7 pb-4" />
        ) : (
          <>
            <TrackTitle
              text={current?.title ?? ""}
              className="mt-4.5 px-2 text-[19px] font-[480] tracking-[-0.1px]"
            />

            <div className="mt-3.5 flex min-w-0 items-center gap-2 px-1.5">
              <PersonChip
                person={{
                  name: current?.artist || "Unknown artist",
                  // a YouTube CDN URL, so it needs no room token
                  avatarUrl: current?.artistAvatar ?? null,
                }}
                size={25}
                pill
                nameClassName="text-[14px] font-[450] text-foreground/90"
              />
              <span className="size-[3px] shrink-0 rounded-full bg-muted-foreground" />
              <PersonChip
                person={{
                  name: current?.requestedBy ?? "-",
                  // whoever queued it is in the roster, so borrow their avatar
                  avatarUrl: withRoomToken(
                    participants?.find((p) => p.id === current?.requestedById)
                      ?.photoUrl,
                    token,
                  ),
                }}
                size={25}
                pill
                className="min-w-0"
                nameClassName="text-[14px] font-[450] text-foreground/90"
              />
            </div>

            {siteConfig.features.playbackControls && (
              <PlaybackControls
                className="mt-6"
                durationSec={current?.duration ?? 0}
                playing={playing}
                positionSec={position}
                onToggle={onToggle}
                onSeek={onSeek}
                stalled={buffering.blocking}
                canControl={canControl}
              />
            )}

            <PlayerDecks
              queue={queueTracks}
              variant="outline"
              participants={lane}
              media={current?.video ? "video" : "audio"}
              className="mt-6 pb-4"
            />
          </>
        )}

      </main>
    </div>
  );
}

export function PlayerScreen() {
  const state = useRoomSession();

  if (state.status === "blocked") {
    return <RoomUnavailable reason={state.reason} />;
  }
  if (state.status !== "ready") {
    // the shell paints instantly; the socket fills it in a moment later
    return <div className="fixed inset-0 bg-background" />;
  }

  return (
    <RoomLiveProvider token={state.session.token}>
      <PlayerBody token={state.session.token} />
    </RoomLiveProvider>
  );
}
