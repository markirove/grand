import { md } from '@mtcute/markdown-parser'
import { defineCommand, Role } from '../../core/command.js'
import { resolveTarget } from '../../lib/resolveTarget.js'
import { addAuth, canManageAuthList } from '../../services/auth/authStore.js'
import { SUCCESS_EMOJI, WARNING_EMOJI } from '../../lib/feedback.js'

export default defineCommand({
  name: 'auth',
  order: 20,
  description: 'Authorize a member to control room playback (pause/skip/seek) without making them a full admin.',
  summary: 'Let a member control playback without making them an admin.',
  usage: '/auth <reply|id|@username>',
  category: 'playback',

  contexts: ['supergroup', 'group'],
  reply: true,
  roles: [Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],
  permissions: {
    custom: async (ctx) => {
      if (canManageAuthList(ctx.role)) return true
      await ctx.msg.replyText(
        md`${WARNING_EMOJI} You need the **Manage Video Chats** or **Add Admins** right to manage the auth list.`,
      )
      return false
    },
  },

  handler: async (ctx) => {
    const { msg, db } = ctx
    const actor = msg.sender
    if (actor.type !== 'user') return

    const target = await resolveTarget(ctx)
    if (!target) {
      await msg.answerText(md`${WARNING_EMOJI} Couldn't find who you mean. Reply to their message, or pass an ID / @username.`)
      return
    }
    if (target.isBot) {
      await msg.answerText(md`${WARNING_EMOJI} You can't authorize a bot.`)
      return
    }

    const result = await addAuth(db, String(msg.chat.id), String(actor.id), {
      id: String(target.id),
      name: target.displayName,
      username: target.username ?? undefined,
    })

    if (result === 'already') {
      await msg.answerText(md`${SUCCESS_EMOJI} **${target.displayName}** is already authorized here.`)
      return
    }
    await msg.answerText(md`${SUCCESS_EMOJI} **${target.displayName}** can now control playback in this group.`)
  },
})
