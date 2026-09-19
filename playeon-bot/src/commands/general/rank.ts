import type { User } from '@mtcute/node'
import { defineCommand, Role } from '../../core/command.js'
import { resolveTarget } from '../../lib/resolveTarget.js'
import { sendRankCard } from '../../lib/rankCard.js'

export default defineCommand({
  name: 'rank',
  aliases: ['my', 'me'],
  order: 3,
  description: 'Listening level, XP and Playeon rank - yours, or reply/mention to see someone else.',
  summary: "Check your Playeon rank, level, and listening stats - or someone else's.",
  usage: '/rank [reply|@user|id]',
  category: 'general',
  contexts: 'any',
  reply: true,
  roles: [Role.USER],

  handler: async (ctx) => {
    const { msg } = ctx

    const target = (await resolveTarget(ctx))
      ?? (msg.sender.type === 'user' ? (msg.sender as User) : null)
    if (!target) {
      await msg.answerText('Reply to someone or mention them to see their rank.')
      return
    }

    const chat = msg.chat
    const inGroup = chat.type !== 'user'
    const groupId = inGroup ? chat.id : undefined
    const groupTitle = inGroup ? chat.title : undefined

    await sendRankCard(msg, target, {
      groupId,
      groupTitle,
      invokerId: msg.sender.id,
      cmdMsgId: msg.id,
    })
  },
})
