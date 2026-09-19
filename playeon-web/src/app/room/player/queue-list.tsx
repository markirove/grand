import type { SyntheticEvent } from "react";

import { formatClock } from "@/lib/duration";
import { wideFallback } from "@/lib/thumbnail";

/**
 * A missing frame is a 404 whose body is a grey 120×90 placeholder, and an
 * `<img>` renders that quite happily - so without this the row shows the
 * broken-thumbnail tile rather than falling back. The stage has had this
 * since it was written; the queue never did.
 */
function onArtworkError(event: SyntheticEvent<HTMLImageElement>) {
  const img = event.currentTarget;
  const fallback = wideFallback(img.src);
  if (fallback && img.src !== fallback) img.src = fallback;
}

export type QueueTrack = {
  id: string;
  title: string;
  artist: string;
  durationSec?: number;
  artworkUrl?: string | null;
  requestedBy: { name: string; avatarUrl?: string | null };
};

type Props = {
  tracks: QueueTrack[];
  className?: string;
};

export function QueueList({ tracks, className }: Props) {
  return (
    <section className={className}>
      {tracks.length === 0 ? (
        <p className="px-2 py-4 text-center text-[15px] text-muted-foreground">
          Nothing queued yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {tracks.map((track) => (
            <li key={track.id}>
              <button
                type="button"
                className="flex w-full cursor-pointer items-start gap-3 rounded-xl p-2 text-left transition-colors active:bg-secondary"
              >
                <span className="relative aspect-video w-[104px] shrink-0 overflow-hidden rounded-lg bg-secondary">
                  {track.artworkUrl && (
                    <img
                      src={track.artworkUrl}
                      alt=""
                      onError={onArtworkError}
                      className="size-full object-cover"
                    />
                  )}
                  {track.durationSec !== undefined && (
                    <span className="absolute right-1 bottom-1 rounded bg-[oklch(0%_0_0/0.78)] px-1.5 py-px font-mono text-[11.5px] leading-[1.4] font-medium text-white">
                      {formatClock(track.durationSec)}
                    </span>
                  )}
                </span>

                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="line-clamp-2 text-[15.8px] leading-[1.32] font-[480] tracking-[-0.1px]">
                    {track.title}
                  </span>

                  <span className="truncate text-[13.6px] leading-[1.35] font-normal text-muted-foreground">
                    {track.artist}
                    <span className="mx-1.5 inline-block size-[2.5px] rounded-full bg-current align-middle" />
                    {track.requestedBy.name}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
