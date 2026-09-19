import { md } from '@mtcute/markdown-parser'
import type { TextWithEntities } from '@mtcute/core'
import { BotKeyboard } from '@mtcute/node'
import type { User } from '@mtcute/node'
import type { MessageContext } from '@mtcute/dispatcher'
import { filters } from '@mtcute/dispatcher'
import { sendRichMessage } from '@mtcute/core/methods.js'
import { config } from '../config.js'
import { dp, tg } from '../client.js'
import { collections } from '../services/mongo.js'
import { levelProgress } from './leveling.js'
import {
  globalAllTimeRank,
  globalRankedCount,
  groupAllTimeCount,
  groupAllTimeRank,
  groupRankedCount,
  periodCount,
  groupFirstSeen,
} from './ranking.js'
import { trophy, rankBadge, RANK_BADGES, TROPHY_EMOJI_ID } from './rankBadges.js'
import { isEmojiInvalid } from './tgErrors.js'

const DAY_MS = 86_400_000
const plural = (n: number) => (n === 1 ? '' : 's')

const HINT_LIMIT = 9_999

export type RankCardOpts = {
  groupId?: number
  groupTitle?: string
  invokerId: number
  cmdMsgId: number
  plain?: boolean
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatListenTime(seconds: number): string {
  if (seconds <= 0) return '0m'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function activityLine(
  today: number,
  week: number,
  month: number,
  spanDays: number,
): TextWithEntities | null {
  const clauses: { n: number; label: string }[] = []
  if (today > 0) clauses.push({ n: today, label: 'today' })
  if (week > 0 && spanDays >= 1) clauses.push({ n: week, label: 'this week' })
  if (month > 0 && spanDays >= 7) clauses.push({ n: month, label: 'this month' })
  if (clauses.length === 0) return null

  const parts = clauses.map((c, i) =>
    i === 0
      ? md`played ${c.n.toLocaleString()} track${plural(c.n)} in this group ${c.label}`
      : md`${c.n.toLocaleString()} ${c.label}`,
  )
  let body = parts[0]!
  for (let i = 1; i < parts.length; i++) {
    body = md`${body}${i === parts.length - 1 ? ' and ' : ', '}${parts[i]}`
  }
  return md`__They've ${body}.__`
}

function rankNumberStr(rank: number, outOf: number): string {
  if (rank <= 0) return '-'
  if (outOf <= 0 || outOf > HINT_LIMIT) return `#${rank}`
  return `${rank}/${outOf.toLocaleString()}`
}

export type RenderedRankCard = {
  text: TextWithEntities
  richHtml: string
  replyMarkup: ReturnType<typeof BotKeyboard.inline>
}

export async function renderRankCard(target: User, opts: RankCardOpts): Promise<RenderedRankCard> {
  const plain = opts.plain ?? false
  const { groupId } = opts

  const isSelfInDm = groupId === undefined && target.id === opts.invokerId
  const mention = md`[${target.displayName}](tg://user?id=${target.id})`
  const trophyPrefix = config.features.emoji && !plain ? md`[🏆](tg://emoji?id=${TROPHY_EMOJI_ID}) ` : md``
  const trophyHtml = config.features.emoji && !plain ? `<tg-emoji emoji-id="${TROPHY_EMOJI_ID}">🏆</tg-emoji> ` : ''

  const heading = isSelfInDm
    ? md`${trophyPrefix}**Your Playeon Rank**`
    : md`${trophyPrefix}**Playeon Rank of ${mention}**`
  const replyMarkup = BotKeyboard.inline([
    [BotKeyboard.callback('Close', `rank:close:${opts.invokerId}:${opts.cmdMsgId}`)],
  ])

  const doc = await collections.users.findOne(
    { _id: String(target.id) },
    { projection: { totalTracksListened: 1, totalSecondsListened: 1 } },
  )
  const total = doc?.totalTracksListened ?? 0
  const totalSec = doc?.totalSecondsListened ?? 0

  if (total === 0) {
    const emptyHtml = isSelfInDm
      ? `${trophyHtml}<b>Your Playeon Rank</b>\n\n<blockquote><i>No tracks played in rooms yet.</i></blockquote>`
      : `${trophyHtml}<b>Playeon Rank of <a href="tg://user?id=${target.id}"><b>${escapeHtml(target.displayName)}</b></a></b>\n\n<blockquote><i>No tracks played in rooms yet.</i></blockquote>`
    return {
      text: md`${heading}\n\nNo tracks played in rooms yet.`,
      richHtml: emptyHtml,
      replyMarkup,
    }
  }

  const prog = levelProgress(total)

  const [globalRank, globalOf, groupCount, today, week, month, firstDay] = await Promise.all([
    globalAllTimeRank(target.id, total),
    globalRankedCount(),
    groupId !== undefined ? groupAllTimeCount(groupId, target.id) : Promise.resolve(0),
    groupId !== undefined ? periodCount('today', target.id, groupId) : Promise.resolve(0),
    groupId !== undefined ? periodCount('week', target.id, groupId) : Promise.resolve(0),
    groupId !== undefined ? periodCount('month', target.id, groupId) : Promise.resolve(0),
    groupId !== undefined ? groupFirstSeen(groupId, target.id) : Promise.resolve(null),
  ])
  const [groupRank, groupOf] = groupId !== undefined
    ? await Promise.all([groupAllTimeRank(groupId, target.id, groupCount), groupRankedCount(groupId)])
    : [0, 0]
  const spanDays = firstDay ? (Date.now() - firstDay.getTime()) / DAY_MS : 0

  const toNext = Math.max(0, prog.needed - prog.current)
  const lines: TextWithEntities[] = [
    heading,
    md`> **Global Rank** - **${rankNumberStr(globalRank, globalOf)}**`,
  ]
  if (groupId !== undefined) {
    lines.push(md`> **${opts.groupTitle || 'This Group'}** - **${rankNumberStr(groupRank, groupOf)}**`)
  }

  lines.push(md``, md`**Total Played:** **${total.toLocaleString()}** tracks \`(${formatListenTime(totalSec)})\``)

  const activity = groupId !== undefined ? activityLine(today, week, month, spanDays) : null
  if (activity) lines.push(activity)

  const exp = md`**Exp:** \`${prog.current.toLocaleString()}/${prog.needed.toLocaleString()}\``
  lines.push(
    md``,
    md`**Level:** **${String(prog.level)}**`,
    toNext > HINT_LIMIT ? exp : md`${exp} · **${toNext.toLocaleString()}** track${plural(toNext)} to Level ${String(prog.level + 1)}`,
  )

  const text = lines.reduce((acc, l, i) => (i === 0 ? l : md`${acc}\n${l}`))

  // Build Telegram Rich Message HTML with native lists and blockquotes
  const headingHtml = isSelfInDm
    ? `${trophyHtml}<b>Your Playeon Rank</b>`
    : `${trophyHtml}<b>Playeon Rank of <a href="tg://user?id=${target.id}"><b>${escapeHtml(target.displayName)}</b></a></b>`

  const quoteLines = [`<b>Global Rank</b> - <b>${rankNumberStr(globalRank, globalOf)}</b>`]
  if (groupId !== undefined) {
    quoteLines.push(`<b>${escapeHtml(opts.groupTitle || 'This Group')}</b> - <b>${rankNumberStr(groupRank, groupOf)}</b>`)
  }
  const quoteHtml = `<blockquote>${quoteLines.join('\n')}</blockquote>`

  const items: string[] = [
    `<li>Total Played: <b>${total.toLocaleString()}</b> tracks <code>(${formatListenTime(totalSec)})</code></li>`,
  ]

  const activityClauses: { n: number; label: string }[] = []
  if (today > 0) activityClauses.push({ n: today, label: 'today' })
  if (week > 0 && spanDays >= 1) activityClauses.push({ n: week, label: 'this week' })
  if (month > 0 && spanDays >= 7) activityClauses.push({ n: month, label: 'this month' })
  if (activityClauses.length > 0) {
    const parts = activityClauses.map((c, i) =>
      i === 0 ? `played <b>${c.n.toLocaleString()}</b> track${plural(c.n)} in this group ${c.label}` : `<b>${c.n.toLocaleString()}</b> ${c.label}`,
    )
    let actText = parts[0]!
    for (let i = 1; i < parts.length; i++) {
      actText += (i === parts.length - 1 ? ' and ' : ', ') + parts[i]
    }
    items.push(`<li>Activity: ${actText}</li>`)
  }

  items.push(`<li>Level: <b>${prog.level}</b> · Exp: <code>${prog.current.toLocaleString()}/${prog.needed.toLocaleString()}</code></li>`)
  if (toNext <= HINT_LIMIT) {
    items.push(`<li>Next Level: <b>${toNext.toLocaleString()}</b> track${plural(toNext)} to Level <b>${prog.level + 1}</b></li>`)
  }

  const richHtml = `${headingHtml}\n${quoteHtml}\n\n<ul>\n${items.join('\n')}\n</ul>`

  return { text, richHtml, replyMarkup }
}

export async function sendRankCard(msg: MessageContext, target: User, opts: RankCardOpts): Promise<void> {
  const r = await renderRankCard(target, opts)
  try {
    await sendRichMessage(tg, msg.chat.id, {
      replyTo: msg.id,
      content: {
        type: 'html',
        content: r.richHtml,
      },
      replyMarkup: r.replyMarkup,
    })
  } catch (richErr) {
    try {
      await msg.answerText(r.text, { replyMarkup: r.replyMarkup })
    } catch (err) {
      if (!isEmojiInvalid(err)) throw err
      const plain = await renderRankCard(target, { ...opts, plain: true })
      await msg.answerText(plain.text, { replyMarkup: plain.replyMarkup })
    }
  }
}

export function registerRankCallbacks(): void {
  dp.onCallbackQuery(filters.regex(/^rank:close:(\d+):(\d+)$/), async (cq) => {
    const invokerId = Number(cq.match![1])
    const cmdMsgId = Number(cq.match![2])

    if (cq.user.id !== invokerId) {
      await cq.answer({ text: 'Only the person who asked for this can close it.', alert: true })
      return
    }

    await cq.client.deleteMessagesById(cq.chat.id, [cq.messageId, cmdMsgId]).catch(() => { })
    await cq.answer({}).catch(() => { })
  })
}
