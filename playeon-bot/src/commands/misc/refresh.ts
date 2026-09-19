import { md } from '@mtcute/markdown-parser'
import { defineCommand, Role } from '../../core/command.js'
import { redis } from '../../services/redis.js'
import { invalidateSuperusers } from '../../core/permissions.js'
import { SUCCESS_EMOJI } from '../../lib/feedback.js'

async function delPattern(pattern: string): Promise<number> {
  let deleted = 0
  let cursor = '0'
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
    cursor = next
    if (keys.length) {
      await redis.del(...keys)
      deleted += keys.length
    }
  } while (cursor !== '0')
  return deleted
}

export default defineCommand({
  name: 'refresh',
  order: 2,
  emoji: '🌟',
  emojiId: '5805331990618053402',
  description: 'Flush all cached data for this group (prefix, roles, config).',
  usage: '/refresh',
  category: 'misc',
  contexts: ['supergroup', 'group'],

  reply: true,
  roles: [Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],

  handler: async (ctx) => {
    const { msg, cache } = ctx
    const chatId = msg.chat.id

    await Promise.all([
      cache.del(`prefix:${chatId}`),
      delPattern(`role:${chatId}:*`),
      invalidateSuperusers(),
    ])

    await msg.replyText(
      md`${SUCCESS_EMOJI} Cache cleared for this group.`,
    )
  },
})
