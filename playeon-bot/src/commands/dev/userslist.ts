import { defineCommand, Role } from '../../core/command.js'
import { renderUsers } from '../../lib/adminLists.js'

export default defineCommand({
  name: 'userslist',
  aliases: ['users'],
  order: 43,
  description: 'List bot users, most-recently-active first (paginated).',
  usage: '/userslist',
  category: 'dev',
  contexts: 'any',
  reply: true,
  roles: [Role.DEV],

  handler: async (ctx) => {
    const { text, replyMarkup } = await renderUsers(0)
    await ctx.msg.replyText(text, { replyMarkup })
  },
})
