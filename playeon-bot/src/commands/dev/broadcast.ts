import { md } from '@mtcute/markdown-parser'
import { defineCommand, Role } from '../../core/command.js'
import { emojiCallbackButton } from '../../lib/keyboard.js'
import { ERROR_EMOJI, SUCCESS_EMOJI, WARNING_EMOJI, INFO_EMOJI } from '../../lib/feedback.js'
import { isNotModified } from '../../lib/tgErrors.js'
import {
  activeBroadcast,
  startBroadcast,
  type BroadcastFlags,
  type BroadcastState,
} from '../../services/broadcast.js'

const FLAGS = ['groups', 'users', 'notag'] as const

function parseFlags(args: string[]): { flags: BroadcastFlags; unknown: string[] } {
  const flags: BroadcastFlags = { groups: false, users: false, notag: false }
  const unknown: string[] = []
  for (const arg of args) {
    const name = arg.replace(/^-+/, '').toLowerCase()
    if (!arg.startsWith('-') || !FLAGS.includes(name as (typeof FLAGS)[number])) {
      unknown.push(arg)
      continue
    }
    flags[name as keyof BroadcastFlags] = true
  }
  return { flags, unknown }
}

function bar(done: number, total: number): string {
  const width = 14
  const filled = total > 0 ? Math.round((done / total) * width) : 0
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function elapsed(state: BroadcastState): string {
  const ms = (state.finishedAt ?? Date.now()) - state.startedAt
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function render(state: BroadcastState, flags: BroadcastFlags) {
  const { stats } = state
  const done = stats.sent + stats.failed + stats.skipped
  const running = state.finishedAt === null

  const scope = [
    flags.groups ? `${stats.groups} groups` : null,
    flags.users ? `${stats.users} users` : null,
  ].filter(Boolean).join(' · ')

  const head = running
    ? md`**Broadcasting…** ${flags.notag ? '(no tag)' : '(forwarded)'}`
    : state.aborted
      ? md`${WARNING_EMOJI} **Broadcast stopped**`
      : md`${SUCCESS_EMOJI} **Broadcast complete**`

  const trimmed = stats.trimmed > 0 ? md`\n**Trimmed:** ${stats.trimmed} (media not allowed)` : md``

  return md`${head}

\`${bar(done, stats.total)}\` ${done}/${stats.total}

**Sent:** ${stats.sent}
**Skipped:** ${stats.skipped}
**Failed:** ${stats.failed}${trimmed}

**Scope:** ${scope || '-'}
**Elapsed:** ${elapsed(state)}`
}

const ABORT_KEYBOARD = {
  type: 'inline' as const,
  buttons: [[emojiCallbackButton('Stop broadcast', 'bc:abort', undefined, 'red')]],
}

export default defineCommand({
  name: 'broadcast',
  aliases: ['bc'],
  order: 43,
  description: 'Broadcast the replied message to every group and/or user the bot knows.',
  usage: '/broadcast -groups -users -notag',
  category: 'dev',
  contexts: 'any',
  reply: true,
  roles: [Role.DEV],
  hidden: true,

  handler: async (ctx) => {
    const post = ctx.reply
    if (!post) {
      await ctx.msg.replyText(
        md`${ERROR_EMOJI} Reply to the message you want to broadcast.\n\n\`${ctx.prefix}broadcast -groups -users -notag\``,
      )
      return
    }

    const { flags, unknown } = parseFlags(ctx.args)

    if (unknown.length > 0) {
      await ctx.msg.replyText(
        md`${ERROR_EMOJI} Unknown flag: \`${unknown.join(' ')}\`\n\nUse \`-groups\`, \`-users\`, \`-notag\`.`,
      )
      return
    }

    if (!flags.groups && !flags.users) {
      await ctx.msg.replyText(
        md`${ERROR_EMOJI} Pick at least one audience - \`-groups\`, \`-users\`, or both.`,
      )
      return
    }

    if (activeBroadcast()) {
      await ctx.msg.replyText(
        md`${WARNING_EMOJI} A broadcast is already running. Stop it first.`,
      )
      return
    }

    const status = await ctx.msg.replyText(md`**Collecting targets…**`)

    let lastPaint = ''
    const paint = (state: BroadcastState) => {
      const next = render(state, flags)
      if (next.text === lastPaint) return
      lastPaint = next.text
      const running = state.finishedAt === null
      void ctx.tg
        .editMessage({
          chatId: status.chat.id,
          message: status.id,
          text: next,
          replyMarkup: running ? ABORT_KEYBOARD : undefined,
        })
        .catch((err) => {
          if (!isNotModified(err)) console.warn('[broadcast] progress edit failed:', err)
        })
    }

    const handle = await startBroadcast({
      tg: ctx.tg,
      post,
      flags,
      by: ctx.msg.sender.displayName,
      onProgress: paint,
    })

    if (!handle) {
      await ctx.tg.editMessage({
        chatId: status.chat.id,
        message: status.id,
        text: md`${WARNING_EMOJI} A broadcast is already running.`,
      })
      return
    }

    if (handle.state.stats.total === 0) {
      await ctx.tg.editMessage({
        chatId: status.chat.id,
        message: status.id,
        text: md`${INFO_EMOJI} No targets to broadcast to.`,
      })
      return
    }

    paint(handle.state)
    await handle.done
  },
})
