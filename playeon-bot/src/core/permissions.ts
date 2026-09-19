import type { Message, Peer } from '@mtcute/node'
import { tg } from '../client.js'
import { config, CACHE_TTL } from '../config.js'
import { cache } from '../services/redis.js'
import { collections } from '../services/mongo.js'

export const Role = {
  USER:      1 << 0,
  ADMIN:     1 << 1,
  OWNER:     1 << 2,
  SUPERUSER: 1 << 3,
  DEV:       1 << 4,
} as const

export type RoleMask = number

export type AdminRight =
  | 'changeInfo'
  | 'postMessages'
  | 'editMessages'
  | 'deleteMessages'
  | 'restrictMembers'
  | 'inviteUsers'
  | 'pinMessages'
  | 'manageTopics'
  | 'promoteMembers'
  | 'manageVideoChats'
  | 'anonymous'

export type ResolvedRole = {
  mask: RoleMask
  rights: Set<AdminRight>
  isOwner: boolean
}

const NO_RIGHTS: ResolvedRole = { mask: Role.USER, rights: new Set(), isOwner: false }

export function isDev(userId: number): boolean {
  return config.devIds.includes(userId)
}

async function isSuperuser(userId: number): Promise<boolean> {
  const list = await cache.getOrSet<string[]>(
    'superusers:all',
    CACHE_TTL.superusers,
    async () => {
      const docs = await collections.superusers
        .find({}, { projection: { _id: 1 } })
        .toArray()
      return docs.map(d => d._id)
    },
  )
  return list.includes(String(userId))
}

export function invalidateSuperusers() {
  return cache.del('superusers:all')
}

export function invalidateRoleCache(chatId: number, userId: number) {
  return cache.del(`role:${chatId}:${userId}`)
}

function isChatLike(peer: Peer): boolean {
  return peer.type === 'chat'
}

export async function resolveRoleByIds(
  userId: number,
  chatId: number,
  chatPeer: Peer,
): Promise<ResolvedRole> {
  if (isDev(userId)) return { mask: Role.DEV, rights: new Set(), isOwner: false }
  if (await isSuperuser(userId)) return { mask: Role.SUPERUSER, rights: new Set(), isOwner: false }
  if (!isChatLike(chatPeer)) return NO_RIGHTS

  const cacheKey = `role:${chatId}:${userId}`
  const cached = await cache.get<{ mask: number; rights: AdminRight[]; isOwner: boolean }>(cacheKey)
  if (cached) return { mask: cached.mask, rights: new Set(cached.rights), isOwner: cached.isOwner }

  let resolved: ResolvedRole = NO_RIGHTS
  try {
    const member = await tg.getChatMember({ chatId, userId })
    if (!member) {
      resolved = NO_RIGHTS
    } else if (member.status === 'creator') {
      resolved = { mask: Role.OWNER, rights: new Set(), isOwner: true }
    } else if (member.status === 'admin') {
      const rights = new Set<AdminRight>()
      const p = member.permissions
      if (p) {
        if (p.changeInfo)     rights.add('changeInfo')
        if (p.postMessages)   rights.add('postMessages')
        if (p.editMessages)   rights.add('editMessages')
        if (p.deleteMessages) rights.add('deleteMessages')
        if (p.banUsers)       rights.add('restrictMembers')
        if (p.inviteUsers)    rights.add('inviteUsers')
        if (p.pinMessages)    rights.add('pinMessages')
        if (p.manageTopics)   rights.add('manageTopics')
        if (p.addAdmins)      rights.add('promoteMembers')
        if (p.manageCall)     rights.add('manageVideoChats')
        if (p.anonymous)      rights.add('anonymous')
      }
      resolved = { mask: Role.ADMIN, rights, isOwner: false }
    }
  } catch {
    resolved = NO_RIGHTS
  }

  await cache.set(cacheKey, {
    mask: resolved.mask,
    rights: [...resolved.rights],
    isOwner: resolved.isOwner,
  }, CACHE_TTL.role)
  return resolved
}

export async function resolveRole(msg: Message): Promise<ResolvedRole> {
  const sender = msg.sender
  const userId = sender.id
  if (!userId) return NO_RIGHTS
  return resolveRoleByIds(userId, msg.chat.id, msg.chat)
}

export function hasRole(resolved: ResolvedRole, allowed: RoleMask[]): boolean {
  const implied = impliedMask(resolved.mask)
  return allowed.some(r => (implied & r) !== 0)
}

function impliedMask(mask: RoleMask): RoleMask {
  let out = mask
  if (mask & Role.DEV)       out |= Role.SUPERUSER | Role.OWNER | Role.ADMIN | Role.USER
  if (mask & Role.SUPERUSER) out |= Role.OWNER | Role.ADMIN | Role.USER
  if (mask & Role.OWNER)     out |= Role.ADMIN | Role.USER
  if (mask & Role.ADMIN)     out |= Role.USER
  return out
}

export function hasAllRights(resolved: ResolvedRole, required: AdminRight[]): boolean {
  if (resolved.mask & (Role.DEV | Role.SUPERUSER)) return true
  if (resolved.isOwner) return true
  return required.every(r => resolved.rights.has(r))
}

export const ADMIN_RIGHT_LABEL: Record<AdminRight, string> = {
  changeInfo:      'Change Group Info',
  postMessages:    'Post Messages',
  editMessages:    'Edit Messages',
  deleteMessages:  'Delete Messages',
  restrictMembers: 'Ban Users',
  inviteUsers:     'Invite Users',
  pinMessages:     'Pin Messages',
  manageTopics:    'Manage Topics',
  promoteMembers:  'Add Admins',
  manageVideoChats:'Manage Video Chats',
  anonymous:       'Remain Anonymous',
}

export function hasChatAdminRights(
  resolved: ResolvedRole,
  required: AdminRight[],
): { ok: true } | { ok: false; missing: AdminRight[] } {
  if (resolved.mask & (Role.DEV | Role.SUPERUSER)) return { ok: true }
  if (resolved.isOwner) return { ok: true }
  const missing = required.filter(r => !resolved.rights.has(r))
  return missing.length === 0 ? { ok: true } : { ok: false, missing }
}
