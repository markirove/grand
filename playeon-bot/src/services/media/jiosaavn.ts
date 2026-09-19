import { config } from '../../config.js'
import { logoUrl } from '../../lib/assets.js'
import { MusicError, type ResolvedTrack } from './musicSource.js'
import { errorMessage } from '../../lib/tgErrors.js'

/**
 * JioSaavn as a track source.
 *
 * Worth having for one reason: it serves 320 kbps AAC where YouTube tops out
 * around 130 kbps, and it does it without a paid account. The download itself
 * needs no code - yt-dlp has had a JioSaavn extractor since 2024, and a
 * `jiosaavn.com/song/...` URL goes through the existing pipeline untouched - so
 * all this module does is answer "which track" and hand back a URL.
 *
 * The API is JioSaavn's own undocumented web endpoint. It has been stable for
 * years and every client in the wild uses it, but it is not a contract: callers
 * should be able to fall back to YouTube rather than fail the play.
 */

const API = 'https://www.jiosaavn.com/api.php'
const CTX = 'ctx=web6dot0&api_version=4&_format=json&_marker=0'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
const TIMEOUT_MS = 15_000
/** Shorter than the direct call: a slow relay should fall back, not stall a play. */
const RELAY_TIMEOUT_MS = 6_000

/** Namespaced so a Saavn id can never collide with a YouTube one in the media cache. */
const ID_PREFIX = 'saavn:'

const SONG_URL = /^https?:\/\/(?:www\.)?jiosaavn\.com\/song\/[^/]+\/([A-Za-z0-9_,\-]+)/i

export function isJioSaavnUrl(url: string): boolean {
  return SONG_URL.test(url.trim())
}

async function api(query: string, signal?: AbortSignal): Promise<any> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  if (signal) {
    if (signal.aborted) ac.abort()
    else signal.addEventListener('abort', () => ac.abort(), { once: true })
  }
  try {
    const resp = await fetch(`${API}?${query}&${CTX}`, {
      signal: ac.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    })
    if (!resp.ok) throw new MusicError(`JioSaavn search failed (HTTP ${resp.status})`)
    return await resp.json()
  } catch (err) {
    if (err instanceof MusicError) throw err
    if ((err as Error)?.name === 'AbortError') throw new MusicError('JioSaavn search timed out')
    throw new MusicError('JioSaavn is unreachable')
  } finally {
    clearTimeout(timer)
  }
}

/** Titles come back HTML-escaped - `Tum Hi Ho (From &quot;Aashiqui 2&quot;)`. */
function decode(raw: unknown): string {
  return String(raw ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

/**
 * Cover art at full size.
 *
 * The API hands out a 150×150 (or 50×50 from autocomplete) thumbnail, and the
 * CDN exposes the rest by filename - the same variant-swap trick the web app
 * already uses for YouTube. 500×500 is the largest they publish, and unlike
 * YouTube it is square, which is what the audio card wants.
 */
function artwork(raw: unknown): string | null {
  const url = typeof raw === 'string' ? raw : ''
  if (!url) return null
  return url.replace(/-\d+x\d+\.(jpg|png|webp)$/i, '-500x500.$1')
}

function seconds(raw: unknown): number | null {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/**
 * Who made it, from whichever shape the API felt like returning.
 *
 * `api_version=4` nests everything under `more_info` and names the track
 * `title`; the older shape puts `primary_artists` at the top level and calls it
 * `song`. Both are live depending on the parameters sent, so every read below
 * tries both rather than betting on one - that mismatch is exactly how this
 * came back with a nameless artist the first time.
 */
function artistsOf(s: any): string | null {
  const primary = s?.more_info?.artistMap?.primary_artists
  if (Array.isArray(primary) && primary.length) {
    const names = primary
      .map((a: any) => decode(a?.name))
      .filter(Boolean)
      .slice(0, 3)
    if (names.length) return names.join(', ')
  }
  const flat = decode(s?.primary_artists ?? s?.singers ?? s?.more_info?.music)
  if (flat) return flat
  // last resort: "Pritam, Arijit Singh - Brahmastra"
  const subtitle = decode(s?.subtitle)
  const head = subtitle.split(' - ')[0]?.trim()
  return head || null
}

/**
 * Tracks from here are credited to JioSaavn rather than to their performer.
 *
 * Saavn publishes no artist images, so the byline would otherwise be a name
 * with a blank circle beside it - where a YouTube track gets a channel and its
 * avatar. Showing the source keeps that slot meaning "where this came from",
 * which is also the honest label while two sources are in play.
 *
 * The performer is not thrown away: it goes to `credits`, which is what the
 * lyrics lookup matches on. Losing it there would cost more than the byline is
 * worth - clean artist metadata is the difference between finding synced
 * lyrics for this catalogue and not.
 */
const SOURCE_NAME = 'JioSaavn'

/** Served by our own room host: JioSaavn's asset URL carries a build hash. */
const sourceAvatar = (): string | null => logoUrl('jiosaavn')

function toTrack(s: any, fallbackUrl?: string): ResolvedTrack | null {
  const url = typeof s?.perma_url === 'string' ? s.perma_url : (fallbackUrl ?? '')
  const bare = decode(s?.title ?? s?.song)
  if (!url || !bare) return null
  const performer = artistsOf(s)
  /*
    Billed "Artist - Title", unlike YouTube where the uploader already writes
    it that way. Saavn's `title` is only ever the song, which reads as bare
    next to a YouTube row and is genuinely ambiguous for the short ones - half
    the catalogue is a single common word.

    It also happens to be the shape the lyrics lookup wants: `guessTrackMeta`
    splits on the dash and takes the head as the artist, which is its most
    reliable path. Guarded against doubling up on the rare title that already
    carries the name.
  */
  const title =
    performer && !bare.toLowerCase().startsWith(performer.toLowerCase())
      ? `${performer} - ${bare}`
      : bare
  return {
    id: `${ID_PREFIX}${s?.id ?? url}`,
    title,
    url,
    duration: seconds(s?.more_info?.duration ?? s?.duration),
    uploader: SOURCE_NAME,
    credits: performer,
    artistAvatar: sourceAvatar(),
    thumbnail: artwork(s?.image),
  }
}

/**
 * A dead relay is easy to miss, because search does not stop working - it
 * starts answering with covers and sped-up edits, which reads as the ranking
 * getting worse rather than the egress being wrong. Throttled so a relay that
 * is down logs once a minute, not once a play.
 */
let lastRelayWarn = 0

function relayFellBack(reason: string): void {
  const now = Date.now()
  if (now - lastRelayWarn < 60_000) return
  lastRelayWarn = now
  console.warn(`[relay] JioSaavn search unavailable, using YouTube instead: ${reason}`)
}

export function relayStatus(): string {
  if (!config.relay.url) return 'not configured (RELAY_URL unset)'
  if (!config.relay.secret) return 'not configured (RELAY_SECRET unset)'
  return config.relay.url
}

async function searchRelayed(q: string, n: number, signal?: AbortSignal): Promise<any[] | null> {
  const base = config.relay.url?.replace(/\/+$/, '')
  if (!base || !config.relay.secret) {
    relayFellBack('relay not configured')
    return null
  }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), RELAY_TIMEOUT_MS)
  if (signal) {
    if (signal.aborted) ac.abort()
    else signal.addEventListener('abort', () => ac.abort(), { once: true })
  }
  try {
    const resp = await fetch(`${base}/saavn/search?q=${encodeURIComponent(q)}&n=${n}`, {
      signal: ac.signal,
      headers: { 'X-Relay-Secret': config.relay.secret, Accept: 'application/json' },
    })
    if (!resp.ok) {
      relayFellBack(`HTTP ${resp.status}`)
      return null
    }
    const data: any = await resp.json()
    if (!Array.isArray(data?.results)) {
      relayFellBack('malformed payload')
      return null
    }
    if (data.results.length === 0) {
      relayFellBack('empty result set')
      return null
    }
    return data.results
  } catch (err) {
    // the caller aborting is a cancelled play, not a relay fault
    if (!signal?.aborted) relayFellBack(errorMessage(err))
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Raw hits, for ranking - the payload carries signals `ResolvedTrack` drops.
 *
 * Relay or nothing. Asking JioSaavn directly from this host answers a search
 * for a well-known single with covers and sped-up edits by unknown uploaders,
 * because the catalogue is geo-filtered on the caller's exit - so a "working"
 * direct fallback is worse than no JioSaavn at all: it silently plays the
 * wrong recording instead of failing. Throwing here sends the caller to
 * YouTube, which is not geo-broken, so a dead relay still costs nobody a play.
 */
async function searchRaw(q: string, n: number, signal?: AbortSignal): Promise<any[]> {
  const relayed = await searchRelayed(q, n, signal)
  if (!relayed) throw new MusicError('JioSaavn search unavailable (relay down)')
  return relayed
}

/**
 * A shared song link.
 *
 * The last path segment is the token the detail endpoint wants; the numeric id
 * in the search payload will not work here.
 */
async function fromLink(url: string, signal?: AbortSignal): Promise<ResolvedTrack> {
  const token = SONG_URL.exec(url.trim())?.[1]
  if (!token) throw new MusicError('unsupported JioSaavn link')

  const data = await api(
    `__call=webapi.get&token=${encodeURIComponent(token)}&type=song&includeMetaTags=0`,
    signal,
  )
  const song = Array.isArray(data?.songs) ? data.songs[0] : data
  const track = toTrack(song, url.trim())
  if (!track) throw new MusicError('that JioSaavn link has no track on it')
  return track
}

/**
 * Marks of a version nobody searching the plain title is asking for.
 *
 * Saavn's catalogue is thick with sped-up edits, lofi flips and instrumental
 * covers, and its search happily ranks them above the record itself - a search
 * for a well-known single can come back with the remix first and the original
 * nowhere in the top eight. These lose unless the query asked for them.
 */
const DERIVATIVE =
  /\b(sped\s*up|slowed|reverb|nightcore|lofi|lo-fi|remix|mix|instrumental|karaoke|cover|tribute|acoustic|piano|8d|mashup|dnb|drill|edit|version|refix|flip)\b/i

/**
 * The title without its trailing qualifier.
 *
 * Bollywood singles ship as `Kesariya (From "Brahmastra")` and NCS uploads as
 * `Control (NCS Release)`. The bracketed part is packaging, not identity, so it
 * must not count as the extra words that {@link scoreCandidate} penalises.
 */
function coreTitle(title: string): string {
  return title.replace(/\s*[([].*$/, '').trim() || title
}

function scoreCandidate(raw: any, query: string): number {
  const q = query.toLowerCase().replace(/\s+/g, ' ').trim()
  const title = decode(raw?.title ?? raw?.song).toLowerCase()
  const artist = (artistsOf(raw) ?? '').toLowerCase()
  const subtitle = decode(raw?.subtitle).toLowerCase()

  let score = 0
  /*
    The whole query inside any one field.

    Checked per field rather than against the three joined together, which is
    what it used to do. "control ncs" appears in neither `Out of Control` nor
    `NCS Epic Music`, but it does appear across the space gluing them - and that
    phantom match was worth +3, the largest single bonus here, which is how an
    8-play upload beat the 248k-play record it was named after.
  */
  if (title.includes(q) || artist.includes(q) || subtitle.includes(q)) score += 3
  const words = q.split(/\s+/).filter((w) => w.length > 2)
  if (words.length) {
    const hit = words.filter(
      (w) => title.includes(w) || artist.includes(w) || subtitle.includes(w),
    ).length
    score += (hit / words.length) * 3
  }

  /*
    Popularity, as the tiebreaker between a record and a copy of it.

    A title-length heuristic went here first and was actively wrong for this
    catalogue: Bollywood singles are published as `Kesariya (From "Brahmastra")`,
    so "shorter is closer" ranked a bedroom cover called plain `Tere Vaaste`
    above the actual soundtrack. Play count separates them the way nothing about
    the strings can - the record has millions, the cover has hundreds - and it
    says nothing about how the title happens to be punctuated. Logged, so it
    orders candidates without ever outweighing a genuine text match.
  */
  /*
    How much of the title the query actually accounts for.

    Asked for "control", `Control` is the record and `Out of Control` and
    `Control the Darkness` are different songs that merely contain the word.
    Word-hit scoring can't tell them apart - all three contain it - so this
    reads the match the other way round and charges for words the title has
    that the query never asked for.

    This is not the title-length heuristic that failed here before: length
    alone ranked a bedroom cover above a soundtrack, because the soundtrack
    carries `(From "…")`. Measuring coverage over `coreTitle` ignores that
    packaging, and the two singles it can't separate are still separated by
    play count below.
  */
  const titleWords = coreTitle(title).split(/\s+/).filter(Boolean)
  if (titleWords.length) {
    const covered = titleWords.filter((w) => q.includes(w)).length
    score += (covered / titleWords.length) * 2
  }

  const plays = Number(raw?.play_count ?? raw?.more_info?.play_count ?? 0)
  if (Number.isFinite(plays) && plays > 0) score += Math.log10(plays) / 3

  // Only a penalty when the *query* didn't ask for it - someone typing
  // "kesariya lofi" should still get the lofi flip.
  if (DERIVATIVE.test(title) && !DERIVATIVE.test(q)) score -= 4
  return score
}

export async function resolveJioSaavnTrack(
  query: string,
  opts?: { signal?: AbortSignal },
): Promise<ResolvedTrack> {
  const q = query.trim()
  if (!q) throw new MusicError('empty query')
  if (isJioSaavnUrl(q)) return fromLink(q, opts?.signal)

  // Ask for a spread and rank it here rather than trusting position: Saavn's
  // own ordering put five derivative cuts above the record for a plain query.
  const raw = await searchRaw(q, 8, opts?.signal)
  if (!raw.length) throw new MusicError('no results found on JioSaavn')

  let best = raw[0]
  let bestScore = scoreCandidate(best, q)
  for (const candidate of raw.slice(1)) {
    const score = scoreCandidate(candidate, q)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }

  const track = toTrack(best)
  if (!track) throw new MusicError('no results found on JioSaavn')
  return track
}
