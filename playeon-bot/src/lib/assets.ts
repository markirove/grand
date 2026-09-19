import { statSync } from 'node:fs'
import { config } from '../config.js'

/** Static files we ship and serve ourselves, rather than hotlink. */
export const ASSETS_DIR = new URL('../../assets/', import.meta.url).pathname

/**
 * Public URL for a shipped logo, versioned by the file itself.
 *
 * The version is not decoration. These URLs end up inside room snapshots and
 * get cached by browsers and whatever CDN sits in front of the room host, so
 * replacing the file on disk is invisible to anyone holding a cached copy -
 * which is exactly what happened the first time this logo was swapped: the old
 * 32px favicon kept being served from cache long after a 512px one replaced it.
 *
 * Keying the query on size and mtime means a swap changes the URL, which
 * changes the cache key, so the new asset appears immediately and no cache
 * anywhere has to be purged by hand.
 */
export function logoUrl(name: string): string | null {
  const base = config.room.publicUrl?.replace(/\/+$/, '')
  if (!base) return null
  try {
    const stat = statSync(`${ASSETS_DIR}${name}.png`)
    const version = `${stat.size.toString(36)}${Math.round(stat.mtimeMs).toString(36)}`
    return `${base}/logo/${name}.png?v=${version}`
  } catch {
    return null
  }
}
