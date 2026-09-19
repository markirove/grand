import { md } from '@mtcute/markdown-parser'
import { defineCommand, Role } from '../../core/command.js'
import { LOG_KINDS, LOG_KIND_LABEL, getAllLogChats } from '../../services/logChats.js'

export default defineCommand({
  name: 'logs',
  order: 46,
  description: 'Show which chat each log feed (core / plays / error) is currently pointed at.',
  usage: '/logs',
  category: 'dev',
  contexts: 'any',
  reply: true,
  roles: [Role.DEV],

  handler: async (ctx) => {
    const { msg, tg } = ctx
    const chats = await getAllLogChats()

    const lines = await Promise.all(LOG_KINDS.map(async (kind) => {
      const id = chats[kind]
      if (id == null) return md`**${LOG_KIND_LABEL[kind]}:** _not set_`

      let target = md`\`${String(id)}\``
      try {
        const chat = await tg.getChat(id)
        target = md`**${chat.title}** \`${String(id)}\``
      } catch {
        target = md`\`${String(id)}\` _(can't resolve - may be inaccessible)_`
      }
      return md`**${LOG_KIND_LABEL[kind]}:** ${target}`
    }))

    await msg.replyText(lines.reduce((acc, line) => md`${acc}\n${line}`))
  },
})
