import { md } from '@mtcute/markdown-parser'
import { tg } from '../../client.js'
import { collections, type Collections } from '../mongo.js'
import type { CommandContext } from '../../core/command.js'
import { hasChatAdminRights, resolveRoleByIds, type ResolvedRole } from '../../core/permissions.js'
import { WARNING_EMOJI } from '../../lib/feedback.js'
import { isPersonalRoom } from '../room/roomLink.js'
import { isAuthorized } from './authStore.js'
import { roomManager } from '../room/RoomManager.js'

export async function canControlPlayback(
  db: Collections,
  groupId: string | number,
  userId: string | number,
  role: ResolvedRole,
): Promise<boolean> {
  if (hasChatAdminRights(role, ['manageVideoChats']).ok) return true
  return isAuthorized(db, String(groupId), String(userId))
}

export async function canControlRoomId(roomId: string, userId: number): Promise<boolean> {
  if (isPersonalRoom(roomId)) {
    if (roomId === String(userId)) return true
    const doc = await collections.roomAccess.findOne(
      { _id: roomId },
      { projection: { controlPolicy: 1 } },
    )
    return (doc?.controlPolicy ?? 'owner') === 'anyone'
  }
  const chat = await tg.getChat(Number(roomId)).catch(() => null)
  if (!chat) return false
  const role = await resolveRoleByIds(userId, Number(roomId), chat)
  return canControlPlayback(collections, roomId, userId, role)
}

export async function canSkipTrack(roomId: string, userId: number): Promise<boolean> {
  const snap = roomManager.getSnapshot(roomId)
  if (snap?.current?.requestedById === String(userId)) return true
  return canControlRoomId(roomId, userId)
}

export function requirePlaybackControl() {
  return async (ctx: CommandContext): Promise<boolean> => {
    if (ctx.msg.chat.type === 'user') return true
    if (await canControlPlayback(ctx.db, ctx.msg.chat.id, ctx.msg.sender.id, ctx.role)) {
      return true
    }
    await ctx.msg.replyText(
      md`${WARNING_EMOJI} Only video-chat admins or authorized users can control playback. Ask an admin to \`/auth\` you.`,
    )
    return false
  }
}

export function requirePlaybackControlOrRequester() {
  return async (ctx: CommandContext): Promise<boolean> => {
    if (ctx.msg.chat.type === 'user') return true
    const groupId = String(ctx.msg.chat.id)
    const snap = roomManager.getSnapshot(groupId)
    if (snap?.current?.requestedById === String(ctx.msg.sender.id)) {
      return true
    }
    if (await canControlPlayback(ctx.db, ctx.msg.chat.id, ctx.msg.sender.id, ctx.role)) {
      return true
    }
    await ctx.msg.replyText(
      md`${WARNING_EMOJI} Only video-chat admins, authorized users, or the person who requested this track can skip it.`,
    )
    return false
  }
}
