import { md } from '@mtcute/markdown-parser'
import { defineCommand, Role } from '../../core/command.js'
import { SUCCESS_EMOJI } from '../../lib/feedback.js'
import { resetAllRanking } from '../../lib/ranking.js'

export default defineCommand({
  name: 'resetrank',
  aliases: ['purgeranks', 'resetlevels'],
  order: 40,
  description: 'Purge all track listening stats, leaderboard rankings, and levelling data.',
  usage: '/resetrank',
  category: 'dev',
  contexts: 'any',
  reply: true,
  roles: [Role.DEV],

  handler: async (ctx) => {
    const { msg } = ctx
    const stats = await resetAllRanking()
    await msg.replyText(
      md`${SUCCESS_EMOJI} **Track ranking data reset.**
Removed **${stats.buckets.toLocaleString()}** listening buckets and **${stats.members.toLocaleString()}** group tallies, and reset levels on **${stats.users.toLocaleString()}** users.`,
    )
  },
})
