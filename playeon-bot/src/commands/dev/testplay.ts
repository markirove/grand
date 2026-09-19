import { defineCommand, Role } from '../../core/command.js'
import { config } from '../../config.js'
import { performRoomPlay } from '../../services/room/roomFlow.js'
import { md } from '@mtcute/markdown-parser'
import { INFO_EMOJI } from '../../lib/feedback.js'

export default defineCommand({
  name: 'testplay',
  aliases: ['devplay', 'tplay', 'tvplay'],
  order: 45,
  description: 'Enqueue a track into the local test room (groupId: "test") for local web testing.',
  usage: '/testplay <song name or link>',
  category: 'dev',
  contexts: 'any',
  reply: true,
  roles: [Role.DEV],
  hidden: true,

  handler: async (ctx) => {
    if (!config.devMode) {
      await ctx.msg.replyText(md`${INFO_EMOJI} Test room is only available in local development mode (\`DEV_MODE=1\`).`)
      return
    }
    const isVideo = ctx.args.some((a) => a === '-v' || a === '--video')
    await performRoomPlay(ctx, isVideo, 'test')
  },
})
