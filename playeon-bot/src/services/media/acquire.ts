import type { CommandContext } from '../../core/command.js'
import type { Collections } from '../mongo.js'
import { mediaCache } from './mediaCache.js'
import { MusicError, type ResolvedTrack } from './musicSource.js'
import { downloadTrack as ytdlpDownloadTrack } from './ytdlp.js'

type Tg = CommandContext['tg']
export type Media = { path: string; dispose: () => Promise<void> }
export type AcquireProgress = (percent: number | null) => void

async function fromCache(tg: Tg, db: Collections, track: ResolvedTrack, video: boolean, onProgress?: AcquireProgress): Promise<Media | null> {
  const cached = await mediaCache.lookup(db, track.id, video).catch(() => null)
  if (!cached) return null
  try {
    return await mediaCache.fetch(tg, db, cached, (d, t) => onProgress?.(t ? (d / t) * 100 : null))
  } catch {
    return null
  }
}

/**
 * Audio for a track, from the cache when possible.
 *
 * There is deliberately no quality knob. Callers used to pass `hq`, which chose
 * between two selectors that resolved to the same itag on every YouTube video -
 * so it changed nothing about the file, but did key it into a second cache slot
 * under `aac`. `/play` and `/vplay` were downloading and storing byte-identical
 * audio twice. One selector, one cache entry.
 */
export async function acquireAudio(
  tg: Tg,
  db: Collections,
  track: ResolvedTrack,
  onProgress?: AcquireProgress,
  opts?: { signal?: AbortSignal },
): Promise<Media> {
  const cached = await fromCache(tg, db, track, false, onProgress)
  if (cached) return cached

  let media: Media
  try {
    media = await ytdlpDownloadTrack(track, false, (p) => onProgress?.(p.percent), { signal: opts?.signal })
  } catch (err) {
    throw new MusicError(`couldn't fetch the audio (${err instanceof Error ? err.message : String(err)})`)
  }
  void mediaCache.store(tg, db, track, false, media.path, media.path.split('/').pop())
  return media
}

export async function acquireVideo(
  tg: Tg,
  db: Collections,
  track: ResolvedTrack,
  maxHeight: number | null,
  onProgress?: AcquireProgress,
  opts?: { signal?: AbortSignal },
): Promise<Media> {
  const cached = await fromCache(tg, db, track, true, onProgress)
  if (cached) return cached

  let media: Media
  try {
    media = await ytdlpDownloadTrack(track, true, (p) => onProgress?.(p.percent), { maxHeight, signal: opts?.signal })
  } catch (err) {
    throw new MusicError(`couldn't fetch the video (${err instanceof Error ? err.message : String(err)})`)
  }
  void mediaCache.store(tg, db, track, true, media.path, media.path.split('/').pop())
  return media
}
