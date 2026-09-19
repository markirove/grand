import { md } from '@mtcute/markdown-parser'
import type { TextWithEntities } from '@mtcute/core'
import { defineCommand, Role } from '../../core/command.js'
import { listAuth, canManageAuthList } from '../../services/auth/authStore.js'
import { INFO_EMOJI, WARNING_EMOJI } from '../../lib/feedback.js'

function authLine(name: string, id: string, username?: string): TextWithEntities {
  const label = md`[${name}](tg://user?id=${id})`
  return username ? md`• ${label} - @${username}` : md`• ${label}`
}

export default defineCommand({
  name: 'authusers',
  order: 22,
  aliases: ['authlist'],
  description: 'List everyone authorized to control playback in this group.',
  usage: '/authusers',
  category: 'playback',

  contexts: ['supergroup', 'group'],
  reply: true,
  roles: [Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],
  permissions: {
    custom: async (ctx) => {
      if (canManageAuthList(ctx.role)) return true
      await ctx.msg.replyText(
        md`${WARNING_EMOJI} You need the **Manage Video Chats** or **Add Admins** right to view the auth list.`,
      )
      return false
    },
  },

  handler: async (ctx) => {
    const { msg, db } = ctx

    const users = await listAuth(db, String(msg.chat.id))
    if (users.length === 0) {
      await msg.answerText(md`${INFO_EMOJI} No one is authorized here yet. Grant control with \`/auth\` (reply to them, or pass an @username / id).`)
      return
    }

    const lines = users.map((u) => authLine(u.userName ?? u.userId, u.userId, u.userUsername))
    const body = lines.reduce((acc, l) => md`${acc}\n${l}`)
    const header = md`**Authorized here** (${String(users.length)})`
    await msg.answerText(md`${header}\n${body}`)
  },
})
