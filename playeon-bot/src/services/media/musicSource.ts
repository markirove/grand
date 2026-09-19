
export class MusicError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MusicError'
  }
}

export type ResolvedTrack = {
  id: string
  title: string
  url: string
  duration: number | null
  uploader: string | null
  /** Channel avatar, when the source carried one. Public CDN, no auth. */
  artistAvatar: string | null
  /**
   * The real performer, when `uploader` is deliberately showing something
   * else. Only JioSaavn sets this today; YouTube's uploader *is* the credit.
   */
  credits?: string | null
  thumbnail: string | null
}

const thumbUrl = (id: string): string => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
const maxresUrl = (id: string): string => `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`

/**
 * The two variants that mean a 1280x720 frame exists.
 *
 * `hq720.jpg` and `maxresdefault.jpg` are the same asset - byte-identical when
 * both are fetched, and they 404 together. YouTube's own renderers link the
 * first exactly when the second is there, so seeing either in a thumbnail list
 * is a free existence check for `maxresdefault`: no probe request, no 404 to
 * recover from. Checked against 24 videos across mixed queries, agreement was
 * 24/24 in both directions.
 */
const HI_RES_VARIANT = /\/(?:hq720|maxresdefault)\.jpg/i

/**
 * The best frame YouTube actually has for a video, out of what it just told us.
 *
 * This used to be `thumbUrl(id)` unconditionally - a bare `hqdefault.jpg`,
 * which is 480x360: a 4:3 frame with black bars baked into the pixels, so a
 * 16:9 surface letterboxes an already-letterboxed image. Meanwhile the answer
 * was sitting unread in the same response.
 *
 * Two outcomes, both correct at 16:9 and both guaranteed to load:
 *
 *   - a hi-res variant is listed, so `maxresdefault.jpg` exists - take it
 *     plain and unsigned, at 1280x720, which caches forever and cannot expire
 *   - nothing hi-res, so the widest thing offered is YouTube's own signed crop
 *     (`?sqp=…&rs=…`, typically 480x270). Small, but a real widescreen crop
 *     rather than a letterboxed 4:3 one, and it is what youtube.com itself
 *     shows for these videos
 *
 * The signature covers the exact path, so these URLs must be passed on whole -
 * rewriting the variant on one invalidates it.
 */
function bestThumbnail(id: string, thumbnails: unknown): string {
  const list = Array.isArray(thumbnails)
    ? thumbnails.filter((t: any) => typeof t?.url === 'string')
    : []
  if (list.some((t: any) => HI_RES_VARIANT.test(t.url))) return maxresUrl(id)

  let widest: any = null
  for (const t of list) {
    if (!widest || (Number(t.width) || 0) > (Number(widest.width) || 0)) widest = t
  }
  return widest?.url ?? thumbUrl(id)
}

const isHttpUrl = (s: string): boolean => /^https?:\/\/\S+/i.test(s)

const INNERTUBE_BASE = 'https://www.youtube.com/youtubei/v1'
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
const INNERTUBE_CLIENT_VERSION = '2.20240401.00.00'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
const SEARCH_VIDEO_FILTER = 'EgIQAQ%3D%3D'
const INNERTUBE_TIMEOUT_MS = 20_000

const WEB_CONTEXT = {
  client: { clientName: 'WEB', clientVersion: INNERTUBE_CLIENT_VERSION, hl: 'en', gl: 'US' },
}

async function innertube(endpoint: string, body: unknown, signal?: AbortSignal): Promise<any> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), INNERTUBE_TIMEOUT_MS)
  if (signal) {
    if (signal.aborted) ac.abort()
    else signal.addEventListener('abort', () => ac.abort(), { once: true })
  }
  try {
    const resp = await fetch(`${INNERTUBE_BASE}/${endpoint}?key=${INNERTUBE_KEY}&prettyPrint=false`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'X-Youtube-Client-Name': '1',
        'X-Youtube-Client-Version': INNERTUBE_CLIENT_VERSION,
        Origin: 'https://www.youtube.com',
      },
      body: JSON.stringify(body),
    })
    if (!resp.ok) throw new MusicError(`YouTube search failed (HTTP ${resp.status})`)
    return await resp.json()
  } catch (err) {
    if (err instanceof MusicError) throw err
    if ((err as Error)?.name === 'AbortError') throw new MusicError('YouTube search timed out')
    throw new MusicError(`YouTube search failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timer)
  }
}

function parseDurationText(text: unknown): number | null {
  if (typeof text !== 'string') return null
  const parts = text.split(':').map((p) => Number(p.trim()))
  if (parts.some((n) => !Number.isFinite(n))) return null
  return parts.reduce((acc, n) => acc * 60 + n, 0) || null
}

function runsText(node: any): string | null {
  if (!node) return null
  if (typeof node.simpleText === 'string') return node.simpleText
  if (Array.isArray(node.runs)) return node.runs.map((r: any) => r?.text ?? '').join('') || null
  return null
}

function trackFromRenderer(v: any): ResolvedTrack | null {
  const id = typeof v?.videoId === 'string' ? v.videoId : null
  if (!id) return null
  return {
    id,
    title: runsText(v.title) ?? 'Unknown title',
    url: `https://www.youtube.com/watch?v=${id}`,
    duration: parseDurationText(runsText(v.lengthText)),
    uploader: runsText(v.ownerText) ?? runsText(v.longBylineText),
    artistAvatar:
      v?.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail
        ?.thumbnails?.[0]?.url ?? null,
    thumbnail: bestThumbnail(id, v?.thumbnail?.thumbnails),
  }
}

function collectVideoRenderers(node: any, out: any[]): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) collectVideoRenderers(item, out)
    return
  }
  if (node.videoRenderer) out.push(node.videoRenderer)
  for (const key of Object.keys(node)) {
    if (key === 'videoRenderer') continue
    collectVideoRenderers(node[key], out)
  }
}

async function innertubeSearch(query: string, limit: number, signal?: AbortSignal): Promise<ResolvedTrack[]> {
  const data = await innertube('search', { context: WEB_CONTEXT, query, params: SEARCH_VIDEO_FILTER }, signal)
  const renderers: any[] = []
  collectVideoRenderers(data?.contents, renderers)
  const tracks: ResolvedTrack[] = []
  for (const r of renderers) {
    const t = trackFromRenderer(r)
    if (t) tracks.push(t)
    if (tracks.length >= limit) break
  }
  return tracks
}

export function extractVideoId(url: string): string | null {
  const m =
    url.match(/[?&]v=([A-Za-z0-9_-]{11})/) ??
    url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ??
    url.match(/\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/)
  return m ? m[1]! : null
}

async function innertubeDetails(id: string, signal?: AbortSignal): Promise<Omit<ResolvedTrack, 'url'>> {
  try {
    const data = await innertube('player', {
      context: WEB_CONTEXT,
      videoId: id,
      contentCheckOk: true,
      racyCheckOk: true,
    }, signal)
    const d = data?.videoDetails
    if (d?.title) {
      const secs = Number(d.lengthSeconds)
      return {
        id,
        title: String(d.title),
        duration: Number.isFinite(secs) && secs > 0 ? secs : null,
        uploader: d.author ? String(d.author) : null,
        artistAvatar: null,
        // the player endpoint lists a 1920x1080 maxres entry when there is one
        thumbnail: bestThumbnail(id, d?.thumbnail?.thumbnails),
      }
    }
  } catch {
  }

  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), INNERTUBE_TIMEOUT_MS)
    try {
      const resp = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
        { signal: ac.signal, headers: { 'User-Agent': USER_AGENT } },
      )
      if (resp.ok) {
        const o: any = await resp.json()
        return { id, title: String(o.title ?? 'Unknown title'), duration: null, uploader: o.author_name ? String(o.author_name) : null, artistAvatar: null, thumbnail: thumbUrl(id) }
      }
    } finally {
      clearTimeout(timer)
    }
  } catch {
  }

  return { id, title: 'Unknown title', duration: null, uploader: null, artistAvatar: null, thumbnail: thumbUrl(id) }
}

/**
 * Look the video up in search results. The `player` endpoint knows a video's
 * title and length but not its channel avatar, which only rides along on a
 * search renderer - so a link play needs this to fill in the gaps.
 */
async function matchFromSearch(id: string, signal?: AbortSignal): Promise<ResolvedTrack | null> {
  const results = await innertubeSearch(id, 5, signal)
  return results.find((r) => r.id === id) ?? results[0] ?? null
}

export async function resolveTrack(
  query: string,
  opts?: { signal?: AbortSignal; source?: 'jiosaavn' | 'youtube' | null; video?: boolean },
): Promise<ResolvedTrack> {
  const q = query.trim()
  if (!q) throw new MusicError('empty query')
  const signal = opts?.signal

  /*
    A JioSaavn link routes itself, so pasting one plays from JioSaavn whatever
    the flags say - `-js` is for searches, and a link never needs it.

    Never for video, though. JioSaavn is an audio catalogue with no picture to
    give, and the video selector run against one of its streams falls all the
    way through `bv*+ba` to the bare audio rung: /vplay on a Saavn link
    produced a "video" play with nothing to watch. Refused rather than quietly
    re-pointed at YouTube - the link names one exact recording, and silently
    playing a different one that merely shares its title is worse than saying
    no. `-js` is refused on the same grounds: it asks for the source that
    cannot answer.

    Imported lazily: this module is the one every play path already loads, and
    the other source should not be on that critical path until it is asked for.
  */
  const saavnLink = /jiosaavn\.com\/song\//i.test(q)
  if (opts?.source === 'jiosaavn' || saavnLink) {
    if (opts?.video) {
      throw new MusicError(
        saavnLink
          ? 'JioSaavn links are audio only - play that one with /play'
          : 'JioSaavn has no video - drop -js, or use /play',
      )
    }
    const { resolveJioSaavnTrack } = await import('./jiosaavn.js')
    return resolveJioSaavnTrack(q, { signal })
  }

  if (isHttpUrl(q)) {
    const id = extractVideoId(q)
    if (!id) {
      const { isPlaylistUrl } = await import('./playlist.js')
      if (isPlaylistUrl(q)) {
        throw new MusicError('Playlists are currently disabled. Try playing individual songs for now.')
      }
      throw new MusicError('unsupported link - only YouTube video URLs work')
    }
    const details = await innertubeDetails(id, signal)
    /*
      One lookup covers all three gaps; skipped entirely when none is missing.

      The thumbnail is the third: with no `maxresdefault`, the player endpoint
      offers nothing above a 336px unsigned `hqdefault` - which is the
      letterboxed 4:3 frame again. A search renderer for the same video answers
      with YouTube's signed 16:9 crop instead, so it is worth the round trip.
    */
    const weakThumb = !details.thumbnail || !HI_RES_VARIANT.test(details.thumbnail)
    if (details.duration == null || details.artistAvatar == null || weakThumb) {
      const match = await matchFromSearch(id, signal).catch(() => null)
      if (match) {
        details.duration ??= match.duration
        details.artistAvatar ??= match.artistAvatar
        // Only from the same video. `matchFromSearch` falls back to the first
        // result when the id isn't among them, and a sharp frame of the wrong
        // song is worse than a soft frame of the right one.
        if (weakThumb && match.id === id && match.thumbnail) {
          details.thumbnail = match.thumbnail
        }
      }
    }
    return { ...details, url: `https://www.youtube.com/watch?v=${id}` }
  }

  /*
    Everything else is a YouTube search. YouTube is the default outright, not
    a fallback: JioSaavn is reached only by naming it - a `jiosaavn.com/song/`
    link, or `-js` on a search - and both are handled above.

    It used to lead here on bitrate, with YouTube catching the misses. Two
    things were wrong with that. A search is a guess at what you meant, and
    the narrower catalogue guessing first meant a query with a good YouTube
    match could be answered by a cover, a remix or a soundalike that happened
    to be the closest thing JioSaavn had. And the bitrate argument no longer
    holds: with Premium cookies YouTube gives 256k AAC, so what the default
    used to buy is now mostly gone.
  */
  const results = await innertubeSearch(q, 1, signal)
  const first = results[0]
  if (!first) throw new MusicError('no results found')
  return first
}

export async function searchTracks(query: string, limit = 5): Promise<ResolvedTrack[]> {
  const q = query.trim()
  if (!q) throw new MusicError('empty query')
  const n = Math.min(Math.max(Math.trunc(limit) || 5, 1), 10)
  return innertubeSearch(q, n)
}
