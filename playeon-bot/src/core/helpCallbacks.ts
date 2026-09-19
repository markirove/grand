import { filters } from '@mtcute/dispatcher'
import { dp } from '../client.js'
import { resolveRoleByIds } from './permissions.js'
import { getPrefix } from './prefix.js'
import {
  renderHelpOverview,
  renderHelpCategory,
  renderInlineGuide,
  parseOrigin,
} from './help.js'
import { startText, startKeyboard } from '../lib/startCard.js'
import type { CommandCategory } from './command.js'

export function registerHelpCallbacks() {
  dp.onCallbackQuery(
    filters.regex(/^help:(?:noop|close(?::\d+)?|start:\d+|menu(?::\d+:[cs])?|inline(?::\d+:[cs])?|cat:[a-z]+:\d+:\d+:[cs])$/),
    async (cq) => {
      const [, kind, ...rest] = cq.dataStr!.split(':')

      if (kind === 'noop') {
        await cq.answer({})
        return
      }

      if (kind === 'close') {
        const originId = Number(rest[0]) || 0
        const ids = originId ? [cq.messageId, originId] : [cq.messageId]
        await cq.client.deleteMessagesById(cq.chat.id, ids).catch(() => {})
        await cq.answer({})
        return
      }

      if (kind === 'start') {
        await cq.editMessage({
          text: startText(cq.user.firstName, cq.user.id),
          replyMarkup: startKeyboard(Number(rest[0]) || 0, cq.user.id),
          disableWebPreview: true,
        }).catch(() => {})
        await cq.answer({})
        return
      }

      const chat = cq.chat
      const role = await resolveRoleByIds(cq.user.id, chat.id, chat)
      const prefix = chat.type === 'user' ? '/' : await getPrefix(chat.id)

      let rendered

      if (kind === 'cat') {
        const category = rest[0] as CommandCategory
        const page = Number(rest[1]) || 0
        const origin = parseOrigin(rest[2], rest[3])
        rendered = renderHelpCategory(category, role, prefix, page, origin)
      } else if (kind === 'inline') {
        const origin = parseOrigin(rest[0], rest[1])
        rendered = renderInlineGuide(origin)
      } else {
        const origin = parseOrigin(rest[0], rest[1])
        rendered = renderHelpOverview(role, origin)
      }

      await cq.editMessage({
        text: rendered.text,
        replyMarkup: rendered.replyMarkup,
        disableWebPreview: true,
      }).catch(() => {})
      await cq.answer({})
    },
  )
}
