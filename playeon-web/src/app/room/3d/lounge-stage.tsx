"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TelegramFullscreen } from "@/app/telegram-fullscreen";
import { impact } from "@/lib/haptics";
import { MediaEngine, type BufferingState } from "@/lib/media-engine";
import { roomDisplayName } from "@/lib/room-name";
import type { RoomStyleId } from "@/lib/room-style";
import { withRoomToken } from "@/lib/room-protocol";
import { wideThumbnail } from "@/lib/thumbnail";

import { useLyrics } from "../player/use-lyrics";
import { useRoom, useRoomStore } from "../player/live-provider";
import { RoomPill } from "../room-pill";
import { ChatSheet } from "./chat-sheet";
import { Diagnostics } from "./diagnostics";
import { FrameMeter } from "./frame-meter";
import { paletteFor } from "./lib/palette";
import { noCooldowns, type Cooldowns } from "./lib/gestures";
import type { Input } from "./lib/input";
import { Player } from "./lib/player";
import {
  describeMediaError,
  probeCors,
  IDLE_DIAGNOSTICS,
  type CorsProbe,
  type ElementProbe,
  type ScreenDiagnostics,
  type TextureProbe,
} from "./lib/screen-probe";
import { LoungeHud } from "./lounge-hud";
import { ScreenOverlay } from "./screen-overlay";
import type { AimedPerson, AimTarget } from "./scene/lounge-canvas";

type Findings = {
  key: string;
  cors: CorsProbe;
  elementFor: "cors" | "plain" | null;
  element: ElementProbe;
  anonymousError: string | null;
  texture: TextureProbe;
  frame: { width: number; height: number } | null;
};

const NO_FINDINGS: Findings = {
  key: "",
  cors: { state: "pending" },
  elementFor: null,
  element: { state: "pending" },
  anonymousError: null,
  texture: { state: "idle" },
  frame: null,
};

const DIAGNOSTICS: boolean = false;

const LOUNGE_HEIGHT = 720;

const EXIT_GRACE_MS = 350;

const LoungeCanvas = dynamic(
  () => import("./scene/lounge-canvas").then((m) => m.LoungeCanvas),
  { ssr: false },
);

export function LoungeStage({
  token,
  style,
}: {
  token: string;
  style: RoomStyleId;
}) {
  const paint = useMemo(() => paletteFor(style), [style]);

  const store = useRoomStore();

  const snapshot = useRoom((state) => state.snapshot);
  const current = useRoom((state) => state.snapshot?.current ?? null);
  const playing = useRoom((state) => state.snapshot?.playing ?? false);
  const self = useRoom((state) => state.self);
  const participants = useRoom((state) => state.snapshot?.participants);
  const reconnecting = useRoom((state) => state.status === "reconnecting");
  const unread = useRoom((state) => state.unread);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const inputRef = useRef<Input | null>(null);

  const engine = useMemo(() => new MediaEngine(), []);
  const player = useMemo(() => new Player(), []);

  const sources = useMemo(() => {
    if (!current) {
      return { key: "idle", video: null, audio: null, split: false };
    }

    const split =
      current.sourceMode === "split" &&
      Boolean(current.videoProxyUrl || current.videoUrl);

    const ladder = [...(current.videoQualities ?? [])].sort(
      (a, b) => a.height - b.height,
    );
    const rung =
      ladder.find((quality) => quality.height >= LOUNGE_HEIGHT) ??
      ladder[ladder.length - 1] ??
      null;

    const media = withRoomToken(current.mediaUrl, token);
    const proxy = current.videoProxyUrl
      ? withRoomToken(
          rung
            ? `${current.videoProxyUrl}?h=${rung.height}`
            : current.videoProxyUrl,
          token,
        )
      : null;

    return {
      key: `${current.id}-${split ? "split" : "download"}`,
      video: split ? (proxy ?? rung?.url ?? current.videoUrl ?? null) : media,
      audio: split ? media : null,
      split,
    };
  }, [current, token]);

  const [plainFor, setPlainFor] = useState<string | null>(null);
  const anonymous = plainFor !== sources.key;
  const elementKey = `${sources.key}-${anonymous ? "cors" : "plain"}`;

  const [findings, setFindings] = useState<Findings>(NO_FINDINGS);
  const [aim, setAim] = useState<AimTarget>(null);
  const [person, setPerson] = useState<AimedPerson | null>(null);
  const [seated, setSeated] = useState(false);
  const [switchOn, setSwitchOn] = useState<boolean | null>(null);

  const [cooldowns, setCooldowns] = useState<Cooldowns>(noCooldowns);

  const [watching, setWatching] = useState(false);

  const [chatting, setChatting] = useState(false);

  /*
    The frame-rate readout, behind a tap on the room pill.

    Not a build flag like `DIAGNOSTICS` above it: the number is wanted on a real
    phone, mid-session, on the device that is actually dropping frames - which
    is exactly where recompiling with a flag flipped is not an option. The pill
    is the one piece of chrome up there with nothing else to do when tapped, so
    it costs no screen space and nobody finds it by accident.
  */
  const [meter, setMeter] = useState(false);

  const openChat = useCallback(() => {
    setChatting(true);
    impact("light");
  }, []);

  const closeChat = useCallback(() => setChatting(false), []);

  const react = useCallback(
    (emoji: string) => {
      store.react(emoji);
      impact("light");
    },
    [store],
  );

  useEffect(() => {
    if (chatting || watching) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, [contenteditable]")) return;
      event.preventDefault();
      setChatting(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatting, watching]);

  const [buffering, setBuffering] = useState<BufferingState>({
    blocking: false,
    video: false,
  });

  useEffect(() => {
    engine.onBufferingChange(setBuffering);
  }, [engine]);

  const stalled = buffering.blocking || buffering.video;

  const openedAt = useRef(0);

  const watch = useCallback(() => {
    setWatching(true);
    openedAt.current = performance.now();
    impact("light");
  }, []);

  const unwatch = useCallback(() => {
    setWatching(false);
    impact("light");
  }, []);

  const dismiss = useCallback(() => {
    if (performance.now() - openedAt.current < EXIT_GRACE_MS) return;
    unwatch();
  }, [unwatch]);

  const members = useMemo(
    () =>
      (participants ?? [])
        .filter((person) => person.id !== self?.id)
        .map((person) => ({
          id: person.id,
          name: person.name,
          present: person.present,
        })),
    [participants, self?.id],
  );

  const live = findings.key === sources.key ? findings : NO_FINDINGS;

  const record = useCallback(
    (key: string, patch: (was: Findings) => Partial<Findings>) => {
      setFindings((was) => {
        const base = was.key === key ? was : NO_FINDINGS;
        return { ...base, ...patch(base), key };
      });
    },
    [],
  );

  useEffect(() => {
    const url = sources.video;
    const key = sources.key;
    if (!DIAGNOSTICS || !url) return;
    const controller = new AbortController();
    void probeCors(url, controller.signal).then((cors) => {
      if (controller.signal.aborted) return;
      record(key, () => ({ cors }));
    });
    return () => controller.abort();
  }, [sources.video, sources.key, record]);

  const onVideoError = useCallback(() => {
    const { code, detail } = describeMediaError(videoRef.current?.error ?? null);
    record(sources.key, (was) => ({
      elementFor: anonymous ? "cors" : "plain",
      element: { state: "error", code, detail },
      anonymousError: anonymous ? detail : was.anonymousError,
    }));
    if (anonymous) setPlainFor(sources.key);
  }, [anonymous, sources.key, record]);

  const onVideoLoaded = useCallback(() => {
    record(sources.key, () => ({
      elementFor: anonymous ? "cors" : "plain",
      element: { state: "loaded" },
    }));
  }, [anonymous, sources.key, record]);

  const onTextureResult = useCallback(
    (ok: boolean, detail: string) => {
      record(sources.key, () => ({
        texture: ok ? { state: "ok" } : { state: "failed", detail },
      }));
    },
    [sources.key, record],
  );

  const onFrameSize = useCallback(
    (frame: { width: number; height: number }) => {
      record(sources.key, () => ({ frame }));
    },
    [sources.key, record],
  );

  const diagnostics = useMemo<ScreenDiagnostics>(() => {
    if (sources.key === "idle") return IDLE_DIAGNOSTICS;
    const mode = anonymous ? "cors" : "plain";
    return {
      sourceMode: sources.split ? "split" : "download",
      videoUrl: sources.video,
      audioUrl: sources.audio,
      anonymous,
      cors: live.cors,
      element: live.elementFor === mode ? live.element : { state: "pending" },
      texture: anonymous
        ? live.texture
        : {
            state: "skipped",
            reason: live.anonymousError
              ? `crossOrigin load failed (${live.anonymousError}) - reloaded without it, so an upload would taint the canvas`
              : "element is not CORS-clean",
          },
      frame: live.frame,
    };
  }, [sources.key, sources.video, sources.audio, sources.split, anonymous, live]);

  useEffect(() => {
    engine.resetTrack();
    engine.attach(
      { video: videoRef.current, audio: audioRef.current },
      sources.split,
    );
    engine.run(() => store.positionSec());

    const master = sources.split ? audioRef.current : videoRef.current;
    const onLoaded = () => engine.anchorOnLoad(store.positionSec());
    master?.addEventListener("loadedmetadata", onLoaded);

    return () => {
      master?.removeEventListener("loadedmetadata", onLoaded);
      engine.stop();
    };
  }, [engine, store, elementKey, sources.split]);

  useEffect(() => () => engine.destroy(), [engine]);

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

  const loading = !snapshot;

  const roomName = roomDisplayName({
    roomName: snapshot?.roomName,
    title: snapshot?.title,
    groupId: snapshot?.groupId,
    viewerId: self?.id,
  });
  const avatarUrl = withRoomToken(snapshot?.avatarUrl, token);

  const posterUrl = wideThumbnail(current?.thumbnail);

  const lyrics = useLyrics(current);

  return (
    /*
      The page under the canvas wears the room's fog.

      Only ever seen for the moment before the first frame lands and in the
      margins of a canvas that has not resized yet, which is exactly when a
      mismatch is most obvious - a dark blue letterbox around a red room reads
      as a bug in the room rather than a gap in the page.
    */
    <main
      style={{ backgroundColor: paint.fog }}
      className="fixed inset-0 touch-none overflow-hidden select-none"
    >
      <TelegramFullscreen />

      <LoungeCanvas
        paint={paint}
        player={player}
        store={store}
        members={members}
        videoRef={videoRef}
        inputRef={inputRef}
        mediaKey={elementKey}
        posterUrl={posterUrl}
        lyrics={lyrics}
        textureAllowed={anonymous && Boolean(sources.video)}
        buffering={stalled}
        onTextureResult={onTextureResult}
        onFrameSize={onFrameSize}
        onAimChange={setAim}
        onPersonChange={setPerson}
        onSeatedChange={setSeated}
        onSwitchChange={setSwitchOn}
        onWatch={watch}
        onCooldown={setCooldowns}
        paused={watching}
      />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-50 flex items-center justify-center px-2.5 pt-[var(--safe-top)]">
        <div className="relative mt-[var(--hud-inset)] flex max-w-full min-w-0 items-center [@media(pointer:coarse)]:mt-0 [@media(pointer:coarse)]:h-[var(--tg-content-safe-area-inset-top,3.5rem)]">
          {loading || watching ? null : (
            <>
              <button
                type="button"
                aria-pressed={meter}
                aria-label="Toggle frame rate"
                onClick={() => {
                  setMeter((on) => !on);
                  impact("light");
                }}
                className="pointer-events-auto flex max-w-full min-w-0 cursor-pointer transition-opacity active:opacity-70"
              >
                <RoomPill
                  avatarUrl={avatarUrl}
                  roomName={roomName}
                  reconnecting={reconnecting}
                />
              </button>

              {/*
                Hung off the pill rather than placed after it.

                The header is a fixed strip the size of the notch area, and the
                pill is centred in it - a second row inside would move the pill
                the moment the meter appeared, which is the one thing a readout
                you flick on and off must not do. Absolute keeps it out of the
                layout entirely: the pill stays where it is and the number
                arrives underneath it.

                The readout keeps its own state and paints itself opaque, for
                reasons that belong to it - see `FrameMeter`.
              */}
              {meter ? <FrameMeter /> : null}
            </>
          )}
        </div>
      </header>

      {watching ? (
        <>
          <ScreenOverlay onClose={unwatch} />
          {stalled ? (
            <div
              aria-hidden
              className="pointer-events-none fixed inset-0 z-[75] flex items-center justify-center"
            >
              <span className="size-10 animate-spin rounded-full border-[3px] border-white/25 border-t-white/90" />
            </div>
          ) : null}
        </>
      ) : (
        <LoungeHud
          aim={aim}
          person={person}
          seated={seated}
          switchOn={switchOn}
          unread={unread}
          cooldowns={cooldowns}
          inputRef={inputRef}
          onOpenChat={openChat}
          onReact={react}
        />
      )}

      {chatting && !watching ? (
        <ChatSheet token={token} onClose={closeChat} inputRef={inputRef} />
      ) : null}

      {DIAGNOSTICS ? <Diagnostics diagnostics={diagnostics} /> : null}

      <div
        aria-hidden={watching ? undefined : true}
        onPointerDown={watching ? dismiss : undefined}
        className={
          watching
            ? "fixed inset-0 z-[70] bg-black"
            : "pointer-events-none fixed top-0 left-0 size-px overflow-hidden opacity-0"
        }
      >
        <video
          key={`${elementKey}-video`}
          ref={videoRef}
          crossOrigin={anonymous ? "anonymous" : undefined}
          src={sources.video ?? undefined}
          poster={posterUrl ?? undefined}
          onLoadedData={onVideoLoaded}
          onError={onVideoError}
          playsInline
          controls={false}
          className={watching ? "size-full object-contain" : undefined}
          muted={sources.audio ? true : undefined}
          preload="auto"
        />
        {sources.audio ? (
          <audio
            key={`${elementKey}-audio`}
            ref={audioRef}
            src={sources.audio}
            preload="auto"
          />
        ) : null}
      </div>
    </main>
  );
}
