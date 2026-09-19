/**
 * Global concurrency gate for MTProto file transfers.
 *
 * mtcute's per-pool socket cap (`network.connectionCount` in client.ts) bounds
 * how many sockets a healthy pool holds, but it does *not* bound reconnect
 * churn: when Telegram flood-limits this IP toward DC 5, a socket's receive loop
 * returns and the connection is rebuilt fresh, while the old FD - never FIN'd by
 * the server on a silent drop - lingers in ESTAB until TCP keepalive reaps it
 * (~2h). A burst of parallel downloads/uploads/avatar fetches is enough
 * simultaneous handshakes to trip that limit, and from there it snowballs into
 * hundreds of leaked sockets and a wedged main connection (see
 * playeon-bot-mtproto-429).
 *
 * Every transfer to Telegram goes through here. Holding only a couple in flight
 * keeps us under the per-IP flood limit so the churn never starts. `run` always
 * releases its slot in a `finally`, so a throwing transfer can't leak a permit.
 *
 * Note: home DC, upload DC and the media-cache channel's DC are all DC 5 here,
 * so there is no cross-DC fan-out to eliminate - one gate covers everything.
 */

const MAX_CONCURRENT = 2

let active = 0
const queue: Array<() => void> = []

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    queue.push(() => {
      active++
      resolve()
    })
  })
}

function release(): void {
  active--
  const next = queue.shift()
  if (next) next()
}

/** Run an MTProto file transfer under the global gate; the slot is always freed. */
export async function runMtprotoTransfer<T>(fn: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}
