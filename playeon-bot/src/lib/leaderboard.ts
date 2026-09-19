import { md } from '@mtcute/markdown-parser'
import type { TextWithEntities } from '@mtcute/core'
import { BotKeyboard } from '@mtcute/node'
import { filters } from '@mtcute/dispatcher'
import { sendRichMessage } from '@mtcute/core/methods.js'
import { config } from '../config.js'
import { dp, tg } from '../client.js'
import { collections } from '../services/mongo.js'
import { levelFromXp } from './leveling.js'
import { emojiCallbackButton } from './keyboard.js'
import { rankBadge, trophy, TROPHY_EMOJI_ID } from './rankBadges.js'
import {
  leaderboard,
  periodTotal,
  periodRank,
  globalAllTimeRank,
  isPeriod,
  PERIOD_LABEL,
  type Period,
  type RankEntry,
} from './ranking.js'
import { isNotModified, isEmojiInvalid } from './tgErrors.js'

export type LbScope = 'grp' | 'glb'
const TOP_N = 10

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

type UserMeta = { name: string; level: number }

async function resolveUserData(userIds: number[]): Promise<Map<number, UserMeta>> {
  const map = new Map<number, UserMeta>()
  if (userIds.length === 0) return map
  const docs = await collections.users
    .find(
      { _id: { $in: userIds.map(String) } },
      { projection: { firstName: 1, lastName: 1, username: 1, level: 1, totalTracksListened: 1 } },
    )
    .toArray()
  for (const d of docs) {
    const name = [d.firstName, d.lastName].filter(Boolean).join(' ').trim()
      || (d.username ? `@${d.username}` : '')
      || `User ${d._id}`
    const level = d.level ?? levelFromXp(d.totalTracksListened ?? 0)
    map.set(Number(d._id), { name, level })
  }
  for (const id of userIds) {
    if (!map.has(id)) map.set(id, { name: `User ${id}`, level: 0 })
  }
  return map
}

function periodButtons(scope: LbScope, active: Period) {
  const mk = (p: Period, label: string) =>
    p === active
      ? emojiCallbackButton(label, `lb:${scope}:${p}`, undefined, 'blue')
      : BotKeyboard.callback(label, `lb:${scope}:${p}`)
  return [
    [mk('today', 'Today'), mk('week', 'This Week')],
    [mk('month', 'This Month'), mk('overall', 'Overall')],
  ]
}

function formatListenTime(seconds: number): string {
  if (seconds <= 0) return '0m'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function renderText(
  scope: LbScope,
  period: Period,
  title: string,
  entries: RankEntry[],
  users: Map<number, UserMeta>,
  total: number,
  plain: boolean,
  footer?: string,
  invokerId?: number,
  isDm?: boolean,
): TextWithEntities {
  const trophyPrefix = config.features.emoji && !plain ? md`[🏆](tg://emoji?id=${TROPHY_EMOJI_ID}) ` : md``
  const heading = scope === 'glb'
    ? md`${trophyPrefix}**Global Leaderboard**`
    : md`${trophyPrefix}**${title} - Top Listeners**`

  const ts = total === 1 ? '' : 's'
  const sub = md`> **${PERIOD_LABEL[period]}** - **${total.toLocaleString()}** track${ts} played`

  if (entries.length === 0) {
    const base = md`${heading}\n${sub}\n\n> __No tracks played in this period yet.__`
    return footer ? md`${base}\n\n${footer}` : base
  }

  let body = md``
  entries.forEach((e, i) => {
    const rank = i + 1
    const isSelf = Boolean(isDm && invokerId && e.userId === invokerId)
    const meta = users.get(e.userId)
    const name = isSelf ? 'You' : (meta?.name ?? `User ${e.userId}`)
    const level = meta?.level ?? levelFromXp(e.count)
    const mention = md`[**${name}**](tg://user?id=${e.userId})`
    const timeStr = e.seconds > 0 ? ` \`(${formatListenTime(e.seconds)})\`` : ''
    const trackStr = md`**${e.count.toLocaleString()}** track${e.count === 1 ? '' : 's'}`
    const row = md`${rankBadge(rank, plain)} ${mention} - ${trackStr}${timeStr} • **Level ${level}**`
    body = i === 0 ? row : md`${body}\n${row}`
  })

  const result = md`${heading}\n${sub}\n\n${body}`
  return footer ? md`${result}\n\n${footer}` : result
}

function renderRichHtml(
  scope: LbScope,
  period: Period,
  title: string,
  entries: RankEntry[],
  users: Map<number, UserMeta>,
  total: number,
  footer?: string,
  invokerId?: number,
  isDm?: boolean,
): string {
  const trophyHtml = config.features.emoji ? `<tg-emoji emoji-id="${TROPHY_EMOJI_ID}">🏆</tg-emoji> ` : ''
  const heading = scope === 'glb'
    ? `${trophyHtml}<b>Global Leaderboard</b>`
    : `${trophyHtml}<b>${escapeHtml(title)} - Top Listeners</b>`

  const ts = total === 1 ? '' : 's'
  const sub = `<blockquote><b>${escapeHtml(PERIOD_LABEL[period])}</b> - <b>${total.toLocaleString()}</b> track${ts} played</blockquote>`

  if (entries.length === 0) {
    const base = `${heading}\n${sub}\n\n<blockquote><i>No tracks played in this period yet.</i></blockquote>`
    return footer ? `${base}\n\n<i>${escapeHtml(footer)}</i>` : base
  }

  const items = entries.map((e) => {
    const isSelf = Boolean(isDm && invokerId && e.userId === invokerId)
    const meta = users.get(e.userId)
    const rawName = isSelf ? 'You' : (meta?.name ?? `User ${e.userId}`)
    const level = meta?.level ?? levelFromXp(e.count)
    const name = escapeHtml(rawName)
    const timeStr = e.seconds > 0 ? ` <code>(${formatListenTime(e.seconds)})</code>` : ''
    const trackStr = `<b>${e.count.toLocaleString()}</b> track${e.count === 1 ? '' : 's'}`
    return `<li><a href="tg://user?id=${e.userId}"><b>${name}</b></a> - ${trackStr}${timeStr} • <b>Level ${level}</b></li>`
  }).join('\n')

  const body = `${heading}\n${sub}\n\n<ol>\n${items}\n</ol>`
  return footer ? `${body}\n\n<i>${escapeHtml(footer)}</i>` : body
}

export type RenderedLeaderboard = {
  text: TextWithEntities
  richHtml: string
  replyMarkup: ReturnType<typeof BotKeyboard.inline>
}

export async function renderLeaderboard(
  scope: LbScope,
  period: Period,
  opts: { groupId?: number; title?: string; plain?: boolean; invokerId?: number; isDm?: boolean } = {},
): Promise<RenderedLeaderboard> {
  const groupId = scope === 'grp' ? opts.groupId : undefined
  const [entries, total] = await Promise.all([
    leaderboard(period, TOP_N, groupId),
    periodTotal(period, groupId),
  ])
  const users = await resolveUserData(entries.map((e) => e.userId))

  // Build a natural footer showing the invoker's rank
  let footer: string | undefined
  if (opts.invokerId) {
    const topIdx = entries.findIndex((e) => e.userId === opts.invokerId)
    let userRank = 0
    if (topIdx >= 0) {
      userRank = topIdx + 1
    } else {
      userRank = await periodRank(period, opts.invokerId, groupId)
    }
    if (userRank > 0) {
      footer = `You're #${userRank} on the leaderboard - use /rank to see your full stats!`
    } else {
      footer = `You're not ranked yet - start listening to climb the leaderboard!`
    }
  }

  const text = renderText(scope, period, opts.title ?? 'This Group', entries, users, total, opts.plain ?? false, footer, opts.invokerId, opts.isDm)
  const richHtml = renderRichHtml(scope, period, opts.title ?? 'This Group', entries, users, total, footer, opts.invokerId, opts.isDm)
  return { text, richHtml, replyMarkup: BotKeyboard.inline(periodButtons(scope, period)) }
}

export async function sendLeaderboard(
  msg: import('@mtcute/dispatcher').MessageContext,
  scope: LbScope,
  period: Period,
  opts: { groupId?: number; title?: string } = {},
): Promise<void> {
  const invokerId = msg.sender.type === 'user' ? msg.sender.id : undefined
  const isDm = msg.chat.type === 'user'
  const r = await renderLeaderboard(scope, period, { ...opts, invokerId, isDm })
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
      const plain = await renderLeaderboard(scope, period, { ...opts, invokerId, isDm, plain: true })
      await msg.answerText(plain.text, { replyMarkup: plain.replyMarkup })
    }
  }
}

export function registerLeaderboardCallbacks(): void {
  dp.onCallbackQuery(filters.regex(/^lb:(grp|glb):(today|week|month|overall)$/), async (cq) => {
    const scope = cq.match![1] as LbScope
    const periodRaw = cq.match![2]!
    if (!isPeriod(periodRaw)) {
      await cq.answer({})
      return
    }
    const period: Period = periodRaw

    const title = 'title' in cq.chat ? (cq.chat as { title: string }).title : 'This Group'
    const groupId = cq.chat.id
    const invokerId = cq.user.id
    const isDm = cq.chat.type === 'user'

    try {
      const r = await renderLeaderboard(scope, period, { groupId, title, invokerId, isDm })
      try {
        await tg.editMessage({
          chatId: cq.chat.id,
          message: cq.messageId,
          richMessage: {
            type: 'html',
            content: r.richHtml,
          },
          replyMarkup: r.replyMarkup,
        })
      } catch {
        await cq.editMessage({ text: r.text, replyMarkup: r.replyMarkup })
      }
    } catch (err) {
      if (isNotModified(err)) {
        await cq.answer({})
        return
      }
      if (!isEmojiInvalid(err)) {
        await cq.answer({ text: 'Failed to load leaderboard.', alert: true })
        return
      }
      try {
        const plain = await renderLeaderboard(scope, period, { groupId, title, invokerId, isDm, plain: true })
        await cq.editMessage({ text: plain.text, replyMarkup: plain.replyMarkup })
      } catch (err2) {
        await cq.answer(isNotModified(err2) ? {} : { text: 'Failed to load leaderboard.', alert: true })
        return
      }
    }
    await cq.answer({})
  })
}
