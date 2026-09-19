import { defineCommand, Role } from '../../core/command.js'
import { renderAnalytics } from '../../lib/analyticsCard.js'

export default defineCommand({
  name: 'analytics',
  order: 42,
  description: 'Tracks played, users started and groups added - Today / Week / Month / Overall.',
  usage: '/analytics',
  category: 'dev',
  contexts: 'any',
  reply: true,
  roles: [Role.DEV],

  handler: async (ctx) => {
    const { text, replyMarkup } = await renderAnalytics('today')
    await ctx.msg.replyText(text, { replyMarkup })
  },
})
