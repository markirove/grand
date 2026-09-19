import { customEmoji } from '../../lib/emoji.js'
import { md } from '@mtcute/markdown-parser'
import { defineCommand, Role } from '../../core/command.js'
import { setPrefix } from '../../core/prefix.js'
import { SUCCESS_EMOJI } from '../../lib/feedback.js'

export default defineCommand({
  name: 'prefix',
  order: 1,
  emoji: '⚙',
  emojiId: '6032742198179532882',
  description: 'View or change the command prefix for this chat.',
  usage: '/prefix [new_prefix]',
  category: 'misc',
  contexts: ['supergroup', 'group'],

  disabled: true,

  reply: true,
  roles: [Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],

  handler: async (ctx) => {
    const { msg, args, prefix, logger } = ctx

    if (!args[0]) {
      await msg.answerText(md`${customEmoji('⚙️', '5386367538735104399')} Current prefix: \`${prefix}\``)
      return
    }

    const newPrefix = args[0]

    if (newPrefix.length > 4) {
      await msg.answerText('Prefix must be 4 characters or fewer.')
      return
    }
    if (/^[a-zA-Z0-9]+$/.test(newPrefix)) {
      await msg.answerText('Prefix cannot be purely alphanumeric.')
      return
    }

    const sender = msg.sender
    if (sender.type !== 'user') return

    await setPrefix(msg.chat.id, newPrefix)
    logger.prefixChanged(msg.chat.id, sender, prefix, newPrefix)

    await msg.answerText(md`${SUCCESS_EMOJI} Prefix changed to \`${newPrefix}\`. Use \`${newPrefix}help\` to see commands.`)
  },
})
