import { config } from '../../config.js'
import { MusicError, type ResolvedTrack } from './musicSource.js'
import { spawn } from 'node:child_process'

const INNERTUBE_BASE = 'https://www.youtube.com/youtubei/v1'
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
const INNERTUBE_CLIENT_VERSION = '2.20240401.00.00'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
const INNERTUBE_TIMEOUT_MS = 25_000

const WEB_CONTEXT = {
  client: { clientName: 'WEB', clientVersion: INNERTUBE_CLIENT_VERSION, hl: 'en', gl: 'US' },
}

export type ResolvedPlaylist = {
  id: string
  title: string
  url: string
  uploader: string | null
  trackCount: number
  totalDuration: number | null
  thumbnail: string | null
  tracks: ResolvedTrack[]
}

export function extractPlaylistId(url: string): string | null {
  if (!url || typeof url !== 'string') return null
  const isYt = /(?:youtube\.com|youtu\.be)/i.test(url)
  if (!isYt) return null
  const m = url.match(/[?&]list=([A-Za-z0-9_-]+)/)
  return m ? m[1]! : null
}

export function isPlaylistUrl(url: string): boolean {
  return extractPlaylistId(url) !== null
}

function runsText(node: any): string | null {
  if (!node) return null
  if (typeof node.simpleText === 'string') return node.simpleText
  if (Array.isArray(node.runs)) return node.runs.map((r: any) => r?.text ?? '').join('') || null
  return null
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

async function innertubePlaylist(playlistId: string, limit: number, signal?: AbortSignal): Promise<ResolvedPlaylist | null> {
  const browseId = playlistId.startsWith('VL') ? playlistId : `VL${playlistId}`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), INNERTUBE_TIMEOUT_MS)
  if (signal) {
    if (signal.aborted) ac.abort()
    else signal.addEventListener('abort', () => ac.abort(), { once: true })
  }

  try {
    const resp = await fetch(`${INNERTUBE_BASE}/browse?key=${INNERTUBE_KEY}&prettyPrint=false`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'X-Youtube-Client-Name': '1',
        'X-Youtube-Client-Version': INNERTUBE_CLIENT_VERSION,
        Origin: 'https://www.youtube.com',
      },
      body: JSON.stringify({
        context: WEB_CONTEXT,
        browseId,
      }),
    })
    if (!resp.ok) return null
    const data: any = await resp.json()

    const header = data?.header?.playlistHeaderRenderer
    const title = runsText(header?.title)
      ?? runsText(data?.metadata?.playlistMetadataRenderer?.title)
      ?? 'YouTube Playlist'
    const uploader = runsText(header?.ownerText)
      ?? runsText(data?.metadata?.playlistMetadataRenderer?.owner)
      ?? null

    const contents = data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents
    if (!Array.isArray(contents) || contents.length === 0) return null

    const tracks: ResolvedTrack[] = []
    let totalDuration = 0
    let hasDuration = false

    for (const item of contents) {
      const v = item?.playlistVideoRenderer
      if (!v || !v.videoId) continue
      const id = String(v.videoId)
      const secs = Number(v.lengthSeconds)
      const duration = Number.isFinite(secs) && secs > 0 ? secs : null
      if (duration != null) {
        totalDuration += duration
        hasDuration = true
      }
      tracks.push({
        id,
        title: runsText(v.title) ?? 'Unknown track',
        url: `https://www.youtube.com/watch?v=${id}`,
        duration,
        uploader: runsText(v.shortBylineText) ?? uploader,
        artistAvatar: null,
        thumbnail: bestThumbnail(id, v.thumbnail?.thumbnails),
      })
      if (tracks.length >= limit) break
    }

    if (tracks.length === 0) return null

    return {
      id: playlistId,
      title,
      url: `https://www.youtube.com/playlist?list=${playlistId}`,
      uploader,
      trackCount: tracks.length,
      totalDuration: hasDuration ? totalDuration : null,
      thumbnail: tracks[0]?.thumbnail ?? null,
      tracks,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function ytdlpPlaylist(urlOrId: string, limit: number, signal?: AbortSignal): Promise<ResolvedPlaylist> {
  const url = isPlaylistUrl(urlOrId) ? urlOrId : `https://www.youtube.com/playlist?list=${urlOrId}`
  const listId = extractPlaylistId(url) ?? urlOrId
  const bin = config.media.ytdlpBin
  const args = [
    '--flat-playlist',
    '-J',
    '--no-warnings',
    '--playlist-end',
    String(limit),
  ]
  if (config.media.ytdlpCookies) {
    args.push('--cookies', config.media.ytdlpCookies)
  }
  args.push(url)

  return new Promise<ResolvedPlaylist>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new MusicError('canceled'))
      return
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      reject(new MusicError(`yt-dlp not found: ${err instanceof Error ? err.message : String(err)}`))
      return
    }

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      reject(new MusicError('Playlist fetch timed out'))
    }, INNERTUBE_TIMEOUT_MS)

    child.stdout?.on('data', (d) => { stdout += d.toString('utf8') })
    child.stderr?.on('data', (d) => { stderr += d.toString('utf8') })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new MusicError(`Failed to fetch playlist: ${err.message}`))
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new MusicError(`Playlist fetch failed (code ${code}): ${stderr.slice(0, 200)}`))
        return
      }
      try {
        const data = JSON.parse(stdout)
        const entries = Array.isArray(data.entries) ? data.entries : []
        if (entries.length === 0) {
          reject(new MusicError('No tracks found in playlist'))
          return
        }

        let totalDuration = 0
        let hasDuration = false
        const tracks: ResolvedTrack[] = []

        for (const e of entries) {
          if (!e || (!e.id && !e.url)) continue
          const id = String(e.id || extractPlaylistId(e.url) || '')
          if (!id) continue
          const secs = typeof e.duration === 'number' && e.duration > 0 ? e.duration : null
          if (secs != null) {
            totalDuration += secs
            hasDuration = true
          }
          tracks.push({
            id,
            title: String(e.title || 'Unknown track'),
            url: `https://www.youtube.com/watch?v=${id}`,
            duration: secs,
            uploader: e.uploader ? String(e.uploader) : null,
            artistAvatar: null,
            thumbnail: bestThumbnail(id, e.thumbnails),
          })
          if (tracks.length >= limit) break
        }

        resolve({
          id: listId,
          title: String(data.title || 'YouTube Playlist'),
          url: `https://www.youtube.com/playlist?list=${listId}`,
          uploader: data.uploader ? String(data.uploader) : null,
          trackCount: tracks.length,
          totalDuration: hasDuration ? totalDuration : null,
          thumbnail: tracks[0]?.thumbnail ?? null,
          tracks,
        })
      } catch (err) {
        reject(new MusicError(`Could not parse playlist metadata: ${err instanceof Error ? err.message : String(err)}`))
      }
    })
  })
}

export async function resolvePlaylist(
  urlOrId: string,
  limit = 50,
  opts?: { signal?: AbortSignal },
): Promise<ResolvedPlaylist> {
  const listId = extractPlaylistId(urlOrId) ?? urlOrId
  if (!listId) throw new MusicError('Invalid playlist URL')

  // Try Innertube first (fast, direct HTTP)
  const innertubeRes = await innertubePlaylist(listId, limit, opts?.signal).catch(() => null)
  if (innertubeRes && innertubeRes.tracks.length > 0) {
    return innertubeRes
  }

  // Fallback to yt-dlp flat playlist
  return ytdlpPlaylist(urlOrId, limit, opts?.signal)
}
