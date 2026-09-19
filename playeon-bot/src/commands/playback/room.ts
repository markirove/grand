import { defineCommand, Role } from '../../core/command.js'
import { roomSummary } from '../../services/room/roomSummary.js'

export default defineCommand({
  name: 'room',
  order: 1,
  description: 'Open this group\'s synchronized web room, a shared player everyone can watch together, kept in sync.',
  summary: 'Open a synced Web Room to watch and listen together.',
  usage: '/room',
  category: 'playback',
  contexts: ['supergroup', 'group', 'private'],

  reply: true,
  roles: [Role.USER, Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],

  handler: async (ctx) => {
    const groupId = String(ctx.msg.chat.id)
    const title = 'title' in ctx.msg.chat ? ctx.msg.chat.title : null
    const card = await roomSummary(groupId, title)
    await ctx.msg.replyText(card.text, {
      replyMarkup: card.replyMarkup,
      disableWebPreview: true,
    })
  },
})
