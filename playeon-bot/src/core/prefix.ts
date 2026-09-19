import { collections } from '../services/mongo.js'
import { cache } from '../services/redis.js'
import { config, CACHE_TTL } from '../config.js'

function prefixKey(chatId: number) {
  return `prefix:${chatId}`
}

export async function getPrefix(chatId: number): Promise<string> {
  const key = prefixKey(chatId)
  const cached = await cache.get<string>(key)
  if (cached !== null) return cached

  const doc = await collections.chats.findOne(
    { _id: String(chatId) },
    { projection: { prefix: 1 } },
  )
  const prefix = doc?.prefix ?? config.defaultPrefix
  await cache.set(key, prefix, CACHE_TTL.prefix)
  return prefix
}

export async function setPrefix(chatId: number, prefix: string): Promise<void> {
  await collections.chats.updateOne(
    { _id: String(chatId) },
    { $set: { prefix } },
    { upsert: false },
  )
  await cache.set(prefixKey(chatId), prefix, CACHE_TTL.prefix)
}
