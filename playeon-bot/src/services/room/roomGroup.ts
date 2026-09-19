import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { tg } from '../../client.js'
import { config } from '../../config.js'
import { runMtprotoTransfer } from '../media/mtprotoGate.js'
import { collections } from '../mongo.js'
import { isPersonalRoom } from './roomLink.js'

const AVATAR_DIR = path.join(config.media.tmpDir, 'room-avatars')
const DEV_PLACEHOLDER_AVATAR = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=300&h=300&fit=crop&crop=face'

export type GroupInfo = {
  title: string | null
  avatarPath: string | null
  roomName: string | null
}

async function readRoomName(groupId: string): Promise<string | null> {
  try {
    const doc = await collections.roomAccess.findOne(
      { _id: groupId },
      { projection: { roomName: 1 } },
    )
    return doc?.roomName?.trim() || null
  } catch {
    return null
  }
}

export async function writeRoomName(groupId: string, name: string | null): Promise<void> {
  const now = new Date()
  if (name) {
    await collections.roomAccess.updateOne(
      { _id: groupId },
      { $set: { roomName: name, updatedAt: now } },
      { upsert: true },
    )
  } else {
    await collections.roomAccess.updateOne(
      { _id: groupId },
      { $unset: { roomName: '' }, $set: { updatedAt: now } },
    )
  }
}

/**
 * A participant's profile photo, downloaded once and cached on disk.
 *
 * The mini app can't get this from Telegram itself: `photo_url` is only part
 * of `initData` for apps opened from the attachment menu, and a room is opened
 * from a `t.me/<bot>/room?startapp=` link - so every avatar in the web UI would
 * otherwise fall back to initials. The bot has MTProto, so it can just fetch it.
 *
 * Cached both ways: a resolved path, and a null for users with no photo, so a
 * missing avatar doesn't re-hit Telegram on every request.
 */
const userAvatars = new Map<string, { path: string | null; at: number }>()
const userAvatarPending = new Map<string, Promise<string | null>>()
const USER_AVATAR_TTL_MS = 6 * 60 * 60_000

export function resolveUserAvatar(userId: string): Promise<string | null> {
  if (userId === '999999999') {
    userAvatars.delete(userId)
  }
  const cached = userAvatars.get(userId)
  if (cached && cached.path && Date.now() - cached.at < USER_AVATAR_TTL_MS) return Promise.resolve(cached.path)

  const inFlight = userAvatarPending.get(userId)
  if (inFlight) return inFlight

  const pending = (async () => {
    const id = Number(userId)
    if (!Number.isFinite(id)) return null

    // For test participant in dev mode, fetch internet placeholder avatar
    if (userId === '999999999' || id === 999999999) {
      await mkdir(AVATAR_DIR, { recursive: true })
      const file = path.join(AVATAR_DIR, `user-${id}.jpg`)
      try {
        const res = await fetch(DEV_PLACEHOLDER_AVATAR)
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer())
          await writeFile(file, buf)
          return file
        }
      } catch {}
      if (existsSync(file)) return file
      return null
    }

    try {
      const user = await tg.getUser(id)
      const small = user.photo?.small
      if (!small) return null
      await mkdir(AVATAR_DIR, { recursive: true })
      const file = path.join(AVATAR_DIR, `user-${id}.jpg`)
      await runMtprotoTransfer(() => tg.downloadToFile(file, small))
      return file
    } catch {
      return null
    }
  })()
    .then((resolved) => {
      userAvatars.set(userId, { path: resolved, at: Date.now() })
      return resolved
    })
    .finally(() => userAvatarPending.delete(userId))

  userAvatarPending.set(userId, pending)
  return pending
}

export async function resolveGroupInfo(groupId: string): Promise<GroupInfo> {
  const id = Number(groupId)
  if (!Number.isFinite(id)) return { title: null, avatarPath: null, roomName: null }

  if (isPersonalRoom(groupId)) {
    // A personal room *is* its owner, so it wears their picture - otherwise it
    // is the one room type with no avatar at all and falls back to an initial.
    // Name and photo both come off a single `getUser`.
    const custom = await readRoomName(groupId)
    let title: string | null = custom
    let avatarPath: string | null = null

    try {
      const user = await tg.getUser(id)
      if (!title) {
        const name = user.displayName || null
        title = name ? `${name}'s Room` : null
      }
      const small = user.photo?.small
      if (small) {
        await mkdir(AVATAR_DIR, { recursive: true })
        // no collision with the group file below: personal ids are positive
        const file = path.join(AVATAR_DIR, `${id}.jpg`)
        await runMtprotoTransfer(() => tg.downloadToFile(file, small))
        avatarPath = file
      }
    } catch {
      // unreachable user, or no photo - the room falls back to its initial
    }

    return { title, avatarPath, roomName: custom }
  }

  try {
    const chat = await tg.getChat(id)
    const title = chat.title || chat.displayName || null

    let avatarPath: string | null = null
    const small = chat.photo?.small
    if (small) {
      await mkdir(AVATAR_DIR, { recursive: true })
      const file = path.join(AVATAR_DIR, `${id}.jpg`)
      await runMtprotoTransfer(() => tg.downloadToFile(file, small))
      avatarPath = file
    }
    return { title, avatarPath, roomName: null }
  } catch {
    return { title: null, avatarPath: null, roomName: null }
  }
}
