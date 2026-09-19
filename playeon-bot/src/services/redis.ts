import Redis from 'ioredis'
import { config } from '../config.js'

export const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  enableAutoPipelining: true,
})

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    const raw = await redis.get(key)
    if (raw === null) return null
    try { return JSON.parse(raw) as T } catch { return raw as unknown as T }
  },

  async set(key: string, value: unknown, ttl?: number) {
    const raw = typeof value === 'string' ? value : JSON.stringify(value)
    if (ttl) await redis.set(key, raw, 'EX', ttl)
    else await redis.set(key, raw)
  },

  async del(...keys: string[]) {
    if (keys.length) await redis.del(...keys)
  },

  async getOrSet<T>(key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key)
    if (cached !== null) return cached
    const fresh = await fetcher()
    await this.set(key, fresh, ttl)
    return fresh
  },

  async firstTime(key: string, ttl: number): Promise<boolean> {
    const result = await redis.set(key, '1', 'EX', ttl, 'NX')
    return result === 'OK'
  },
}

export type CacheService = typeof cache

export async function initRedis() {
  await redis.connect()
  console.log('[redis] connected')
}

export async function closeRedis() {
  redis.disconnect()
}
