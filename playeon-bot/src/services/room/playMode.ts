
export function stripRoomFlag(rawArgs: string): string {
  return rawArgs.replace(/(^|\s)-r(?:oom)?(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim()
}

export type VideoQuality = 'sd' | 'hd' | 'fhd' | '2k' | '4k' | 'best'

export const QUALITY_HEIGHT: Record<VideoQuality, number | null> = {
  sd: 480,
  hd: 720,
  fhd: 1080,
  '2k': 1440,
  '4k': 2160,
  best: null,
}

export const DEFAULT_ROOM_VIDEO_HEIGHT = 1080

export function roomVideoHeight(quality: VideoQuality | null): number {
  if (!quality) return DEFAULT_ROOM_VIDEO_HEIGHT
  return QUALITY_HEIGHT[quality] ?? 2160
}

const QUALITY_FLAG_RE = /(^|\s)-(sd|fhd|hd|1440p|2160p|2k|4k|best)(?=\s|$)/gi

function toQuality(token: string): VideoQuality {
  const t = token.toLowerCase()
  if (t === '1440p') return '2k'
  if (t === '2160p') return '4k'
  return t as VideoQuality
}

/**
 * Where to look the track up. `null` means "unspecified", which resolveTrack
 * reads as YouTube - the default source, and the only catalogue wide enough to
 * answer any query.
 *
 * `-js` opts into JioSaavn, which wins on bitrate where it has the track;
 * `-yt` is the explicit spelling of the default.
 */
export type TrackSource = 'jiosaavn' | 'youtube'

const SOURCE_FLAG_RE = /(^|\s)-(js|jiosaavn|saavn)(?=\s|$)/gi
const YT_FLAG_RE = /(^|\s)-yt(?=\s|$)/gi

/**
 * `-f` / `-force`: start this track now rather than queueing it.
 *
 * Whatever is playing is not skipped - it goes back to the front of the queue
 * with its position kept, and resumes from that second once the forced track
 * finishes. Same thing the Play Now button on a queued card does.
 */
const FORCE_FLAG_RE = /(^|\s)-f(?:orce)?(?=\s|$)/gi

export interface PlayFlags {
  quality: VideoQuality | null
  source: TrackSource | null
  force: boolean
  query: string
}

export function parsePlayFlags(rawArgs: string): PlayFlags {
  const qualityMatches = [...rawArgs.matchAll(QUALITY_FLAG_RE)]
  const quality = qualityMatches.length ? toQuality(qualityMatches[qualityMatches.length - 1]![2]!) : null
  // `-js` forces JioSaavn, `-yt` spells out the default, and neither means
  // unspecified - which resolveTrack also serves from YouTube.
  const wantsSaavn = SOURCE_FLAG_RE.test(rawArgs)
  SOURCE_FLAG_RE.lastIndex = 0 // the /g regex carries its cursor between calls
  const wantsYouTube = YT_FLAG_RE.test(rawArgs)
  YT_FLAG_RE.lastIndex = 0
  const source: TrackSource | null = wantsSaavn ? 'jiosaavn' : wantsYouTube ? 'youtube' : null
  const force = FORCE_FLAG_RE.test(rawArgs)
  FORCE_FLAG_RE.lastIndex = 0
  const query = rawArgs
    .replace(FORCE_FLAG_RE, ' ')
    .replace(YT_FLAG_RE, ' ')
    .replace(/(^|\s)-r(?:oom)?(?=\s|$)/gi, ' ')
    .replace(/(^|\s)-fix(?=\s|$)/gi, ' ')
    .replace(SOURCE_FLAG_RE, ' ')
    .replace(QUALITY_FLAG_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { quality, source, force, query }
}
