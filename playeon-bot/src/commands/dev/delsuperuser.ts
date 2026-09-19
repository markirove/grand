import { md } from '@mtcute/markdown-parser'
import { defineCommand, Role } from '../../core/command.js'
import { resolveTarget } from '../../lib/resolveTarget.js'
import { invalidateSuperusers } from '../../core/permissions.js'
import { SUCCESS_EMOJI } from '../../lib/feedback.js'

export default defineCommand({
  name: 'delsuperuser',
  order: 22,
  aliases: ['delsu', 'removesuperuser', 'removesu'],
  emoji: '👤',
  emojiId: '5893192487324880883',
  description: 'Remove superuser status from a user.',
  usage: '/delsuperuser <reply|id|@username>',
  category: 'dev',
  contexts: 'any',

  reply: true,
  roles: [Role.DEV],

  handler: async (ctx) => {
    const { msg, db, logger } = ctx
    const actor = msg.sender
    if (actor.type !== 'user') return

    const target = await resolveTarget(ctx)
    if (!target) {
      await msg.answerText('Could not resolve target. Reply to their message or provide an ID/@username.')
      return
    }

    const result = await db.superusers.deleteOne({ _id: String(target.id) })
    if (result.deletedCount === 0) {
      await msg.answerText(md`**${target.displayName}** is not a superuser.`)
      return
    }

    await invalidateSuperusers()
    logger.superuserRemoved(actor, target)

    await msg.replyText(md`${SUCCESS_EMOJI} **${target.displayName}** is no longer a superuser.`)
  },
})
