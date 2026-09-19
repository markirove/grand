import { TelegramClient } from '@mtcute/node'
import { Dispatcher } from '@mtcute/dispatcher'
import { config } from './config.js'

/**
 * Back off when a DC is refusing the connection.
 *
 * This barely fires in practice, and that is the point of the comment. `@fuman/net`'s
 * `PersistentConnection` only consults the reconnection strategy when the
 * *connect call itself throws* - a TCP-level failure. When DC 5 flood-limits
 * this IP the TCP connect succeeds, the MTProto handshake is then answered with
 * `429` (or silently dropped), the receive loop returns, and the connection
 * loop simply `break`s and is restarted fresh by mtcute with a zeroed state.
 * So `consequentFails` never climbs and this function never sees the storm.
 *
 * The lever that actually paces reconnects in that case is the per-socket
 * flood controller below (`network.floodControl`) - see the note there. This
 * strategy is kept only for genuine connect failures, where a short escalating
 * wait with jitter is the right call.
 */
function makeReconnectionStrategy(): (state: { consequentFails: number }) => number {
  const WINDOW_MS = 90_000
  const recent: number[] = []
  return (state) => {
    const now = Date.now()
    while (recent.length && now - recent[0]! > WINDOW_MS) recent.shift()
    recent.push(now)

    const n = Math.max(state.consequentFails, recent.length)
    if (n <= 1) return 0
    if (n <= 3) return (n - 1) * 1000 // 1s, 2s
    const backoff = Math.min(120_000, 5_000 * 2 ** (n - 4)) // 5s, 10s, 20s, 40s, 80s … cap 120s
    return backoff + Math.random() * 2_000 // de-sync retries
  }
}

/**
 * Cap the media connection pools that sit on top of the single main socket.
 *
 * mtcute's default for a non-premium bot on a DC other than 2/4 (ours is 5) is
 * up to 8 parallel upload sockets. Under a burst of `/play` traffic that is 8+
 * fresh handshakes to one DC at once - which is what trips Telegram's per-IP
 * connection-flood limit and gets the whole IP answered with transport `429`.
 *
 * These are the *pool ceilings*; actual transfer concurrency is held lower still
 * by the app-level gate in `services/media/mtprotoGate.ts`, which every download
 * / upload / getMessages goes through. Home DC, upload DC and the media-cache
 * channel all live on DC 5, so a single pool per kind covers all traffic.
 */
function connectionCount(kind: 'main' | 'upload' | 'download' | 'downloadSmall'): number {
  switch (kind) {
    case 'main': return 0 // 0 = let mtcute manage the main socket itself
    case 'upload': return 1
    case 'download': return 2 // 2 = parallel chunks for a single file; the gate caps files in flight
    case 'downloadSmall': return 1
    default: return 1
  }
}

export const tg = new TelegramClient({
  apiId: config.apiId,
  apiHash: config.apiHash,
  storage: config.sessionName,
  reconnectionStrategy: makeReconnectionStrategy(),
  network: {
    connectionCount,
    /**
     * Per-socket connect throttle - the only thing that actually paces
     * reconnects when DC 5 is flood-limiting this IP (see the reconnection
     * strategy note above for why the strategy itself doesn't).
     *
     * `sanity` is applied to *every* connect attempt unconditionally, so it
     * also covers the cycles that drop silently (ping/read timeout, no `429`
     * frame) which `mtprotoError` never counts. The default (5 per 10s) still
     * permits a fast loop; this holds a socket to ~1 attempt / 7s after two
     * tries and ~1 / 20s once they keep failing - slow enough to let Telegram's
     * IP throttle decay, fast enough to recover promptly once it lifts. In the
     * healthy case the main socket connects once and never reconnects, so this
     * is inert.
     *
     * `mtprotoError` ticks only on an explicit transport `429`; keep it as a
     * second, steeper ladder for when the DC is returning those.
     */
    floodControl: {
      sanity: [
        { count: 2, windowMs: 15_000 },
        { count: 4, windowMs: 90_000 },
      ],
      mtprotoError: [
        { count: 1, windowMs: 5_000 },
        { count: 3, windowMs: 30_000 },
        { count: 6, windowMs: 180_000 },
      ],
    },
  },
})

export const dp = Dispatcher.for(tg)

export let botInfo = { id: 0, username: '', displayName: '' }

export function setBotInfo(info: typeof botInfo) {
  botInfo = info
}
