import { config } from '../../config.js'

export interface KeyState {
  key: string
  masked: string
  disabledUntil: number
  consecutiveErrors: number
  totalRequests: number
  /** Timestamps of requests in the last 60 seconds */
  slidingWindow: number[]
}

class AiKeyManager {
  private keys: KeyState[] = []
  private currentIndex = 0
  private readonly WINDOW_MS = 60_000

  constructor() {
    this.reloadKeys(config.ai.mistralApiKeys)
  }

  public reloadKeys(newKeys: string[]): void {
    const valid = newKeys.map((k) => k.trim()).filter((k) => k.length > 10)
    const existingMap = new Map(this.keys.map((k) => [k.key, k]))

    this.keys = valid.map((key) => {
      if (existingMap.has(key)) {
        return existingMap.get(key)!
      }
      return {
        key,
        masked: this.mask(key),
        disabledUntil: 0,
        consecutiveErrors: 0,
        totalRequests: 0,
        slidingWindow: [],
      }
    })

    if (this.keys.length > 0) {
      this.currentIndex = this.currentIndex % this.keys.length
      console.log(`[aiKeyManager] Initialized with ${this.keys.length} API key(s) in rotation pool.`)
    } else {
      console.warn('[aiKeyManager] No Mistral API keys configured!')
    }
  }

  public addKey(key: string): void {
    const trimmed = key.trim()
    if (!trimmed || trimmed.length < 10) return
    if (this.keys.some((k) => k.key === trimmed)) return

    this.keys.push({
      key: trimmed,
      masked: this.mask(trimmed),
      disabledUntil: 0,
      consecutiveErrors: 0,
      totalRequests: 0,
      slidingWindow: [],
    })
    console.log(`[aiKeyManager] Added new API key: ${this.mask(trimmed)} (Pool size: ${this.keys.length})`)
  }

  public getKeyCount(): number {
    return this.keys.length
  }

  public getStatus() {
    const now = Date.now()
    return this.keys.map((k, i) => {
      const activeWindow = k.slidingWindow.filter((t) => now - t < this.WINDOW_MS).length
      return {
        index: i + 1,
        key: k.masked,
        healthy: now >= k.disabledUntil,
        cooldownRemainingSec: Math.max(0, Math.round((k.disabledUntil - now) / 1000)),
        requestsLastMinute: activeWindow,
        totalRequests: k.totalRequests,
        consecutiveErrors: k.consecutiveErrors,
      }
    })
  }

  /**
   * Selects the best available key using a combination of health checks,
   * sliding-window RPM load balancing, and round-robin.
   */
  public selectKey(): KeyState {
    if (this.keys.length === 0) {
      throw new Error('No Mistral API keys available in rotation pool.')
    }

    const now = Date.now()

    // Clean sliding windows
    for (const k of this.keys) {
      k.slidingWindow = k.slidingWindow.filter((t) => now - t < this.WINDOW_MS)
    }

    // Filter healthy keys
    const healthy = this.keys.filter((k) => now >= k.disabledUntil)

    if (healthy.length > 0) {
      // Pick key with lowest request count in sliding window, breaking ties with round-robin
      let best = healthy[0]!
      for (const candidate of healthy) {
        if (candidate.slidingWindow.length < best.slidingWindow.length) {
          best = candidate
        }
      }
      return best
    }

    // All keys in cooldown: pick the one that expires soonest
    let earliest = this.keys[0]!
    for (const candidate of this.keys) {
      if (candidate.disabledUntil < earliest.disabledUntil) {
        earliest = candidate
      }
    }
    return earliest
  }

  /**
   * Reports success for a key.
   */
  public reportSuccess(keyState: KeyState): void {
    const now = Date.now()
    keyState.consecutiveErrors = 0
    keyState.totalRequests++
    keyState.slidingWindow.push(now)
  }

  /**
   * Reports an error on a key and applies a cooldown depending on the status code.
   */
  public reportError(keyState: KeyState, status: number, retryAfterSec?: number): void {
    const now = Date.now()
    keyState.consecutiveErrors++

    let cooldownMs = 5_000

    if (status === 401 || status === 403) {
      // Invalid or revoked key: disable for 1 hour
      cooldownMs = 3600_000
    } else if (retryAfterSec && retryAfterSec > 0) {
      cooldownMs = retryAfterSec * 1000
    } else if (status === 429) {
      // Rate limited: cooldown for 45s to 90s based on consecutive errors
      cooldownMs = Math.min(45_000 * keyState.consecutiveErrors, 120_000)
    } else if (status === 503) {
      // High load: cooldown for 15s
      cooldownMs = 15_000
    } else if (status >= 500) {
      cooldownMs = 10_000
    }

    keyState.disabledUntil = now + cooldownMs
    console.warn(
      `[aiKeyManager] Key ${keyState.masked} marked cooldown for ${Math.round(
        cooldownMs / 1000,
      )}s (HTTP ${status}, errors: ${keyState.consecutiveErrors}).`,
    )
  }

  private mask(key: string): string {
    if (key.length <= 8) return '****'
    return `${key.slice(0, 4)}...${key.slice(-4)}`
  }
}

export const aiKeyManager = new AiKeyManager()

/**
 * Execute an API operation with automatic key rotation and retry.
 */
export async function withRotatedKey<T>(
  action: (apiKey: string, keyState: KeyState) => Promise<T>,
  maxAttempts = Math.max(aiKeyManager.getKeyCount(), 4),
): Promise<T> {
  let attempt = 0
  let lastError: unknown

  while (attempt < maxAttempts) {
    attempt++
    const keyState = aiKeyManager.selectKey()
    const now = Date.now()

    // If key is still in cooldown (all keys in cooldown), wait brief moment
    if (now < keyState.disabledUntil) {
      const waitMs = Math.min(keyState.disabledUntil - now, 2500)
      console.warn(`[aiKeyManager] All keys in cooldown. Backing off ${waitMs}ms before attempt ${attempt}...`)
      await new Promise((r) => setTimeout(r, waitMs))
    }

    try {
      const result = await action(keyState.key, keyState)
      aiKeyManager.reportSuccess(keyState)
      return result
    } catch (err: any) {
      lastError = err
      const status = err?.status ?? err?.raw_status_code ?? 0
      const retryAfter = err?.retryAfter ?? undefined

      if (
        status === 429 ||
        status === 503 ||
        status === 401 ||
        status === 403 ||
        status >= 500 ||
        err?.name === 'AbortError' ||
        err?.code === 'ECONNRESET'
      ) {
        aiKeyManager.reportError(keyState, status || 503, retryAfter)
        console.warn(
          `[aiKeyManager] Rotating to next key (attempt ${attempt}/${maxAttempts}) after failure on ${keyState.masked}`,
        )
        continue
      }

      // If it's a 400 Bad Request or non-transient error, don't spin keys needlessly
      throw err
    }
  }

  throw lastError ?? new Error('All AI API keys failed after rotation.')
}
