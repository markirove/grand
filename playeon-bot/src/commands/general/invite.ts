import { defineCommand, Role } from '../../core/command.js'
import { roomInviteMessage } from '../../services/room/roomLink.js'

export default defineCommand({
  name: 'invite',
  order: 12,
  description: 'Get a shareable invite to your room - forward it to whoever you want to watch with.',
  summary: 'Get a shareable invite link to your room.',
  usage: '/invite',
  category: 'general',
  contexts: ['private'],
  roles: [Role.USER],

  handler: async (ctx) => {
    const { msg, tg } = ctx
    const user = msg.sender
    if (user.type !== 'user') return

    const { text, replyMarkup } = roomInviteMessage(user.displayName, String(user.id))
    await tg.sendText(msg.chat.id, text, { replyMarkup })
  },
})
