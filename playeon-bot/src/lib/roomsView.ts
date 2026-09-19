import { md } from '@mtcute/markdown-parser'
import type { TextWithEntities } from '@mtcute/core'
import { BotKeyboard } from '@mtcute/node'
import { filters } from '@mtcute/dispatcher'
import { dp } from '../client.js'
import { lines, paragraphs } from './md.js'
import { roomManager } from '../services/room/RoomManager.js'
import { isDev } from '../core/permissions.js'
import { isNotModified } from './tgErrors.js'

export const ROOMS_PER_PAGE = 8

export type RoomsPage = { text: TextWithEntities; page: number; pages: number; total: number }

export function renderRoomsList(page: number): RoomsPage {
  const rooms = roomManager.activeRooms()
  const total = rooms.length
  if (total === 0) {
    return {
      text: md`🎧 **Active Rooms**\n\nNo rooms are active right now.`,
      page: 0,
      pages: 1,
      total: 0,
    }
  }

  const pages = Math.max(1, Math.ceil(total / ROOMS_PER_PAGE))
  const p = Math.min(Math.max(page, 0), pages - 1)
  const slice = rooms.slice(p * ROOMS_PER_PAGE, p * ROOMS_PER_PAGE + ROOMS_PER_PAGE)

  const items = slice.map((r) => {
    const n = r.participants
    const head = md`•  **${r.title}**  -  ${n.toLocaleString()} ${n === 1 ? 'listener' : 'listeners'}`
    return r.nowPlaying ? lines(head, md`     ▶︎ __${r.nowPlaying}__`) : head
  })

  const header = md`🎧 **Active Rooms**  ·  ${total.toLocaleString()} live`
  const footer = pages > 1 ? md`__Page ${(p + 1).toLocaleString()} / ${pages.toLocaleString()}__` : null
  return { text: paragraphs(header, lines(...items), footer), page: p, pages, total }
}

export function roomsNavKeyboard(
  page: number,
  pages: number,
  prefix: string,
  back?: string,
): ReturnType<typeof BotKeyboard.inline> {
  const rows: ReturnType<typeof BotKeyboard.callback>[][] = []
  if (pages > 1) {
    rows.push([
      BotKeyboard.callback('‹ Prev', `${prefix}:${(page - 1 + pages) % pages}`),
      BotKeyboard.callback(`${page + 1}/${pages}`, `${prefix}:i`),
      BotKeyboard.callback('Next ›', `${prefix}:${(page + 1) % pages}`),
    ])
  }
  if (back) rows.push([BotKeyboard.callback('‹ Back', back)])
  return BotKeyboard.inline(rows)
}

export function registerRoomsView(): void {
  dp.onCallbackQuery(filters.regex(/^rms:(\d+)$/), async (cq) => {
    if (!isDev(cq.user.id)) {
      await cq.answer({ text: 'Developers only.', alert: true })
      return
    }
    const { text, page, pages } = renderRoomsList(Number(cq.match![1]))
    try {
      await cq.editMessage({ text, replyMarkup: roomsNavKeyboard(page, pages, 'rms'), disableWebPreview: true })
    } catch (err) {
      if (!isNotModified(err)) throw err
    }
    await cq.answer({})
  })

  dp.onCallbackQuery(filters.regex(/^rms:i$/), (cq) => cq.answer({}))
}
