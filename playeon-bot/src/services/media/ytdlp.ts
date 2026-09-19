import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { config } from '../../config.js'

function findBin(name: string): string | null {
  for (const dir of ['/usr/bin', '/bin', '/usr/local/bin']) {
    const p = `${dir}/${name}`
    if (existsSync(p)) return p
  }
  return null
}
const NICE_BIN = process.platform === 'linux' ? findBin('nice') : null
const IONICE_BIN = process.platform === 'linux' ? findBin('ionice') : null
const ARIA2C_BIN = findBin('aria2c')

export class YtdlpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'YtdlpError'
  }
}

export type ResolvedTrack = {
  id: string
  title: string
  url: string
  duration: number | null
  uploader: string | null
}

export type DownloadProgress = {
  percent: number | null
  speed: string | null
  eta: string | null
}

const isHttpUrl = (s: string): boolean => /^https?:\/\/\S+/i.test(s)

function baseArgs(cookiePath: string | null): string[] {
  const args: string[] = []
  if (config.media.ytdlpJsRuntime) args.push('--js-runtimes', config.media.ytdlpJsRuntime)
  if (config.media.ytdlpRemoteComponents) args.push('--remote-components', config.media.ytdlpRemoteComponents)
  if (config.media.ytdlpPlayerClients) {
    args.push('--extractor-args', `youtube:player_client=${config.media.ytdlpPlayerClients}`)
  }
  if (cookiePath) args.push('--cookies', cookiePath)
  return args
}

/**
 * Fallback jar for when `YTDLP_COOKIES` is unset. It sits beside the checkout
 * rather than under /root so a backup of the home directory never carries a
 * logged-in YouTube session out with it.
 */
const EXTERNAL_COOKIES = '/srv/.22b550314c92/yt/cookies.txt'

function cookieSource(): string | null {
  const custom = config.media.ytdlpCookies
  if (custom) {
    const resolved = path.resolve(process.cwd(), custom)
    if (existsSync(resolved)) return resolved
    if (existsSync(custom)) return custom
  }
  if (existsSync(EXTERNAL_COOKIES)) return EXTERNAL_COOKIES
  const localDefault = path.resolve(process.cwd(), 'cookies.txt')
  if (existsSync(localDefault)) return localDefault
  return null
}

async function withCookies<T>(fn: (cookiePath: string | null) => Promise<T>): Promise<T> {
  const source = cookieSource()
  if (!source) return fn(null)

  await mkdir(config.media.tmpDir, { recursive: true })
  const copy = path.join(config.media.tmpDir, `cookies-${randomBytes(6).toString('hex')}.txt`)
  try {
    await copyFile(source, copy)
  } catch (err) {
    throw new YtdlpError(`could not read cookies file "${source}": ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    return await fn(copy)
  } finally {
    await rm(copy, { force: true }).catch(() => {})
  }
}

const YTDLP_TIMEOUT = 5 * 60 * 1000

type YtdlpRun = { stdout: string; stderr: string }

function spawnTarget(args: string[]): { cmd: string; argv: string[] } {
  const bin = config.media.ytdlpBin
  if (NICE_BIN) {
    const argv = ['-n', '10']
    if (IONICE_BIN) argv.push(IONICE_BIN, '-c', '2', '-n', '7')
    argv.push(bin, ...args)
    return { cmd: NICE_BIN, argv }
  }
  return { cmd: bin, argv: args }
}

function spawnYtdlp(
  args: string[],
  opts: { onLine?: (line: string) => void; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<YtdlpRun> {
  return new Promise<YtdlpRun>((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new YtdlpError('canceled'))
      return
    }
    let child
    try {
      const { cmd, argv } = spawnTarget(args)
      child = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      reject(new YtdlpError(err instanceof Error ? err.message : String(err)))
      return
    }

    let stdout = ''
    let stderr = ''
    let outClosed = false
    let errClosed = false
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill('SIGKILL') } catch {  }
      reject(new YtdlpError(`yt-dlp timed out after ${Math.round((opts.timeoutMs ?? YTDLP_TIMEOUT) / 1000)}s`))
    }, opts.timeoutMs ?? YTDLP_TIMEOUT)
    timer.unref?.()

    const onAbort = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child.kill('SIGKILL') } catch {  }
      reject(new YtdlpError('canceled'))
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const settle = (): void => {
      if (settled || !outClosed || !errClosed) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ stdout, stderr })
    }

    const makeReader = (append: (s: string) => void) => {
      let buf = ''
      return (d: Buffer): void => {
        const s = d.toString()
        append(s)
        if (opts.onLine) {
          buf += s
          const parts = buf.split('\n')
          buf = parts.pop() ?? ''
          for (const l of parts) opts.onLine(l)
        }
      }
    }
    child.stdout.on('data', makeReader((s) => { stdout += s }))
    child.stderr.on('data', makeReader((s) => { stderr += s }))
    child.stdout.on('close', () => { outClosed = true; settle() })
    child.stderr.on('close', () => { errClosed = true; settle() })

    child.on('error', (e: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(
        e.code === 'ENOENT'
          ? new YtdlpError(`yt-dlp not found (looked for "${config.media.ytdlpBin}"; set YTDLP_BIN)`)
          : new YtdlpError(e.message),
      )
    })
  })
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Failures that a fresh yt-dlp process tends to clear on its own.
 *
 * The big one is "Sign in to confirm you're not a bot": it reads like a cookie
 * problem but isn't - valid cookies hit it too, on the same video and the same
 * argv, failing one run and succeeding the next. It's an IP-reputation throttle
 * on YouTube's side, so the only thing that helps from here is trying again a
 * moment later. The rest are ordinary network / downloader blips.
 */
const RETRIABLE = [
  'sign in to confirm',
  'not a bot',
  'http error 429',
  'http error 5',
  'unable to download webpage',
  'unable to download api page',
  'unable to download player',
  'failed to extract',
  'unable to extract',
  'the read operation timed out',
  'read timed out',
  'connection reset',
  'connection aborted',
  'temporary failure in name resolution',
  'aria2c exited with code',
  'giving up after',
  // Under the same throttle, a client can hand back a stub response: an empty
  // search result for a known video, or a format list missing everything but
  // the storyboard. A fresh process gets the real one.
  'no results found',
  'could not parse yt-dlp output',
  'requested format is not available',
  'no video formats found',
]

function isRetriable(msg: string): boolean {
  const m = msg.toLowerCase()
  return RETRIABLE.some((s) => m.includes(s))
}

const YTDLP_ATTEMPTS = Math.min(Math.max(parseInt(process.env['YTDLP_ATTEMPTS'] ?? '3', 10) || 3, 1), 6)

async function withRetry<T>(fn: (attempt: number) => Promise<T>, signal?: AbortSignal): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= YTDLP_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new YtdlpError('canceled')
    try {
      return await fn(attempt)
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'canceled' || attempt === YTDLP_ATTEMPTS || !isRetriable(msg)) throw err
      await delay(Math.min(1500 * attempt, 5000))
    }
  }
  throw lastErr
}

/**
 * `validate` runs on the stdout of a successful process and may throw a
 * retriable `YtdlpError` - a throttled client can exit 0 with a stub payload
 * (empty search result, format list with only a storyboard), and the caller's
 * "no results" check belongs inside the retry, not after it.
 */
function runYtdlp(
  args: string[],
  signal?: AbortSignal,
  validate?: (stdout: string) => void,
): Promise<string> {
  return withRetry(
    () =>
      withCookies(async (cookiePath) => {
        const { stdout, stderr } = await spawnYtdlp([...baseArgs(cookiePath), ...args], { signal })
        if (!stdout.trim()) throw new YtdlpError(cleanupError(stderr) || 'yt-dlp produced no output')
        validate?.(stdout)
        return stdout
      }),
    signal,
  )
}

function cleanupError(stderr: string): string {
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean)
  const errLine = lines.reverse().find((l) => l.startsWith('ERROR:'))
  const msg = (errLine ?? lines[0] ?? '').replace(/^ERROR:\s*/, '')
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg
}

export async function resolveTrack(query: string): Promise<ResolvedTrack> {
  const q = query.trim()
  if (!q) throw new YtdlpError('empty query')

  const target = isHttpUrl(q) ? q : `ytsearch1:${q}`
  const parse = (raw: string): any => {
    let json: any
    try {
      json = JSON.parse(raw)
    } catch {
      throw new YtdlpError('could not parse yt-dlp output')
    }
    const entry = json?._type === 'playlist' ? json.entries?.[0] : json
    if (!entry) throw new YtdlpError('no results found')
    return entry
  }

  const raw = await runYtdlp(
    ['-J', '--no-playlist', '--no-warnings', '--default-search', 'ytsearch1', target],
    undefined,
    parse,
  )
  const entry = parse(raw)

  return {
    id: String(entry.id ?? randomBytes(6).toString('hex')),
    title: String(entry.title ?? 'Unknown title'),
    url: String(entry.webpage_url ?? entry.original_url ?? entry.url ?? q),
    duration: typeof entry.duration === 'number' ? Math.round(entry.duration) : null,
    uploader: entry.uploader ? String(entry.uploader) : null,
  }
}

function watchUrl(entry: any): string {
  const u = entry.webpage_url ?? entry.url
  if (typeof u === 'string' && isHttpUrl(u)) return u
  return `https://www.youtube.com/watch?v=${entry.id}`
}

export async function searchTracks(query: string, limit = 5): Promise<ResolvedTrack[]> {
  const q = query.trim()
  if (!q) throw new YtdlpError('empty query')
  const n = Math.min(Math.max(Math.trunc(limit) || 5, 1), 10)

  const raw = await runYtdlp(
    ['-J', '--flat-playlist', '--no-warnings', `ytsearch${n}:${q}`],
    undefined,
    (out) => {
      try { JSON.parse(out) } catch { throw new YtdlpError('could not parse yt-dlp output') }
    },
  )
  let json: any
  try { json = JSON.parse(raw) } catch { throw new YtdlpError('could not parse yt-dlp output') }

  const entries: any[] = Array.isArray(json?.entries) ? json.entries : []
  return entries.filter(Boolean).map((e) => ({
    id: String(e.id ?? ''),
    title: String(e.title ?? 'Unknown title'),
    url: watchUrl(e),
    duration: typeof e.duration === 'number' ? Math.round(e.duration) : null,
    uploader: e.uploader ? String(e.uploader) : (e.channel ? String(e.channel) : null),
  }))
}

/**
 * Route the mint through the relay, when asked to.
 *
 * A googlevideo URL is issued against the IP that asks for it and can carry a
 * `gcr` country lock, so where it is minted decides who can play it - mint in
 * Singapore and an Indian listener gets a stream that refuses to load. The
 * tunnel moves only that handshake; the audio still comes from wherever it
 * comes from.
 *
 * Behind a flag because it is not free: binding streams to the relay's country
 * is right when the listeners are there and wrong when they are not. Cookies
 * are unaffected - yt-dlp holds them and speaks TLS end-to-end through the
 * tunnel, so the relay never sees them.
 */
function mintProxyArgs(): string[] {
  if (!config.relay.mint || !config.relay.proxy) return []
  return ['--proxy', config.relay.proxy]
}

export async function getDirectVideoUrl(
  track: ResolvedTrack,
  maxHeight = 1080,
  signal?: AbortSignal,
): Promise<{ url: string; height: number | null }> {
  const raw = await runYtdlp([
    ...mintProxyArgs(),
    '--no-playlist',
    '--no-warnings',
    '-f', `bv*[height<=${maxHeight}]/bv*`,
    '-S', `res:${maxHeight},vcodec:h264`,
    '--print', '%(height)s',
    '--print', '%(urls)s',
    track.url,
  ], signal)
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  const url = lines.find((l) => isHttpUrl(l))
  if (!url) throw new YtdlpError('could not resolve a direct video URL')
  const parsed = Number(lines[0])
  return { url, height: Number.isFinite(parsed) && parsed > 0 ? parsed : null }
}

export type DownloadedMedia = { path: string; dispose: () => Promise<void> }

const PROGRESS_PREFIX = 'NTGPROG '

function parseProgress(line: string): DownloadProgress | null {
  if (!line.startsWith(PROGRESS_PREFIX)) return null
  const [pctRaw, speed, eta] = line.slice(PROGRESS_PREFIX.length).trim().split('\t')
  const pct = pctRaw ? Number(pctRaw.replace('%', '').trim()) : NaN
  return {
    percent: Number.isFinite(pct) ? pct : null,
    speed: speed && speed !== 'NA' ? speed.trim() : null,
    eta: eta && eta !== 'NA' ? eta.trim() : null,
  }
}

/**
 * Rank audio on what it actually sounds like, not on its container.
 *
 * The old selector asked for `bestaudio[ext=m4a]`, which pinned every track to
 * itag 140 - AAC-LC 128k - because an m4a always exists to match. That made the
 * ceiling the format, not the account: a Premium login offering 256k would have
 * gone unnoticed. Sorting instead means the same line picks the best on offer
 * and rises on its own the day the account does.
 *
 * AAC leads, and `abr` decides among AAC. Reversing those two is what let
 * Opus through: on Premium, YouTube ships itag 141 (AAC 256k) and 774 (Opus
 * 256k) side by side, and the pair land within a fraction of a kbps of each
 * other - measured across six tracks, 257.488 to 257.502, sometimes exactly
 * equal. With `abr` first, whichever happened to round up won, and a webm
 * came down instead of an m4a. AAC first makes it deterministic.
 *
 * This is a compatibility choice, not a fidelity one. At 256k the two are
 * both transparent and Opus is if anything the better codec - but Opus in
 * WebM needs iOS 17.4+, and this plays back inside Telegram's WKWebView.
 *
 * Sorting still beats filtering, which is what this replaced: the old
 * `bestaudio[ext=m4a]` pinned every track to itag 140 (AAC 128k) because an
 * m4a always exists to match, making the ceiling the format rather than the
 * account. A key only orders what is there, so a source carrying no AAC at
 * all - JioSaavn - is untouched by the first key and still ranked on `abr`.
 */
const AUDIO_SORT = 'acodec:aac,abr,asr,ext:m4a'

/**
 * "Highest quality" has to mean highest quality *the player can decode*.
 *
 * Sorting on bitrate alone picks the Dolby tracks YouTube attaches to official
 * music videos - a 384k E-AC-3 5.1 stream beats a 140k stereo one on paper and
 * plays as silence in a WebView, which is the worst possible failure: a large
 * download, a full progress bar, no sound. `ec-3`/`ac-3` are the codec strings
 * yt-dlp actually reports (not `eac3`), and the channel cap catches surround
 * shipped under any other name.
 *
 * The chain degrades rather than fails. A source whose formats don't declare
 * `acodec` or `audio_channels` - JioSaavn reports neither - is dropped by the
 * strict group and caught by the bare `ba`, where the sort above still picks
 * its 320k. So the guard can only ever help; it can never leave a track
 * undownloadable.
 */
const DECODABLE = '[audio_channels<=2][acodec!^=ec-3][acodec!^=ac-3]'
const AUDIO_FORMAT = `ba${DECODABLE}/ba[acodec!^=ec-3][acodec!^=ac-3]/ba/b`

function formatArgs(video: boolean, maxHeight?: number | null): string[] {
  if (!video) return ['-f', AUDIO_FORMAT, '-S', AUDIO_SORT]

  const h = maxHeight === undefined ? config.media.videoHeight : maxHeight

  // Audio keys sit after the video ones: picture quality still decides the
  // format, but among equals the better soundtrack wins. `acodec:aac` leads
  // them for the reason it does above, and doubly so here - this branch
  // merges to mp4, and Opus in an mp4 container is the one pairing that is
  // worse supported than either part of it.
  if (h != null && h <= 1080) {
    return [
      '-f', `bv*[height<=${h}]+ba${DECODABLE}/bv*[height<=${h}]+ba/b[height<=${h}]/bv*+ba/b`,
      '-S', `res:${h},vcodec:h264,acodec:aac,abr,ext:mp4:m4a`,
      '--merge-output-format', 'mp4',
    ]
  }

  const cap = h == null ? '' : `[height<=${h}]`
  const sortRes = h == null ? 'res' : `res:${h}`
  return [
    '-f', `bv*${cap}+ba/b${cap}/bv*+ba/b`,
    '-S', `${sortRes},vcodec:av01:vp9:h264,abr`,
    '--merge-output-format', 'mp4/webm',
  ]
}

function downloaderArgs(): string[] {
  const n = config.media.ytdlpConcurrency
  if (ARIA2C_BIN) {
    return ['--downloader', ARIA2C_BIN, '--downloader-args', `aria2c:-x${n} -s${n} -k1M -c --min-split-size=1M`]
  }
  return ['--concurrent-fragments', String(n), '--http-chunk-size', '10M']
}

export function downloadTrack(
  track: ResolvedTrack,
  video: boolean,
  onProgress?: (p: DownloadProgress) => void,
  opts?: { maxHeight?: number | null; signal?: AbortSignal },
): Promise<DownloadedMedia> {
  const dir = path.join(config.media.tmpDir, `dl-${randomBytes(8).toString('hex')}`)
  const dispose = (): Promise<void> => rm(dir, { recursive: true, force: true }).then(() => {})

  return withRetry(() => withCookies(async (cookiePath) => {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    await mkdir(dir, { recursive: true })
    const args = [
      ...baseArgs(cookiePath),
      ...formatArgs(video, opts?.maxHeight),
      ...downloaderArgs(),
      '--no-playlist',
      '--no-warnings',
      '--no-part',
      '--fixup', 'never',
      '--newline',
      '--progress-template', `${PROGRESS_PREFIX}%(progress._percent_str)s\t%(progress._speed_str)s\t%(progress._eta_str)s`,
      '-o', path.join(dir, 'track.%(ext)s'),
      track.url,
    ]

    try {
      const { stderr } = await spawnYtdlp(args, {
        signal: opts?.signal,
        onLine: (line) => {
          const p = parseProgress(line.trim())
          if (p && onProgress) onProgress(p)
        },
      })
      const files = (await readdir(dir)).filter((f) => f.startsWith('track.'))
      if (files.length === 0) {
        throw new YtdlpError(cleanupError(stripProgress(stderr)) || 'download produced no file')
      }
      return { path: path.join(dir, files[0]!), dispose }
    } catch (err) {
      await dispose().catch(() => {})
      throw err
    }
  }), opts?.signal)
}

function stripProgress(text: string): string {
  return text.split('\n').filter((l) => !l.startsWith(PROGRESS_PREFIX)).join('\n')
}
