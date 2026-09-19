import { md } from '@mtcute/markdown-parser'
import { BotKeyboard } from '@mtcute/node'
import { filters } from '@mtcute/dispatcher'
import { dp } from '../client.js'
import { config } from '../config.js'
import { collections } from '../services/mongo.js'
import { lines, paragraphs } from './md.js'
import { memberCountOf } from './chatInfo.js'

const PAGE = 10

const GROUP_TYPES = { $in: ['group', 'supergroup'] as const }

type Rendered = {
  text: ReturnType<typeof md>
  replyMarkup?: ReturnType<typeof BotKeyboard.inline>
}

function ago(date: Date | undefined | null): string {
  if (!date) return 'never'
  const secs = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

function pager(kind: 'ul' | 'gl', page: number, pages: number): ReturnType<typeof BotKeyboard.inline> | undefined {
  if (pages <= 1) return undefined
  const prev = (page - 1 + pages) % pages
  const next = (page + 1) % pages
  return BotKeyboard.inline([
    [
      BotKeyboard.callback('‹ Prev', `${kind}:${prev}`),
      BotKeyboard.callback('Next ›', `${kind}:${next}`),
    ],
  ])
}

export async function renderUsers(page = 0): Promise<Rendered> {
  const filter = { startedAt: { $exists: true } }
  const total = await collections.users.countDocuments(filter)
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const p = Math.min(Math.max(page, 0), pages - 1)

  const docs = await collections.users
    .find(filter)
    .sort({ lastSeenAt: -1 })
    .skip(p * PAGE)
    .limit(PAGE)
    .toArray()

  const header = md`👥 **Users** - **${total.toLocaleString()}** total · page ${String(p + 1)}/${String(pages)}`
  if (docs.length === 0) {
    return { text: paragraphs(header, md`No users yet.`) }
  }

  const rows = docs.map((d, i) => {
    const name = d.firstName || (d.username ? `@${d.username}` : `User ${d._id}`)
    const n = p * PAGE + i + 1
    return md`\`${String(n)}.\` [${name}](tg://user?id=${d._id}) \`${d._id}\` - ${ago(d.lastSeenAt)}`
  })

  return { text: paragraphs(header, lines(...rows)), replyMarkup: pager('ul', p, pages) }
}

export async function renderGroups(page = 0): Promise<Rendered> {
  const total = await collections.chats.countDocuments({ type: GROUP_TYPES })
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const p = Math.min(Math.max(page, 0), pages - 1)

  const docs = await collections.chats
    .find({ type: GROUP_TYPES })
    .sort({ lastActiveAt: -1 })
    .skip(p * PAGE)
    .limit(PAGE)
    .toArray()

  const header = md`💬 **Groups** - **${total.toLocaleString()}** total · page ${String(p + 1)}/${String(pages)}`
  if (docs.length === 0) {
    return { text: paragraphs(header, md`No groups yet.`) }
  }

  const counts = await Promise.all(docs.map((d) => memberCountOf(Number(d._id))))
  const rows = docs.map((d, i) => {
    const n = p * PAGE + i + 1
    const members = counts[i] != null ? `👤 ${counts[i]!.toLocaleString()}` : '👤 -'
    return md`\`${String(n)}.\` **${d.title}** \`${d._id}\` - ${members} · ${ago(d.lastActiveAt)}`
  })

  return { text: paragraphs(header, lines(...rows)), replyMarkup: pager('gl', p, pages) }
}

export function registerAdminListCallbacks(): void {
  dp.onCallbackQuery(filters.regex(/^(ul|gl):(\d+)$/), async (cq) => {
    if (!config.devIds.includes(cq.user.id)) {
      await cq.answer({ text: 'Not allowed.', alert: true })
      return
    }
    const kind = cq.match![1] as 'ul' | 'gl'
    const page = Number(cq.match![2]) || 0
    try {
      const r = kind === 'ul' ? await renderUsers(page) : await renderGroups(page)
      await cq.editMessage({ text: r.text, replyMarkup: r.replyMarkup })
    } catch {
    }
    await cq.answer({})
  })
}
