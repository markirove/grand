import { md } from '@mtcute/markdown-parser'
import { tl } from '@mtcute/node'
import { defineCommand, Role } from '../../core/command.js'
import { SUCCESS_EMOJI, ERROR_EMOJI, WARNING_EMOJI } from '../../lib/feedback.js'
import { LOG_KINDS, LOG_KIND_LABEL, setLogChat, type LogKind } from '../../services/logChats.js'

function isLogKind(s: string): s is LogKind {
  return (LOG_KINDS as readonly string[]).includes(s)
}

export default defineCommand({
  name: 'setlogchat',
  order: 45,
  description: 'Point a log feed at a chat: `core` (new users/groups, prefix + superuser changes), `plays` (tracks played), or `error` (command errors). Pass a chat id (always starts with `-100`), or omit it to use the current chat - required when run in DM. Sends a confirmation there first and only saves it if that succeeds.',
  usage: '/setlogchat <core|plays|error> [chatId]',
  category: 'dev',
  contexts: 'any',
  reply: true,
  roles: [Role.DEV],

  handler: async (ctx) => {
    const { msg, tg, args } = ctx

    const kindArg = args[0]?.toLowerCase()
    if (!kindArg || !isLogKind(kindArg)) {
      await msg.replyText(md`Usage: \`/setlogchat <${LOG_KINDS.join('|')}> [chatId]\``)
      return
    }

    let chatId: number
    if (args[1]) {
      const raw = args[1]
      if (!/^-100\d+$/.test(raw)) {
        await msg.replyText(md`${WARNING_EMOJI} That doesn't look like a group/channel id - it should start with \`-100\`.`)
        return
      }
      chatId = Number(raw)
    } else if (msg.chat.type === 'user') {
      await msg.replyText(md`${WARNING_EMOJI} Pass a chat id when running this in DM: \`/setlogchat ${kindArg} -100…\``)
      return
    } else {
      chatId = msg.chat.id
    }

    try {
      await tg.sendText(chatId, md`${SUCCESS_EMOJI} This chat is now the **${LOG_KIND_LABEL[kindArg]}** log feed.`, { disableWebPreview: true })
    } catch (err) {
      const reason = tl.RpcError.is(err) ? err.text : 'unknown error'
      await msg.replyText(md`${ERROR_EMOJI} Couldn't send a message to \`${String(chatId)}\` (\`${reason}\`) - make sure I'm a member there with permission to post, then try again.`)
      return
    }

    await setLogChat(kindArg, chatId)
    await msg.replyText(md`${SUCCESS_EMOJI} **${LOG_KIND_LABEL[kindArg]}** logs → \`${String(chatId)}\``)
  },
})
