import { md } from '@mtcute/markdown-parser'
import { BotKeyboard } from '@mtcute/node'
import { defineCommand, Role } from '../core/command.js'
import { botInfo } from '../client.js'
import { lines, paragraphs } from './md.js'
import {
  renderHelpOverview,
  renderHelpCategory,
  renderInlineGuide,
  renderCommandDetail,
  findCategory,
  findCommand,
} from '../core/help.js'

export function makeHelpCommand() {
  return defineCommand({
    name: 'guide',
    aliases: ['help'],
    order: 9,
    emoji: '🤖',
    emojiId: '5931415565955503486',
    description: 'Browse the usage guide, or show detailed usage for one command.',
    usage: '/guide [command]',
    category: 'general',
    contexts: 'any',
    reply: true,
    roles: [Role.USER],

    handler: async (ctx) => {
      const { msg, args, role, prefix } = ctx

      // In a group: show top commands directly with link to full DM guide
      if (msg.chat.type !== 'user') {
        const text = paragraphs(
          md`**Playeon Commands**`,
          lines(
            md`${prefix}play [song or link] - stream music in the room`,
            md`${prefix}vplay [video or link] - stream HD/4K video in sync`,
            md`${prefix}queue - view upcoming tracks in queue`,
            md`${prefix}room - open synchronized web player`,
          ),
          md`Tap **Full Guide** below to explore all commands in private.`,
        )
        const replyMarkup = BotKeyboard.inline([
          [BotKeyboard.url('Full Guide', `https://t.me/${botInfo.username}?start=guide`)],
        ])
        await msg.answerText(text, { replyMarkup, disableWebPreview: true })
        return
      }

      // In DMs: full interactive guide
      const origin = { id: msg.id, from: 'cmd' as const }

      if (args[0]) {
        const query = args[0].toLowerCase().trim()

        if (query === 'inline') {
          const page = renderInlineGuide(origin)
          await msg.answerText(page.text, { replyMarkup: page.replyMarkup, disableWebPreview: true })
          return
        }

        const category = findCategory(query)
        if (category) {
          const page = renderHelpCategory(category, role, prefix, 0, origin)
          await msg.answerText(page.text, { replyMarkup: page.replyMarkup, disableWebPreview: true })
          return
        }

        const cmd = findCommand(role, query)
        if (cmd) {
          const page = renderCommandDetail(role, prefix, cmd, origin)
          await msg.answerText(page.text, { replyMarkup: page.replyMarkup, disableWebPreview: true })
          return
        }
      }

      const overview = renderHelpOverview(role, origin)
      await msg.answerText(overview.text, { replyMarkup: overview.replyMarkup, disableWebPreview: true })
    },
  })
}

export function makeGuideRedirectCommand() {
  return makeHelpCommand()
}
