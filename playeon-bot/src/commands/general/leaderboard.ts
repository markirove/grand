import type { Chat } from '@mtcute/node'
import { defineCommand, Role } from '../../core/command.js'
import { sendLeaderboard } from '../../lib/leaderboard.js'

export default defineCommand({
  name: 'leaderboard',
  aliases: ['lb'],
  order: 1,
  emoji: '🏆',
  emojiId: '5456498809875995940',
  description: 'Top 10 listeners in this room (or globally in DMs). Switch between Today, This Week and This Month.',
  summary: "See the room's top listeners (or global top in DMs).",
  usage: '/leaderboard',
  category: 'general',
  contexts: 'any',
  reply: true,
  roles: [Role.USER],

  handler: async (ctx) => {
    const { msg } = ctx
    const chat = msg.chat
    if (chat.type === 'user') {
      await sendLeaderboard(msg, 'glb', 'today')
    } else {
      await sendLeaderboard(msg, 'grp', 'today', { groupId: chat.id, title: (chat as Chat).title })
    }
  },
})
