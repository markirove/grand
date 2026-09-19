import { customEmoji } from '../../lib/emoji.js'
import { md } from '@mtcute/markdown-parser'
import type { TextWithEntities } from '@mtcute/core'
import { BotKeyboard, tl } from '@mtcute/node'
import Long from 'long'
import { defineCommand, Role } from '../../core/command.js'

export default defineCommand({
  name: 'e',
  order: 3,
  emoji: '⭐️',
  emojiId: '6028338546736107668',
  description: 'Extract the document ID of any custom emoji and test button centering.',
  usage: '/e <message with custom emoji>',
  category: 'misc',
  contexts: 'any',
  reply: true,
  roles: [Role.USER],
  hidden: true,

  handler: async (ctx) => {
    const { msg, args } = ctx

    const manualId = args[0] && /^\d+$/.test(args[0]) ? args[0] : null
    const customEmojis = msg.entities.filter(e => e.kind === 'emoji')

    if (customEmojis.length === 0 && !manualId) {
      await msg.answerText('Send custom emojis after /e, or pass an ID like `/e 6028338546736107668`')
      return
    }

    const lines = customEmojis.map((e): TextWithEntities => {
      const char = msg.text.slice(e.offset, e.offset + e.length)
      const raw = e.raw as { documentId?: { toString(): string } }
      const id = raw.documentId?.toString() ?? '?'
      return md`${char} → \`${id}\``
    })

    const body = lines.reduce<TextWithEntities | null>(
      (acc, l) => (acc ? md`${acc}\n${l}` : l),
      null,
    ) ?? md`ID: \`${manualId}\``

    const targetId = manualId ?? (customEmojis[0]?.raw as { documentId?: { toString(): string } }).documentId?.toString()

    if (!targetId) {
      await msg.answerText('Could not find emoji document ID.')
      return
    }

    const style: tl.RawKeyboardButtonStyle = {
      _: 'keyboardButtonStyle',
      icon: Long.fromString(targetId),
    }

    // Attempt 1: Try strictly empty string text: ""
    let emptyStringAllowed = false
    try {
      const kbEmpty = BotKeyboard.inline([
        [BotKeyboard.callback('', 'test:empty', { style })],
      ])
      const sent = await msg.replyText(
        md`${customEmoji('⭐️', '6028338546736107668')} **Centering Test (Empty String \`""\`)**\n\nTelegram accepted strictly empty text! Check if this is perfectly centered:`,
        { replyMarkup: kbEmpty },
      )
      emptyStringAllowed = true
    } catch (err: unknown) {
      emptyStringAllowed = false
    }

    // Attempt 2: Compare Zero-Width Space, Word Joiner, and Normal Space
    const comparisonKb = BotKeyboard.inline([
      [
        BotKeyboard.callback('\u200B', 'test:zws', { style }),
        BotKeyboard.callback('\u2060', 'test:wj', { style }),
        BotKeyboard.callback(' ', 'test:space', { style }),
      ],
      [
        BotKeyboard.callback('Zero-Width', 'test:info:1'),
        BotKeyboard.callback('Word-Joiner', 'test:info:2'),
        BotKeyboard.callback('Normal Space', 'test:info:3'),
      ],
    ])

    await msg.replyText(
      md`${customEmoji('⭐️', '6028338546736107668')} **Centering Comparison**\n\n${body}\n\nStrictly empty \`""\` allowed by Telegram server: **${emptyStringAllowed ? 'YES' : 'NO (BUTTON_TEXT_INVALID)'}**\n\nTop row buttons: [Zero-Width] | [Word-Joiner] | [Normal Space]\nInspect which one aligns best on your device:`,
      { replyMarkup: comparisonKb },
    )
  },
})
