import type { Message } from '@mtcute/node'
import type { TelegramClient } from '@mtcute/core/client.js'
import { filters } from '@mtcute/dispatcher'
import { dp } from '../client.js'
import { collections } from './mongo.js'
import { getAllLogChats } from './logChats.js'
import { config } from '../config.js'
import { errorMessage, isEmojiInvalid, isMediaForbidden } from '../lib/tgErrors.js'

export type BroadcastFlags = {
  groups: boolean
  users: boolean
  notag: boolean
}

export type BroadcastStats = {
  total: number
  sent: number
  failed: number
  skipped: number
  trimmed: number
  groups: number
  users: number
}

export type BroadcastState = {
  stats: BroadcastStats
  startedAt: number
  finishedAt: number | null
  aborted: boolean
  by: string
}

const SEND_INTERVAL_MS = 40
const MAX_FLOOD_WAIT_S = 60
const PROGRESS_INTERVAL_MS = 3000

let active: {
  state: BroadcastState
  abort: () => void
} | null = null

export function activeBroadcast(): BroadcastState | null {
  return active?.state ?? null
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function floodWaitSeconds(err: unknown): number | null {
  const m = /FLOOD_WAIT_(\d+)/.exec(errorMessage(err))
  return m ? parseInt(m[1]!, 10) : null
}

function isWriteForbidden(err: unknown): boolean {
  return /CHAT_WRITE_FORBIDDEN|USER_IS_BLOCKED|USER_IS_BOT|PEER_ID_INVALID|CHANNEL_PRIVATE|CHAT_RESTRICTED|USER_DEACTIVATED|INPUT_USER_DEACTIVATED|BOT_BLOCKED|CHAT_ADMIN_REQUIRED/i.test(
    errorMessage(err),
  )
}

const MEDIA_RIGHT: Record<string, 'canSendPhotos' | 'canSendVideos' | 'canSendAudios' | 'canSendVoices' | 'canSendFiles' | 'canSendStickers' | 'canSendGifs' | 'canSendMedia'> = {
  photo: 'canSendPhotos',
  video: 'canSendVideos',
  audio: 'canSendAudios',
  voice: 'canSendVoices',
  document: 'canSendFiles',
  sticker: 'canSendStickers',
  paid_media: 'canSendMedia',
  story: 'canSendMedia',
}

type Verdict = { send: false } | { send: true; trim: boolean }

async function verdictFor(tg: TelegramClient, chatId: number, mediaType: string | null): Promise<Verdict> {
  try {
    const chat = await tg.getChat(chatId)
    const p = chat.permissions
    if (!p) return { send: true, trim: false }
    if (!p.canSendMessages) return { send: false }
    if (!mediaType) return { send: true, trim: false }
    const right = MEDIA_RIGHT[mediaType] ?? 'canSendMedia'
    const allowed = (p as unknown as Record<string, boolean>)[right] ?? p.canSendMedia
    return { send: true, trim: !allowed }
  } catch {
    return { send: true, trim: false }
  }
}

async function deliver(
  tg: TelegramClient,
  chatId: number,
  post: Message,
  flags: BroadcastFlags,
  trim: boolean,
): Promise<'sent' | 'trimmed' | 'failed'> {
  const textOnly = async (): Promise<'trimmed' | 'failed'> => {
    const text = post.textWithEntities
    if (!text.text.trim()) return 'failed'
    try {
      await tg.sendText(chatId, text)
    } catch (err) {
      if (!isEmojiInvalid(err)) throw err
      await tg.sendText(chatId, text.text)
    }
    return 'trimmed'
  }

  if (trim) {
    try {
      return await textOnly()
    } catch {
      return 'failed'
    }
  }

  try {
    await tg.forwardMessages({
      toChatId: chatId,
      messages: [post],
      ...(flags.notag ? { noAuthor: true } : {}),
    })
    return 'sent'
  } catch (err) {
    if (isMediaForbidden(err)) {
      try {
        return await textOnly()
      } catch {
        return 'failed'
      }
    }
    throw err
  }
}

async function collectTargets(flags: BroadcastFlags): Promise<{ id: number; group: boolean }[]> {
  const excluded = new Set<number>()
  const logs = await getAllLogChats()
  for (const id of Object.values(logs)) if (id) excluded.add(id)
  if (config.logGroupId) excluded.add(config.logGroupId)

  const targets: { id: number; group: boolean }[] = []

  if (flags.groups) {
    const chats = await collections.chats.find({}, { projection: { _id: 1 } }).toArray()
    for (const c of chats) {
      const id = Number(c._id)
      if (!Number.isFinite(id) || excluded.has(id)) continue
      targets.push({ id, group: true })
    }
  }

  if (flags.users) {
    const users = await collections.users
      .find({ startedAt: { $exists: true } }, { projection: { _id: 1 } })
      .toArray()
    for (const u of users) {
      const id = Number(u._id)
      if (!Number.isFinite(id) || excluded.has(id)) continue
      targets.push({ id, group: false })
    }
  }

  return targets
}

export type BroadcastHandle = {
  state: BroadcastState
  done: Promise<BroadcastState>
}

export async function startBroadcast(input: {
  tg: TelegramClient
  post: Message
  flags: BroadcastFlags
  by: string
  onProgress: (state: BroadcastState) => void
}): Promise<BroadcastHandle | null> {
  if (active) return null

  const targets = await collectTargets(input.flags)
  const mediaType = input.post.media?.type ?? null

  const state: BroadcastState = {
    stats: {
      total: targets.length,
      sent: 0,
      failed: 0,
      skipped: 0,
      trimmed: 0,
      groups: targets.filter((t) => t.group).length,
      users: targets.filter((t) => !t.group).length,
    },
    startedAt: Date.now(),
    finishedAt: null,
    aborted: false,
    by: input.by,
  }

  let aborted = false
  active = { state, abort: () => { aborted = true; state.aborted = true } }

  const done = (async () => {
    let lastProgress = 0
    try {
      for (const target of targets) {
        if (aborted) break

        let verdict: Verdict = { send: true, trim: false }
        if (target.group) verdict = await verdictFor(input.tg, target.id, mediaType)

        if (!verdict.send) {
          state.stats.skipped += 1
        } else {
          try {
            const outcome = await deliver(input.tg, target.id, input.post, input.flags, verdict.trim)
            if (outcome === 'sent') state.stats.sent += 1
            else if (outcome === 'trimmed') { state.stats.sent += 1; state.stats.trimmed += 1 }
            else state.stats.failed += 1
          } catch (err) {
            const wait = floodWaitSeconds(err)
            if (wait !== null && wait <= MAX_FLOOD_WAIT_S) {
              await sleep((wait + 1) * 1000)
              if (aborted) break
              try {
                const outcome = await deliver(input.tg, target.id, input.post, input.flags, verdict.trim)
                if (outcome === 'sent') state.stats.sent += 1
                else if (outcome === 'trimmed') { state.stats.sent += 1; state.stats.trimmed += 1 }
                else state.stats.failed += 1
              } catch {
                state.stats.failed += 1
              }
            } else if (isWriteForbidden(err)) {
              state.stats.skipped += 1
            } else {
              state.stats.failed += 1
            }
          }
        }

        if (Date.now() - lastProgress >= PROGRESS_INTERVAL_MS) {
          lastProgress = Date.now()
          try { input.onProgress(state) } catch {}
        }

        await sleep(SEND_INTERVAL_MS)
      }
    } finally {
      state.finishedAt = Date.now()
      active = null
      try { input.onProgress(state) } catch {}
    }
    return state
  })()

  return { state, done }
}

export function abortBroadcast(): boolean {
  if (!active) return false
  active.abort()
  return true
}

export function registerBroadcastCallbacks(): void {
  dp.onCallbackQuery(filters.regex(/^bc:abort$/), async (cq) => {
    if (!config.devIds.includes(cq.user.id)) {
      await cq.answer({ text: 'Only developers can stop a broadcast.', alert: true })
      return
    }
    if (!abortBroadcast()) {
      await cq.answer({ text: 'No broadcast is running.', alert: true })
      return
    }
    await cq.answer({ text: 'Stopping…' })
  })
}
