import { defineCommand, Role } from '../../core/command.js'
import { sendLeaderboard } from '../../lib/leaderboard.js'

export default defineCommand({
  name: 'globals',
  aliases: ['gtop'],
  order: 2,
  description: 'Top 10 music listeners across every room. Switch between Today, This Week and This Month.',
  summary: 'See the top listeners across every room.',
  usage: '/globals',
  category: 'general',
  contexts: 'any',
  reply: true,
  roles: [Role.USER],

  handler: async (ctx) => {
    const { msg } = ctx
    await sendLeaderboard(msg, 'glb', 'today')
  },
})
