import { defineCommand, Role } from '../../core/command.js'
import { renderGroups } from '../../lib/adminLists.js'

export default defineCommand({
  name: 'groupslist',
  aliases: ['groups'],
  order: 44,
  description: 'List groups the bot is in, most-recently-active first, with member counts (paginated).',
  usage: '/groupslist',
  category: 'dev',
  contexts: 'any',
  reply: true,
  roles: [Role.DEV],

  handler: async (ctx) => {
    const { text, replyMarkup } = await renderGroups(0)
    await ctx.msg.replyText(text, { replyMarkup })
  },
})
