import type { TelegramClient } from '@mtcute/core/client.js'
import type { User } from '@mtcute/node'
import type { CommandContext } from '../core/command.js'
import type { AdminRight, ResolvedRole } from '../core/permissions.js'
import { resolveRoleByIds, Role } from '../core/permissions.js'

const RIGHTS_MAP: Record<AdminRight, string> = {
  changeInfo: 'changeInfo',
  postMessages: 'postMessages',
  editMessages: 'editMessages',
  deleteMessages: 'deleteMessages',
  restrictMembers: 'banUsers',
  inviteUsers: 'inviteUsers',
  pinMessages: 'pinMessages',
  manageTopics: 'manageTopics',
  promoteMembers: 'addAdmins',
  manageVideoChats: 'manageCall',
  anonymous: 'anonymous',
}

export const TARGET_IS_ADMIN_REASON = "I can't do that while they're an admin."

export async function botHasRights(
  tg: TelegramClient,
  chatId: number,
  rights: AdminRight[],
): Promise<{ ok: boolean; missing: AdminRight[] }> {
  try {
    const me = await tg.getMe()
    const member = await tg.getChatMember({ chatId, userId: me.id })
    if (!member) return { ok: false, missing: rights }
    if (member.status === 'creator') return { ok: true, missing: [] }
    if (member.status !== 'admin') return { ok: false, missing: rights }
    const p = member.permissions as unknown as Record<string, boolean | undefined> | null
    if (!p) return { ok: false, missing: rights }
    const missing = rights.filter(r => !p[RIGHTS_MAP[r]])
    return { ok: missing.length === 0, missing }
  } catch {
    return { ok: false, missing: rights }
  }
}

export type TargetCheck =
  | { ok: true }
  | { ok: false; reason: string }

export async function canActOnTarget(
  ctx: CommandContext,
  target: User,
): Promise<TargetCheck> {
  const { msg, tg, role } = ctx
  const me = await tg.getMe()
  if (target.id === me.id) return { ok: false, reason: "Nice try, but I'm not doing that to myself." }
  if (target.id === msg.sender.id) return { ok: false, reason: "Let's not do that to yourself." }

  const targetRole = await resolveRoleByIds(target.id, msg.chat.id, msg.chat)

  if (targetRole.mask & Role.DEV) return { ok: false, reason: "I can't do that - they're one of my developers." }
  if (targetRole.mask & Role.SUPERUSER) return { ok: false, reason: "I can't do that - they're one of my superusers." }
  if (targetRole.isOwner) return { ok: false, reason: "I can't do that - they're the group owner." }

  if (targetRole.mask & Role.ADMIN) {
    if (!(role.mask & (Role.DEV | Role.SUPERUSER))) {
      return { ok: false, reason: TARGET_IS_ADMIN_REASON }
    }
  }
  return { ok: true }
}
