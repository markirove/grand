import { collections } from './mongo.js'
import { cache } from './redis.js'
import { config, CACHE_TTL } from '../config.js'

export const LOG_KINDS = ['core', 'plays', 'error'] as const
export type LogKind = typeof LOG_KINDS[number]

export const LOG_KIND_LABEL: Record<LogKind, string> = {
  core: 'Core',
  plays: 'Plays',
  error: 'Error',
}

function key(kind: LogKind): string {
  return `settings:logchat:${kind}`
}

function legacyDefault(kind: LogKind): number | null {
  return kind === 'core' ? config.logGroupId : null
}

export async function getLogChatId(kind: LogKind): Promise<number | null> {
  const cached = await cache.get<{ id: number | null }>(key(kind))
  if (cached) return cached.id

  const doc = await collections.settings.findOne({ _id: 'global' }, { projection: { logChats: 1 } })
  const id = doc?.logChats?.[kind] ?? legacyDefault(kind)
  await cache.set(key(kind), { id }, CACHE_TTL.logChat)
  return id
}

export async function getAllLogChats(): Promise<Record<LogKind, number | null>> {
  const entries = await Promise.all(LOG_KINDS.map(async (kind) => [kind, await getLogChatId(kind)] as const))
  return Object.fromEntries(entries) as Record<LogKind, number | null>
}

export async function setLogChat(kind: LogKind, chatId: number): Promise<void> {
  await collections.settings.updateOne(
    { _id: 'global' },
    { $set: { [`logChats.${kind}`]: chatId } },
    { upsert: true },
  )
  await cache.set(key(kind), { id: chatId }, CACHE_TTL.logChat)
}

export async function clearLogChat(kind: LogKind): Promise<void> {
  await collections.settings.updateOne(
    { _id: 'global' },
    { $unset: { [`logChats.${kind}`]: '' } },
    { upsert: true },
  )
  await cache.set(key(kind), { id: null }, CACHE_TTL.logChat)
}
