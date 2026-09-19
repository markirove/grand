"use client";

import { useEffect, useState } from "react";

import type { LyricLine, LyricsPayload } from "@/lib/lyrics";

/**
 * Lyrics for the current track, or null.
 *
 * Off the render path entirely: nothing waits on this, nothing re-renders
 * while it is in flight, and a track that has none simply never resolves into
 * anything. The result lands in state exactly once per track - after that the
 * player reads it from a rAF without React involved.
 */
export function useLyrics(track: {
  id: string;
  title: string;
  artist?: string | null;
  duration: number | null;
  /** Video tracks are skipped: the picture is the point, not the words. */
  video: boolean;
} | null): LyricLine[] | null {
  const [state, setState] = useState<{ id: string; lines: LyricLine[] } | null>(
    null,
  );

  const id = track?.id ?? "";
  const title = track?.title ?? "";
  const artist = track?.artist ?? "";
  const duration = track?.duration ?? 0;
  const video = track?.video ?? false;

  useEffect(() => {
    // nothing to look up; the return below already refuses to hand back
    // another track's words
    if (!id || !title || video) return;

    const controller = new AbortController();
    const query = new URLSearchParams({
      id,
      title,
      artist,
      duration: String(Math.round(duration)),
    });

    void (async () => {
      try {
        const response = await fetch(`/api/lyrics?${query}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as LyricsPayload;
        if (controller.signal.aborted) return;
        if (payload.found && payload.lines.length > 0) {
          setState({ id, lines: payload.lines });
        }
      } catch {
        // aborted, offline, or a bad body - the track just has no lyrics
      }
    })();

    return () => {
      controller.abort();
      // clear on the way out, so the outgoing track's words can never sit
      // under the incoming one's title
      setState(null);
    };
  }, [id, title, artist, duration, video]);

  return state && state.id === id ? state.lines : null;
}
