import { md } from '@mtcute/markdown-parser'
import { defineCommand, Role } from '../../core/command.js'
import { resolveTarget } from '../../lib/resolveTarget.js'
import { invalidateSuperusers } from '../../core/permissions.js'
import { SUCCESS_EMOJI } from '../../lib/feedback.js'

export default defineCommand({
  name: 'addsuperuser',
  order: 21,
  aliases: ['addsu'],
  emoji: '➕',
  emojiId: '6033108709213736873',
  description: 'Grant superuser status to a user.',
  usage: '/addsuperuser <reply|id|@username>',
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

    await db.superusers.updateOne(
      { _id: String(target.id) },
      { $setOnInsert: { addedBy: String(actor.id), addedAt: new Date() } },
      { upsert: true },
    )

    await invalidateSuperusers()
    logger.superuserAdded(actor, target)

    await msg.replyText(md`${SUCCESS_EMOJI} **${target.displayName}** is now a superuser.`)
  },
})
