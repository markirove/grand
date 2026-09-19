import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { once } from 'node:events'
import { WebSocketServer, type WebSocket } from 'ws'
import { config } from '../../config.js'
import { verifyRoomToken, type RoomTokenPayload } from './roomToken.js'
import { canControlRoom } from './roomControl.js'
import { resolveGroupInfo, resolveUserAvatar } from './roomGroup.js'
import { roomManager } from './RoomManager.js'
import { getDirectVideoUrl } from '../media/ytdlp.js'
import { CHAT_TEXT_MAX, ROOM_GESTURES, ROOM_REACTIONS } from './roomTypes.js'
import type { ClientMessage, RoomGestureKind, RoomParticipant, RoomPose } from './roomTypes.js'
import { ASSETS_DIR } from '../../lib/assets.js'

let server: Server | undefined
let wss: WebSocketServer | undefined
let heartbeat: ReturnType<typeof setInterval> | undefined

const alive = new WeakMap<WebSocket, boolean>()

const groupInfoResolved = new Set<string>()
const groupInfoPending = new Map<string, Promise<void>>()

/** How long `/preview` waits on a first-time group info resolve. */
const GROUP_INFO_WAIT_MS = 2500

/**
 * Resolve a room's title and avatar off Telegram, once.
 *
 * Returns the in-flight promise so a caller that cannot render without the
 * answer - the join screen preview - can wait for it, while everyone else
 * keeps firing it and forgetting. Concurrent callers share one resolve.
 */
function ensureGroupInfo(groupId: string): Promise<void> {
  if (roomManager.hasGroupInfo(groupId)) return Promise.resolve()
  /*
    A room can resolve to no title at all - an unreachable chat, a user with
    no display name - and retrying that on every request would hammer
    Telegram, so it is remembered. Only while the room is still around,
    though: `reboot` drops the room entirely, taking its title and avatar
    with it, and every visitor after that would otherwise find a nameless
    room forever.
  */
  if (groupInfoResolved.has(groupId) && roomManager.hasRoom(groupId)) return Promise.resolve()

  const inFlight = groupInfoPending.get(groupId)
  if (inFlight) return inFlight

  const pending = resolveGroupInfo(groupId)
    .then((info) => {
      /*
        Nothing at all came back - no title, no name, no avatar - which is
        what an id Telegram has never seen looks like. `setGroupInfo` goes
        through `getOrCreate`, so writing that here would conjure a room for
        it, and the room existing is the only thing anything downstream
        checks. A real chat always has a title, and a real personal room has
        an owner to name it, so refusing to record the empty answer is what
        keeps a made-up start param from materialising a room.
      */
      if (!info.title && !info.roomName && !info.avatarPath) return
      roomManager.setGroupInfo(groupId, info)
      groupInfoResolved.add(groupId)
    })
    .catch(() => {})
    .finally(() => groupInfoPending.delete(groupId))

  groupInfoPending.set(groupId, pending)
  return pending
}

function tokenFromUrl(reqUrl: string | undefined, host: string): RoomTokenPayload | null {
  try {
    const url = new URL(reqUrl ?? '', `http://${host}`)
    const token = url.searchParams.get('token')
    const requestedGroupId = url.searchParams.get('groupId') || url.searchParams.get('g') || undefined
    const res = verifyRoomToken(token, requestedGroupId)
    return res.ok ? res.payload : null
  } catch {
    return null
  }
}

const MEDIA_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
}

function mediaContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return MEDIA_TYPES[ext] ?? 'application/octet-stream'
}

function serveLogo(req: IncomingMessage, res: ServerResponse, name: string): void {
  const path = `${ASSETS_DIR}${name}.png`
  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(path)
  } catch {
    res.writeHead(404).end('not found')
    return
  }

  /*
    Cached, but never blindly.

    `immutable` was the obvious header here and the wrong one: the file is
    swappable by definition - it is a brand asset we may replace - and
    `immutable` tells every client and CDN in the path not to even ask, so a
    replacement stays invisible for the whole max-age. An mtime/size ETag costs
    one `stat` and makes a swap take effect on the next request.
  */
  const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(36)}"`
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': 'public, max-age=3600' }).end()
    return
  }

  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': stat.size,
    ETag: etag,
    'Cache-Control': 'public, max-age=3600',
  })
  createReadStream(path).on('error', () => res.destroy()).pipe(res)
}

function serveMedia(req: IncomingMessage, res: ServerResponse, groupId: string, mediaId: string): void {
  const payload = tokenFromUrl(req.url, req.headers.host ?? 'localhost')
  if (!payload || payload.room.groupId !== groupId) {
    res.writeHead(401).end('unauthorized')
    return
  }

  const path = roomManager.mediaPath(groupId, mediaId)
  if (!path) {
    res.writeHead(404).end('not found')
    return
  }

  let size: number
  try {
    size = statSync(path).size
  } catch {
    res.writeHead(404).end('not found')
    return
  }

  const contentType = mediaContentType(path)
  const range = req.headers.range

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0
      const end = match[2] ? parseInt(match[2], 10) : size - 1
      if (start > end || start >= size) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
        return
      }
      const clampedEnd = Math.min(end, size - 1)
      res.writeHead(206, {
        'Content-Type': contentType,
        'Content-Range': `bytes ${start}-${clampedEnd}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': clampedEnd - start + 1,
        'Cache-Control': 'no-store',
      })
      createReadStream(path, { start, end: clampedEnd }).on('error', () => res.destroy()).pipe(res)
      return
    }
  }

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  })
  createReadStream(path).on('error', () => res.destroy()).pipe(res)
}

/**
 * Headers worth carrying upstream.
 *
 * `range` is the whole point - the element asks for a window and gets exactly
 * that window, so a seek costs one request and nothing is ever held here.
 * `accept-encoding: identity` is set rather than forwarded: an encoded response
 * would arrive with a `content-length` describing the compressed bytes, and
 * mirroring that against a decoded body is how a player ends up truncating a
 * stream. Media is already compressed; there is nothing to gain.
 */
function upstreamHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = { 'accept-encoding': 'identity' }
  const range = req.headers.range
  if (typeof range === 'string') headers.range = range
  const agent = req.headers['user-agent']
  if (typeof agent === 'string') headers['user-agent'] = agent
  const accept = req.headers.accept
  if (typeof accept === 'string') headers.accept = accept
  return headers
}

/** Headers worth carrying back, all of which the player actually reads. */
const MIRRORED = ['content-type', 'content-length', 'content-range', 'accept-ranges']

/**
 * Stream one range of a CDN video through to the client.
 *
 * A pass-through and nothing more: no disk, no cache, no read-ahead. Whatever
 * the element asked for is asked of the CDN, and the bytes are handed on as
 * they arrive - so a viewer who pauses or leaves stops costing bandwidth in the
 * same instant, and a seek abandons the old request rather than finishing it.
 *
 * Back-pressure is explicit. Writing faster than the socket drains would buffer
 * a whole video in this process's memory, one viewer at a time, which is the
 * failure mode that turns a proxy into an outage.
 */
async function pipeVideo(
  req: IncomingMessage,
  res: ServerResponse,
  groupId: string,
  trackId: string,
  url: string,
  height: number | undefined,
  mayRemint: boolean,
): Promise<void> {
  const controller = new AbortController()
  // A seek cancels the request the element had open. Without this the socket to
  // the CDN stays up and keeps drawing bytes nobody will ever read.
  const abort = () => controller.abort()
  res.once('close', abort)

  let upstream: Response
  try {
    upstream = await fetch(url, { headers: upstreamHeaders(req), signal: controller.signal })
  } catch {
    res.off('close', abort)
    if (!res.headersSent) res.writeHead(502).end('upstream unreachable')
    return
  }

  // An expired mint, which is what a room left paused for a few hours looks
  // like. Worth exactly one retry: if the fresh URL fails too, the link is not
  // the problem.
  if ((upstream.status === 403 || upstream.status === 410) && mayRemint) {
    res.off('close', abort)
    void upstream.body?.cancel()
    const fresh = await roomManager.remintVideo(groupId, trackId, height)
    if (fresh) {
      await pipeVideo(req, res, groupId, trackId, fresh, height, false)
      return
    }
    if (!res.headersSent) res.writeHead(404).end('link expired')
    return
  }

  if (upstream.status !== 200 && upstream.status !== 206) {
    res.off('close', abort)
    void upstream.body?.cancel()
    if (!res.headersSent) res.writeHead(502).end('upstream refused')
    return
  }

  const headers: Record<string, string> = { 'Cache-Control': 'no-store' }
  for (const name of MIRRORED) {
    const value = upstream.headers.get(name)
    if (value) headers[name] = value
  }
  res.writeHead(upstream.status, headers)

  if (!upstream.body) {
    res.end()
    return
  }

  try {
    for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
      if (!res.write(chunk)) await once(res, 'drain')
    }
    res.end()
  } catch {
    // The client went away mid-stream, or the CDN cut us off. Either way the
    // response is unsalvageable and the socket is the only thing to clean up.
    res.destroy()
  } finally {
    res.off('close', abort)
  }
}

async function serveVideo(
  req: IncomingMessage,
  res: ServerResponse,
  groupId: string,
  trackId: string,
): Promise<void> {
  const host = req.headers.host ?? 'localhost'
  const payload = tokenFromUrl(req.url, host)
  if (!payload || payload.room.groupId !== groupId) {
    res.writeHead(401).end('unauthorized')
    return
  }

  const requested = Number(new URL(req.url ?? '', `http://${host}`).searchParams.get('h'))
  const height = Number.isFinite(requested) && requested > 0 ? Math.round(requested) : undefined

  const url = roomManager.videoUpstream(groupId, trackId, payload.user.id, height)
  if (!url) {
    res.writeHead(404).end('not found')
    return
  }

  await pipeVideo(req, res, groupId, trackId, url, height, true)
}

/**
 * A participant's profile photo. Resolved lazily on first request rather than
 * pushed into the snapshot: the browser asking for it is the only signal that
 * anyone needs it, and it keeps avatar fetches off the connect path.
 */
async function serveUserAvatar(
  req: IncomingMessage,
  res: ServerResponse,
  userId: string,
): Promise<void> {
  const payload = tokenFromUrl(req.url, req.headers.host ?? 'localhost')
  if (!payload) {
    res.writeHead(401).end('unauthorized')
    return
  }

  const file = await resolveUserAvatar(userId)
  if (!file) {
    res.writeHead(404).end('not found')
    return
  }

  let size: number
  try {
    size = statSync(file).size
  } catch {
    res.writeHead(404).end('not found')
    return
  }

  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': size,
    // profile photos change rarely; let the browser hold one for a while
    'Cache-Control': 'private, max-age=3600',
  })
  createReadStream(file).on('error', () => res.destroy()).pipe(res)
}

function serveAvatar(req: IncomingMessage, res: ServerResponse, groupId: string): void {
  const payload = tokenFromUrl(req.url, req.headers.host ?? 'localhost')
  if (!payload || payload.room.groupId !== groupId) {
    res.writeHead(401).end('unauthorized')
    return
  }
  const path = roomManager.avatarPath(groupId)
  if (!path) {
    res.writeHead(404).end('not found')
    return
  }
  let size: number
  try {
    size = statSync(path).size
  } catch {
    res.writeHead(404).end('not found')
    return
  }
  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': size,
    'Cache-Control': 'no-store',
  })
  createReadStream(path).on('error', () => res.destroy()).pipe(res)
}

/**
 * Room state for the mini-app's join screen, before the user commits to
 * joining. Gated by the same room token as everything else - the web mints one
 * only for a user who passed the access check, so holding a valid token for
 * this group is already proof of admission.
 */
async function servePreview(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const payload = tokenFromUrl(req.url, req.headers.host ?? 'localhost')
  if (!payload) {
    res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"unauthorized"}')
    return
  }

  const groupId = payload.room.groupId

  /*
    Waited on, not fired and forgotten. The mini-app asks for this once and
    renders whatever comes back for the whole visit, so answering before the
    title and avatar have been resolved left the join screen sitting on the
    "Room" fallback and an initial - the room looked nameless. The wait is
    bounded well under the caller's own 4s abort: a slow Telegram means the
    old behaviour, never a hung request.
  */
  await Promise.race([
    ensureGroupInfo(groupId),
    new Promise((resolve) => setTimeout(resolve, GROUP_INFO_WAIT_MS)),
  ])

  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(roomManager.preview(groupId) ?? { groupId, idle: true }))
}

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Range')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length')
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
    return
  }

  if (url.pathname === '/preview' && req.method === 'GET') {
    void servePreview(req, res)
    return
  }

  /*
    Source marks, served from here rather than linked from the source's own CDN.

    JioSaavn publishes its logo only under a build-hashed path that changes on
    every deploy of their site, so a direct link would quietly 404 into a broken
    avatar some week later. Unauthenticated on purpose: it is a static brand
    asset shown beside a track, in the same class as the room avatars above.
  */
  const logo = /^\/logo\/([a-z0-9-]+)\.png$/.exec(url.pathname)
  if (logo && req.method === 'GET') {
    serveLogo(req, res, logo[1]!)
    return
  }

  /*
    The CDN passthrough for the 3D lounge.

    Above `/media` in the table only for readability; the paths cannot collide.
    Errors are swallowed into a 500 the same way the avatar route does, since a
    throw here would otherwise take the whole HTTP server down with it.
  */
  const video = /^\/video\/([^/]+)\/([^/]+)$/.exec(url.pathname)
  if (video && req.method === 'GET') {
    void serveVideo(req, res, decodeURIComponent(video[1]!), decodeURIComponent(video[2]!)).catch(
      () => {
        if (!res.headersSent) res.writeHead(500).end('error')
      },
    )
    return
  }

  const media = /^\/media\/([^/]+)\/([^/]+)$/.exec(url.pathname)
  if (media && req.method === 'GET') {
    serveMedia(req, res, decodeURIComponent(media[1]!), decodeURIComponent(media[2]!))
    return
  }

  const userAvatar = /^\/avatar\/user\/([^/]+)$/.exec(url.pathname)
  if (userAvatar && req.method === 'GET') {
    void serveUserAvatar(req, res, decodeURIComponent(userAvatar[1]!)).catch(() => {
      if (!res.headersSent) res.writeHead(500).end('error')
    })
    return
  }

  const avatar = /^\/avatar\/([^/]+)$/.exec(url.pathname)
  if (avatar && req.method === 'GET') {
    serveAvatar(req, res, decodeURIComponent(avatar[1]!))
    return
  }

  res.writeHead(404).end('not found')
}

async function mintVideoUrl(sourceUrl: string, maxHeight: number): Promise<string> {
  const { url } = await mintVideoQuality(sourceUrl, maxHeight)
  return url
}

async function mintVideoQuality(
  sourceUrl: string,
  maxHeight: number,
): Promise<{ url: string; height: number | null }> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await getDirectVideoUrl(
        { url: sourceUrl } as Parameters<typeof getDirectVideoUrl>[0],
        maxHeight,
      )
    } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
    }
  }
  throw lastErr
}

/**
 * Make a pose safe to store and re-serialise, or reject it.
 *
 * The server has no model of the lounge, so this is not a plausibility check -
 * it is only making sure the numbers are numbers. `NaN` and `Infinity` are what
 * matter: both serialise to `null` in JSON, and a `null` where every receiving
 * client expects a coordinate is a crash in someone else's render loop rather
 * than a body in the wrong place. The bounds are absurdly wide on purpose; the
 * room is 14 m across and anything within a kilometre of it is merely wrong.
 */
function sanitisePose(raw: unknown): RoomPose | null {
  if (!raw || typeof raw !== 'object') return null
  const pose = raw as Record<string, unknown>
  const num = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1000 ? value : null

  const x = num(pose.x)
  const y = num(pose.y)
  const z = num(pose.z)
  const yaw = num(pose.yaw)
  if (x === null || y === null || z === null || yaw === null) return null

  const seat = num(pose.seat)
  return { x, y, z, yaw, seat: seat === null ? -1 : Math.trunc(seat) }
}

/**
 * Make a line of chat safe to broadcast, or reject it.
 *
 * Whitespace of every kind collapses to single spaces - newlines included. This
 * ends up on one line above somebody's head in the lounge, and a message that
 * can carry a newline can carry fifty of them and become a wall.
 *
 * Cut by code point rather than by `slice`, because the limit is mostly going to
 * be met by somebody sending emoji: slicing a UTF-16 string at 200 can land in
 * the middle of a surrogate pair, and half an emoji is a replacement glyph on
 * every screen in the room.
 */
function sanitiseChat(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // Control characters out before anything else: they survive a JSON round
  // trip and render as nothing, so a "message" made of them is an empty bubble.
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return null
  const points = [...text]
  return points.length > CHAT_TEXT_MAX ? points.slice(0, CHAT_TEXT_MAX).join('') : text
}

/** The one this client picked, or nothing. Never what it actually sent. */
function sanitiseReaction(raw: unknown): string | null {
  return ROOM_REACTIONS.find((emoji) => emoji === raw) ?? null
}

function sanitiseGesture(raw: unknown): RoomGestureKind | null {
  return ROOM_GESTURES.find((kind) => kind === raw) ?? null
}

async function onConnection(ws: WebSocket, payload: RoomTokenPayload): Promise<void> {
  const groupId = payload.room.groupId
  const canControl = canControlRoom(payload)

  const participant: RoomParticipant = {
    id: payload.user.id,
    name: payload.user.name,
    username: payload.user.username,
    photoUrl:
      payload.user.photoUrl ??
      `${config.room.publicUrl}/avatar/user/${encodeURIComponent(payload.user.id)}`,
    role: payload.user.role,
    canControl,
    online: true,
    present: true,
  }

  let preset: { videoUrl: string; videoUrlTrackId: string } | undefined
  const splitSource = roomManager.currentSplitSource(groupId)
  if (splitSource) {
    try {
      const url = await mintVideoUrl(splitSource.sourceUrl, splitSource.maxHeight)
      preset = { videoUrl: url, videoUrlTrackId: splitSource.trackId }
    } catch {
    }
  }

  const connId = roomManager.addConnection(groupId, ws, participant, preset)
  alive.set(ws, true)

  ensureGroupInfo(groupId)

  ws.send(JSON.stringify({ type: 'welcome', self: participant }))
  roomManager.sendSnapshotToConnection(groupId, connId)
  // After the snapshot, so the roster the log's names belong to is already
  // there when it lands.
  roomManager.sendChatLogToConnection(groupId, connId)

  const nowSource = roomManager.currentSplitSource(groupId)
  if (nowSource && preset?.videoUrlTrackId !== nowSource.trackId) {
    void roomManager.refreshParticipantVideo(groupId, connId)
  }

  ws.on('pong', () => alive.set(ws, true))

  ws.on('message', (data) => {
    let msg: ClientMessage
    try {
      msg = JSON.parse(data.toString())
    } catch {
      return
    }
    if (msg.type === 'ping') {
      alive.set(ws, true)
      return
    }
    if (msg.type === 'presence') {
      roomManager.setPresence(groupId, connId, !!msg.present)
      return
    }
    if (msg.type === 'pose') {
      roomManager.setPose(groupId, connId, sanitisePose(msg.pose))
      return
    }
    if (msg.type === 'anomaly') {
      roomManager.callAnomaly(groupId)
      return
    }
    if (msg.type === 'say') {
      const text = sanitiseChat(msg.text)
      if (text) roomManager.say(groupId, connId, 'text', text)
      return
    }
    if (msg.type === 'react') {
      // The emoji that comes back is this server's own copy of it, not the
      // client's - which is what makes the allow-list a boundary rather than a
      // suggestion.
      const emoji = sanitiseReaction(msg.emoji)
      if (emoji) roomManager.say(groupId, connId, 'emoji', emoji)
      return
    }
    if (msg.type === 'gesture') {
      const kind = sanitiseGesture(msg.kind)
      if (!kind) return
      if (typeof msg.targetId !== 'string' || !msg.targetId || msg.targetId.length > 64) return
      roomManager.gesture(groupId, connId, kind, msg.targetId)
      return
    }
    if (msg.type === 'lights') {
      // Not gated on `canControl`. Playback is the room's shared attention and
      // belongs to its admins; the lamps are its furniture and belong to whoever
      // is standing in it.
      roomManager.setLight(groupId, Number(msg.index), !!msg.on)
      return
    }
    if (msg.type === 'setRoomName') {
      const mayRename =
        groupId === payload.user.id || payload.user.role === 'superuser' || payload.user.role === 'developer'
      if (!mayRename) {
        ws.send(JSON.stringify({ type: 'error', message: 'Only the room owner can rename this room.' }))
        return
      }
      void roomManager.setRoomName(groupId, typeof msg.name === 'string' ? msg.name : '')
      return
    }
    if (msg.type !== 'control') return
    if (!canControl) {
      ws.send(JSON.stringify({ type: 'error', message: 'Only group admins can control playback.' }))
      return
    }
    switch (msg.action) {
      case 'play':
        roomManager.play(groupId, participant.name, participant.id)
        break
      case 'pause':
        roomManager.pause(groupId, participant.name, participant.id)
        break
      case 'seek':
        if (typeof msg.positionSec === 'number') roomManager.seek(groupId, msg.positionSec, participant.name, participant.id)
        break
      case 'skip':
        roomManager.skip(groupId, participant.name, participant.id, true)
        break
      case 'clear':
        void roomManager.clearQueue(groupId, participant.name, participant.id)
        break
      case 'end':
        void roomManager.end(groupId, participant.name, participant.id)
        break
    }
  })

  ws.on('close', () => roomManager.removeConnection(groupId, connId))
  ws.on('error', () => roomManager.removeConnection(groupId, connId))
}

export function startRoomServer(): Promise<void> {
  roomManager.setVideoUrlGenerator(mintVideoUrl)
  roomManager.setVideoQualityGenerator(mintVideoQuality)

  server = createServer(handleHttp)
  wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    if (url.pathname !== '/room') {
      socket.destroy()
      return
    }
    const payload = tokenFromUrl(req.url, req.headers.host ?? 'localhost')
    if (!payload) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss!.handleUpgrade(req, socket, head, (ws) => {
      void onConnection(ws, payload).catch(() => ws.close(1011, 'internal error'))
    })
  })

  heartbeat = setInterval(() => {
    for (const ws of wss!.clients) {
      if (alive.get(ws) === false) {
        ws.terminate()
        continue
      }
      alive.set(ws, false)
      try {
        ws.ping()
      } catch {
        ws.terminate()
      }
    }
  }, 30_000)
  heartbeat.unref?.()

  return new Promise((resolve) => {
    server!.listen(config.room.wsPort, () => {
      console.log(`[room] ws/http listening on :${config.room.wsPort}`)
      resolve()
    })
  })
}

export async function stopRoomServer(): Promise<void> {
  if (heartbeat) clearInterval(heartbeat)
  await roomManager.shutdown()
  await new Promise<void>((resolve) => {
    if (!wss) return resolve()
    wss.close(() => resolve())
  })
  await new Promise<void>((resolve) => {
    if (!server) return resolve()
    server.close(() => resolve())
  })
}
