import { md } from '@mtcute/markdown-parser'
import { Photo } from '@mtcute/node'
import { defineCommand, Role } from '../../core/command.js'
import { SUCCESS_EMOJI } from '../../lib/feedback.js'

export default defineCommand({
  name: 'setbanner',
  order: 23,
  emoji: '🖼',
  emojiId: '6030466823290360017',
  description: 'Set the banner photo shown in /start. Reply to a photo.',
  usage: '/setbanner (reply to a photo)',
  category: 'dev',
  contexts: 'any',
  reply: true,
  roles: [Role.DEV],
  requiresReply: true,

  handler: async (ctx) => {
    const { msg, reply, db, cache } = ctx

    const media = reply?.media
    if (!(media instanceof Photo)) {
      await msg.replyText('Reply to a photo to set it as the start banner.')
      return
    }

    const fileId = media.fileId

    await db.settings.updateOne(
      { _id: 'global' },
      { $set: { bannerFileId: fileId } },
      { upsert: true },
    )

    await cache.del('settings:banner')

    await msg.replyText(md`${SUCCESS_EMOJI} Banner set.\n\`${fileId}\``)
  },
})
