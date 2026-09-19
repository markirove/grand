import { md } from '@mtcute/markdown-parser'
import { defineCommand, Role } from '../../core/command.js'
import { resolveTarget } from '../../lib/resolveTarget.js'
import { removeAuth, canManageAuthList } from '../../services/auth/authStore.js'
import { SUCCESS_EMOJI, WARNING_EMOJI } from '../../lib/feedback.js'

export default defineCommand({
  name: 'unauth',
  order: 21,
  description: "Revoke a user's playback-control authorization in this group.",
  usage: '/unauth <reply|id|@username>',
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

    const removed = await removeAuth(db, String(msg.chat.id), String(target.id))
    if (!removed) {
      await msg.answerText(md`${WARNING_EMOJI} **${target.displayName}** isn't on this group's auth list.`)
      return
    }
    await msg.answerText(md`${SUCCESS_EMOJI} Revoked **${target.displayName}**'s playback control here.`)
  },
})
