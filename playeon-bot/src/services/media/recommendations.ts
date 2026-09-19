import { MusicError, type ResolvedTrack } from './musicSource.js'

const INNERTUBE_BASE = 'https://www.youtube.com/youtubei/v1'
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
const INNERTUBE_CLIENT_VERSION = '2.20240401.00.00'
const MUSIC_CLIENT_VERSION = '1.20240401.01.00'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
const INNERTUBE_TIMEOUT_MS = 20_000

const WEB_CONTEXT = {
  client: { clientName: 'WEB', clientVersion: INNERTUBE_CLIENT_VERSION, hl: 'en', gl: 'US' },
}

const MUSIC_CONTEXT = {
  client: { clientName: 'WEB_REMIX', clientVersion: MUSIC_CLIENT_VERSION, hl: 'en', gl: 'US' },
}

const thumbUrl = (id: string): string => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
const maxresUrl = (id: string): string => `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`
const HI_RES_VARIANT = /\/(?:hq720|maxresdefault)\.jpg/i

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

function parseDurationText(text: unknown): number | null {
  if (typeof text !== 'string') return null
  const t = text.trim()
  if (/^\d+(?::\d+)+$/.test(t)) {
    const parts = t.split(':').map((p) => Number(p.trim()))
    if (parts.some((n) => !Number.isFinite(n))) return null
    return parts.reduce((acc, n) => acc * 60 + n, 0) || null
  }
  let total = 0
  let matched = false
  const hr = t.match(/(\d+)\s*(?:hours?|hrs?)/i)
  if (hr) { total += parseInt(hr[1]!, 10) * 3600; matched = true }
  const min = t.match(/(\d+)\s*(?:minutes?|mins?)/i)
  if (min) { total += parseInt(min[1]!, 10) * 60; matched = true }
  const sec = t.match(/(\d+)\s*(?:seconds?|secs?)/i)
  if (sec) { total += parseInt(sec[1]!, 10); matched = true }
  return matched ? total : null
}

function runsText(node: any): string | null {
  if (!node) return null
  if (typeof node.simpleText === 'string') return node.simpleText
  if (Array.isArray(node.runs)) return node.runs.map((r: any) => r?.text ?? '').join('') || null
  return null
}

async function fetchInnertube(
  endpoint: string,
  body: unknown,
  isMusic = false,
  signal?: AbortSignal,
): Promise<any> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), INNERTUBE_TIMEOUT_MS)
  if (signal) {
    if (signal.aborted) ac.abort()
    else signal.addEventListener('abort', () => ac.abort(), { once: true })
  }
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      'X-Youtube-Client-Name': isMusic ? '67' : '1',
      'X-Youtube-Client-Version': isMusic ? MUSIC_CLIENT_VERSION : INNERTUBE_CLIENT_VERSION,
      Origin: isMusic ? 'https://music.youtube.com' : 'https://www.youtube.com',
    }
    if (isMusic) {
      headers.Referer = 'https://music.youtube.com/'
    }

    const resp = await fetch(`${INNERTUBE_BASE}/${endpoint}?key=${INNERTUBE_KEY}&prettyPrint=false`, {
      method: 'POST',
      signal: ac.signal,
      headers,
      body: JSON.stringify(body),
    })
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Primary recommendation engine:
 * Fetches YouTube Music automix radio playlist queue for the given video ID.
 * Completely unauthenticated and unpersonalized.
 */
async function fetchMusicAutomixRecommendations(
  videoId: string,
  signal?: AbortSignal,
): Promise<ResolvedTrack[]> {
  const data = await fetchInnertube(
    'next',
    {
      context: MUSIC_CONTEXT,
      videoId,
      playlistId: `RDAMVM${videoId}`,
      isAudioOnly: true,
    },
    true,
    signal,
  )

  const queue =
    data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer
      ?.tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents

  if (!Array.isArray(queue) || queue.length === 0) return []

  const tracks: ResolvedTrack[] = []
  for (const item of queue) {
    const p = item?.playlistPanelVideoRenderer
    if (!p || !p.videoId) continue
    const id = String(p.videoId)
    if (id === videoId) continue // Skip the seed track itself

    const duration = parseDurationText(runsText(p.lengthText))
    const uploader = runsText(p.shortBylineText) ?? runsText(p.longBylineText)
    const title = runsText(p.title) ?? 'Unknown track'

    tracks.push({
      id,
      title,
      url: `https://www.youtube.com/watch?v=${id}`,
      duration,
      uploader,
      artistAvatar: null,
      thumbnail: bestThumbnail(id, p.thumbnail?.thumbnails),
    })
  }

  return tracks
}

/**
 * Secondary recommendation engine:
 * Standard YouTube Watch Next related video recommendations.
 */
async function fetchWatchNextRecommendations(
  videoId: string,
  signal?: AbortSignal,
): Promise<ResolvedTrack[]> {
  const data = await fetchInnertube(
    'next',
    {
      context: WEB_CONTEXT,
      videoId,
    },
    false,
    signal,
  )

  const results =
    data?.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results
  if (!Array.isArray(results) || results.length === 0) return []

  const tracks: ResolvedTrack[] = []
  for (const item of results) {
    // Check compactVideoRenderer or videoRenderer
    const v = item?.compactVideoRenderer || item?.videoRenderer
    if (v && v.videoId) {
      const id = String(v.videoId)
      if (id === videoId) continue
      const title = runsText(v.title) ?? 'Unknown track'
      const duration = parseDurationText(runsText(v.lengthText))
      const uploader = runsText(v.shortBylineText) ?? runsText(v.longBylineText)
      tracks.push({
        id,
        title,
        url: `https://www.youtube.com/watch?v=${id}`,
        duration,
        uploader,
        artistAvatar:
          v?.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail
            ?.thumbnails?.[0]?.url ?? null,
        thumbnail: bestThumbnail(id, v?.thumbnail?.thumbnails),
      })
      continue
    }

    // Check modern lockupViewModel
    const lockup = item?.lockupViewModel
    if (lockup && lockup.contentId) {
      const id = String(lockup.contentId)
      if (id === videoId) continue
      const meta = lockup.metadata?.lockupMetadataViewModel
      const title = meta?.title?.content ?? 'Unknown track'

      let duration: number | null = null
      const overlays = lockup.contentImage?.thumbnailViewModel?.overlays
      if (Array.isArray(overlays)) {
        for (const ov of overlays) {
          const badges = ov?.thumbnailBottomOverlayViewModel?.badges
          if (Array.isArray(badges)) {
            for (const b of badges) {
              const txt = b?.thumbnailBadgeViewModel?.text
              const d = parseDurationText(txt)
              if (d != null) {
                duration = d
                break
              }
            }
          }
          if (duration != null) break
        }
      }
      if (duration == null) {
        const label = lockup.rendererContext?.accessibilityContext?.label
        if (label) duration = parseDurationText(label)
      }

      let uploader: string | null = null
      const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const parts = row?.metadataParts || row?.elements || []
          for (const p of parts) {
            const txt = p?.text?.content || p?.text?.simpleText
            if (typeof txt === 'string' && txt && !txt.includes('views') && !txt.includes('ago')) {
              uploader = txt.trim()
              break
            }
          }
          if (uploader) break
        }
      }

      const thumbnailSources = lockup.contentImage?.thumbnailViewModel?.image?.sources
      const thumbnail = bestThumbnail(id, thumbnailSources)

      tracks.push({
        id,
        title,
        url: `https://www.youtube.com/watch?v=${id}`,
        duration,
        uploader,
        artistAvatar: null,
        thumbnail,
      })
    }
  }

  return tracks
}

// In-memory LRU/TTL cache for track recommendations
type CacheEntry = {
  expiresAt: number
  tracks: ResolvedTrack[]
}
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes
const MAX_CACHE_ENTRIES = 300
const recCache = new Map<string, CacheEntry>()

function getCachedRecommendations(key: string): ResolvedTrack[] | null {
  const entry = recCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    recCache.delete(key)
    return null
  }
  return entry.tracks
}

function setCachedRecommendations(key: string, tracks: ResolvedTrack[]): void {
  recCache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    tracks,
  })
  while (recCache.size > MAX_CACHE_ENTRIES) {
    recCache.delete(recCache.keys().next().value as string)
  }
}

export type TrackSeed = {
  id?: string | null
  title: string
  uploader?: string | null
}

export type RecommendationOptions = {
  limit?: number
  excludeIds?: string[]
  signal?: AbortSignal
}

async function resolveSeedVideoId(seed: TrackSeed): Promise<string | null> {
  if (seed.id) return seed.id
  if (!seed.title) return null
  try {
    const { searchTracks } = await import('./musicSource.js')
    const q = seed.uploader ? `${seed.title} ${seed.uploader}` : seed.title
    const searchRes = await searchTracks(q, 1)
    return searchRes[0]?.id ?? null
  } catch {
    return null
  }
}

/**
 * Get robust, unpersonalized track recommendations based on current and recent tracks.
 * Prioritizes the primary (most recent) track while using session history for contextual scoring.
 */
export async function getRecommendedTracks(
  seedOrSeeds: TrackSeed | TrackSeed[],
  opts?: RecommendationOptions,
): Promise<ResolvedTrack[]> {
  const seeds: TrackSeed[] = Array.isArray(seedOrSeeds)
    ? seedOrSeeds.filter((s) => s && s.title)
    : seedOrSeeds && seedOrSeeds.title
      ? [seedOrSeeds]
      : []

  if (seeds.length === 0) return []

  const primarySeed = seeds[0]!
  const contextSeeds = seeds.slice(1, 5)
  const limit = Math.max(1, Math.min(opts?.limit ?? 10, 50))

  const excludeSet = new Set<string>(opts?.excludeIds?.filter(Boolean) ?? [])
  for (const s of seeds) {
    if (s.id) excludeSet.add(s.id)
  }

  const primaryId = await resolveSeedVideoId(primarySeed)
  const cacheKey = primaryId
    ? `multi:${primaryId}:${contextSeeds.map((c) => c.id || c.title).join(',')}`
    : `query:${primarySeed.title}:${primarySeed.uploader ?? ''}`

  const cached = getCachedRecommendations(cacheKey)
  if (cached && cached.length >= limit) {
    return cached.filter((t) => !excludeSet.has(t.id)).slice(0, limit)
  }

  // Fetch primary candidates (from most recent track)
  let primaryCandidates: ResolvedTrack[] = []
  if (primaryId) {
    try {
      primaryCandidates = await fetchMusicAutomixRecommendations(primaryId, opts?.signal)
      if (primaryCandidates.length < limit) {
        const watchNext = await fetchWatchNextRecommendations(primaryId, opts?.signal)
        for (const t of watchNext) {
          if (!primaryCandidates.some((c) => c.id === t.id)) primaryCandidates.push(t)
        }
      }
    } catch {
    }
  }

  if (primaryCandidates.length === 0) {
    try {
      const { searchTracks } = await import('./musicSource.js')
      const q = primarySeed.uploader ? `${primarySeed.title} ${primarySeed.uploader}` : primarySeed.title
      const searchRes = await searchTracks(q, limit + 5)
      primaryCandidates = searchRes.filter((t) => t.id !== primaryId)
    } catch {
    }
  }

  // Fetch secondary context candidates if available
  let secondaryCandidateIds = new Set<string>()
  if (contextSeeds.length > 0) {
    const secId = await resolveSeedVideoId(contextSeeds[0]!)
    if (secId) {
      try {
        const secTracks = await fetchMusicAutomixRecommendations(secId, opts?.signal)
        for (const st of secTracks) secondaryCandidateIds.add(st.id)
      } catch {
      }
    }
  }

  // Score candidates
  const recentArtists = seeds
    .map((s) => s.uploader?.toLowerCase().trim())
    .filter(Boolean) as string[]

  type ScoredCandidate = {
    track: ResolvedTrack
    score: number
  }

  const scored: ScoredCandidate[] = []
  const artistTrackCounts = new Map<string, number>()

  for (let i = 0; i < primaryCandidates.length; i++) {
    const t = primaryCandidates[i]!
    if (!t.id || excludeSet.has(t.id)) continue

    // Base score from primary seed ranking
    let score = Math.max(10, 100 - i * 2)

    // Overlap bonus: also recommended by previous track in the session
    if (secondaryCandidateIds.has(t.id)) {
      score += 25
    }

    // Artist alignment bonus
    const trackArtist = t.uploader?.toLowerCase().trim()
    if (trackArtist && recentArtists.some((a) => a.includes(trackArtist) || trackArtist.includes(a))) {
      score += 15
    }

    scored.push({ track: t, score })
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  // Deduplicate and apply artist diversity cap (max 2 songs per artist in top batch)
  const finalTracks: ResolvedTrack[] = []
  const seenIds = new Set<string>()

  for (const { track } of scored) {
    if (seenIds.has(track.id)) continue
    const artist = track.uploader?.toLowerCase().trim() ?? ''
    const currentCount = artist ? (artistTrackCounts.get(artist) ?? 0) : 0
    if (currentCount >= 2 && finalTracks.length < limit - 1) continue

    seenIds.add(track.id)
    if (artist) artistTrackCounts.set(artist, currentCount + 1)
    finalTracks.push(track)
    if (finalTracks.length >= 30) break
  }

  if (finalTracks.length > 0) {
    setCachedRecommendations(cacheKey, finalTracks)
  }

  return finalTracks.slice(0, limit)
}
