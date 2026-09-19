import { defineCommand, Role } from '../../core/command.js'
import { renderRoomsList, roomsNavKeyboard } from '../../lib/roomsView.js'

export default defineCommand({
  name: 'rooms',
  order: 42,
  description: 'List the currently active web rooms (title, listeners, now playing).',
  usage: '/rooms',
  category: 'dev',
  contexts: 'any',
  reply: true,
  roles: [Role.DEV],
  hidden: true,

  handler: async (ctx) => {
    const { text, page, pages } = renderRoomsList(0)
    await ctx.msg.replyText(text, {
      replyMarkup: roomsNavKeyboard(page, pages, 'rms'),
      disableWebPreview: true,
    })
  },
})
