import type { tl } from '@mtcute/node'
import type { AdminRight, ResolvedRole } from '../core/permissions.js'
import { Role } from '../core/permissions.js'

export const STANDARD_ADMIN_RIGHTS: AdminRight[] = [
  'changeInfo',
  'deleteMessages',
  'restrictMembers',
  'inviteUsers',
  'pinMessages',
  'manageTopics',
  'manageVideoChats',
]

export const SENIOR_ADMIN_RIGHTS: AdminRight[] = [
  ...STANDARD_ADMIN_RIGHTS,
  'promoteMembers',
]

export function toAdminRightsObject(
  rights: Iterable<AdminRight>,
): Omit<tl.RawChatAdminRights, '_'> {
  const set = new Set(rights)
  return {
    changeInfo:      set.has('changeInfo')      || undefined,
    postMessages:    set.has('postMessages')    || undefined,
    editMessages:    set.has('editMessages')    || undefined,
    deleteMessages:  set.has('deleteMessages')  || undefined,
    banUsers:        set.has('restrictMembers') || undefined,
    inviteUsers:     set.has('inviteUsers')     || undefined,
    pinMessages:     set.has('pinMessages')     || undefined,
    manageTopics:    set.has('manageTopics')    || undefined,
    addAdmins:       set.has('promoteMembers')  || undefined,
    manageCall:      set.has('manageVideoChats')|| undefined,
    anonymous:       set.has('anonymous')       || undefined,
  }
}

export function hasAllPermissionRights(perm: tl.RawChatAdminRights, required: AdminRight[]): boolean {
  return required.every((r) => {
    switch (r) {
      case 'changeInfo':       return !!perm.changeInfo
      case 'postMessages':     return !!perm.postMessages
      case 'editMessages':     return !!perm.editMessages
      case 'deleteMessages':   return !!perm.deleteMessages
      case 'restrictMembers':  return !!perm.banUsers
      case 'inviteUsers':      return !!perm.inviteUsers
      case 'pinMessages':      return !!perm.pinMessages
      case 'manageTopics':     return !!perm.manageTopics
      case 'promoteMembers':   return !!perm.addAdmins
      case 'manageVideoChats': return !!perm.manageCall
      case 'anonymous':        return !!perm.anonymous
    }
  })
}

export function permissionRightsToSet(perm: tl.RawChatAdminRights): Set<AdminRight> {
  const out = new Set<AdminRight>()
  if (perm.changeInfo)     out.add('changeInfo')
  if (perm.postMessages)   out.add('postMessages')
  if (perm.editMessages)   out.add('editMessages')
  if (perm.deleteMessages) out.add('deleteMessages')
  if (perm.banUsers)       out.add('restrictMembers')
  if (perm.inviteUsers)    out.add('inviteUsers')
  if (perm.pinMessages)    out.add('pinMessages')
  if (perm.manageTopics)   out.add('manageTopics')
  if (perm.addAdmins)      out.add('promoteMembers')
  if (perm.manageCall)     out.add('manageVideoChats')
  if (perm.anonymous)      out.add('anonymous')
  return out
}

export function promoterHasUnlimitedRights(role: ResolvedRole): boolean {
  if (role.mask & (Role.DEV | Role.SUPERUSER)) return true
  if (role.isOwner) return true
  return false
}

export function intersectGrantableRights(
  desired: AdminRight[],
  botRights: Set<AdminRight>,
  promoterRole: ResolvedRole,
): { granted: AdminRight[]; skippedBot: AdminRight[]; skippedPromoter: AdminRight[] } {
  const unlimited = promoterHasUnlimitedRights(promoterRole)
  const granted: AdminRight[] = []
  const skippedBot: AdminRight[] = []
  const skippedPromoter: AdminRight[] = []
  for (const r of desired) {
    const botOk = botRights.has(r)
    const promoterOk = unlimited || promoterRole.rights.has(r)
    if (!botOk) { skippedBot.push(r); continue }
    if (!promoterOk) { skippedPromoter.push(r); continue }
    granted.push(r)
  }
  return { granted, skippedBot, skippedPromoter }
}
