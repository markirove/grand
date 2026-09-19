import { networkInterfaces } from 'node:os'

const required = (name: string): string => {
  const val = process.env[name]
  if (!val) throw new Error(`Missing required env var: ${name}`)
  return val
}

const optional = (name: string): string | undefined => process.env[name] || undefined

const devMode = (process.env['DEV_MODE'] ?? '') === '1' || process.env['NODE_ENV'] === 'development'

function getLocalLanIp(): string {
  try {
    const ifaces = networkInterfaces()
    for (const name of Object.keys(ifaces)) {
      for (const net of ifaces[name] ?? []) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address
        }
      }
    }
  } catch {}
  return '127.0.0.1'
}

const localLanIp = getLocalLanIp()

export const config = {
  devMode,
  localLanIp,
  apiId: parseInt(required('API_ID'), 10),
  apiHash: required('API_HASH'),
  botToken: required('BOT_TOKEN'),
  mongoUri: process.env['MONGO_URI'] ?? 'mongodb://localhost:27017',
  mongoDb: process.env['MONGO_DB'] ?? 'playeon',
  redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  devIds: (optional('DEV_IDS') ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(Number),
  logGroupId: optional('LOG_GROUP_ID') ? parseInt(optional('LOG_GROUP_ID')!, 10) : null,
  defaultPrefix: process.env['DEFAULT_PREFIX'] ?? '/',
  sessionName: process.env['SESSION_NAME'] ?? 'playeon-session',
  webPublicUrl: (process.env['WEB_PUBLIC_URL'] ?? 'https://playeon-bot.xysushi.in').replace(/\/+$/, ''),
  room: {
    wsPort: parseInt(process.env['ROOM_WS_PORT'] ?? '3067', 10),
    publicUrl: (devMode
      ? (process.env['ROOM_DEV_PUBLIC_URL'] ?? `http://${localLanIp}:${process.env['ROOM_WS_PORT'] ?? '3067'}`)
      : (process.env['ROOM_PUBLIC_URL'] ?? `http://localhost:${process.env['ROOM_WS_PORT'] ?? '3067'}`)).replace(/\/+$/, ''),
    jwtSecret: process.env['ROOM_JWT_SECRET'] || required('BOT_TOKEN'),
    botUsername: optional('BOT_USERNAME'),
    maxQueue: parseInt(process.env['ROOM_MAX_QUEUE'] ?? '50', 10),
    perParticipantVideoUrl: (process.env['ROOM_PER_PARTICIPANT_VIDEO'] ?? '0') !== '0',
    videoQualityLadder: (process.env['ROOM_VIDEO_QUALITY_LADDER'] ?? '1') !== '0',
  },

  features: {
    endButton: (process.env['FEATURE_END_BUTTON'] ?? 'false') === 'true',
    downloadButton: (process.env['FEATURE_DOWNLOAD_BUTTON'] ?? 'false') === 'true',
    thumbnailEmbed: (process.env['FEATURE_THUMBNAIL_EMBED'] ?? 'true') === 'true',
    /**
     * Premium emoji in bot responses.
     *
     * Off by default, and off is the safe state: these only send while the
     * account behind the bot can use custom emoji, so a lapsed subscription
     * turns every card that carries one into a failed send. Set
     * `FEATURE_EMOJI=true` to turn them back on.
     */
    emoji: (process.env['FEATURE_EMOJI'] ?? 'false') === 'true',
    /**
     * Use custom/premium emoji download progress bar.
     * If false, falls back to the text glyph bar (▰▱).
     */
    premiumProgressBar: (process.env['FEATURE_PREMIUM_PROGRESS_BAR'] ?? process.env['FEATURE_PREMIUM_BAR'] ?? 'true') === 'true',
    /**
     * YouTube playlist support via direct playlist URLs.
     * Disabled by default (set FEATURE_PLAYLISTS=true to enable).
     */
    playlists: (process.env['FEATURE_PLAYLISTS'] ?? 'false') === 'true',
  },

  links: {
    channelUrl: `https://t.me/${(process.env['CHANNEL_USERNAME'] ?? 'PlayeonX').replace(/^@/, '')}`,
    supportUrl: `https://t.me/${(process.env['SUPPORT_USERNAME'] ?? 'PlayeonChat').replace(/^@/, '')}`,
  },

  media: {
    tmpDir: process.env['MEDIA_TMP_DIR'] ?? '/tmp/playeon-media',
    videoHeight: 1080,
    maxVideoMb: 1536,
    ytdlpBin: process.env['YTDLP_BIN'] ?? 'yt-dlp',
    ytdlpConcurrency: Math.min(Math.max(parseInt(process.env['YTDLP_CONCURRENCY'] ?? '16', 10) || 16, 1), 64),
    ytdlpCookies: optional('YTDLP_COOKIES'),
    ytdlpJsRuntime: process.env['YTDLP_JS_RUNTIME'] ?? 'node',
    ytdlpRemoteComponents: process.env['YTDLP_REMOTE_COMPONENTS'] ?? '',
    /**
     * Which YouTube player clients yt-dlp is allowed to use, passed as
     * `--extractor-args youtube:player_client=…`.
     *
     * `default` = yt-dlp's own curated set for the current auth state. It was
     * briefly pinned to `mweb` to dodge the "Sign in to confirm you're not a
     * bot" challenge, but that didn't hold: the challenge is an IP-reputation
     * throttle that hits every client intermittently (same video, same args,
     * fails then succeeds seconds apart), and on videos where `mweb` doesn't
     * carry itag 140 it drops audio to itags 599/600 - 31 kbps. The real
     * mitigation is the retry loop in `ytdlp.ts`, which reruns a fresh process
     * on a retriable failure. Set `YTDLP_PLAYER_CLIENTS=` empty to hand client
     * choice fully back to yt-dlp, or to a comma list to pin.
     */
    ytdlpPlayerClients: process.env['YTDLP_PLAYER_CLIENTS'] ?? 'default',
    maxTrackSeconds: parseInt(process.env['MAX_TRACK_SECONDS'] ?? '10800', 10),
    cacheChannel: optional('CACHE_CHANNEL'),
  },

  /**
   * Egress helper for the calls that answer differently by country.
   *
   * `url` covers JioSaavn search, whose results are geo-filtered. `mint` is
   * separate and off by default because it changes something visible: minting
   * a googlevideo URL through the tunnel binds the stream to the relay's IP,
   * which is right when the listeners are there and wrong when they are not.
   */
  relay: {
    url: optional('RELAY_URL'),
    secret: optional('RELAY_SECRET'),
    proxy: optional('RELAY_PROXY'),
    mint: (process.env['RELAY_MINT'] ?? 'false') === 'true',
  },

  ai: {
    mistralApiKey: optional('MISTRAL_API_KEY'),
    mistralApiKeys: (process.env['MISTRAL_API_KEYS'] ?? process.env['MISTRAL_API_KEY'] ?? '')
      .split(/[\s,]+/)
      .map((k) => k.trim())
      .filter(Boolean),
    model: process.env['MISTRAL_MODEL'] ?? 'mistral-small-latest',
  },
} as const

export const CACHE_TTL = {
  role: 300,
  prefix: 600,
  superusers: 600,
  logChat: 3600,
} as const
