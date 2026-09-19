import type { Collections } from '../mongo.js'
import type { GroupAuthDoc } from '../../models/groupAuth.js'
import { hasChatAdminRights, type ResolvedRole } from '../../core/permissions.js'

export function canManageAuthList(role: ResolvedRole): boolean {
  return (
    hasChatAdminRights(role, ['manageVideoChats']).ok ||
    hasChatAdminRights(role, ['promoteMembers']).ok
  )
}

function authId(groupId: string, userId: string): string {
  return `${groupId}:${userId}`
}

export type AddAuthResult = 'added' | 'already'

export async function addAuth(
  db: Collections,
  groupId: string,
  addedBy: string,
  user: { id: string; name?: string; username?: string },
): Promise<AddAuthResult> {
  const _id = authId(groupId, user.id)
  const res = await db.groupAuth.updateOne(
    { _id },
    {
      $setOnInsert: { _id, groupId, userId: user.id, addedBy, createdAt: new Date() },
      $set: { userName: user.name, userUsername: user.username },
    },
    { upsert: true },
  )
  return res.upsertedCount > 0 ? 'added' : 'already'
}

export async function removeAuth(
  db: Collections,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const res = await db.groupAuth.deleteOne({ _id: authId(groupId, userId) })
  return res.deletedCount > 0
}

export async function isAuthorized(
  db: Collections,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const hit = await db.groupAuth.findOne(
    { _id: authId(groupId, userId) },
    { projection: { _id: 1 } },
  )
  return hit !== null
}

export async function listAuth(db: Collections, groupId: string): Promise<GroupAuthDoc[]> {
  return db.groupAuth.find({ groupId }).sort({ createdAt: -1 }).toArray()
}
