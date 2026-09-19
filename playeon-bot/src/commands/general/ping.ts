import { emojiTag } from '../../lib/emoji.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'
import { md } from '@mtcute/markdown-parser'
import type { TextWithEntities } from '@mtcute/core'
import { BotKeyboard } from '@mtcute/node'
import { filters } from '@mtcute/dispatcher'
import { defineCommand, Role } from '../../core/command.js'
import { dp } from '../../client.js'
import { lines, paragraphs } from '../../lib/md.js'
import { emojiCallbackButton } from '../../lib/keyboard.js'
import { roomManager } from '../../services/room/RoomManager.js'
import { renderRoomsList, roomsNavKeyboard } from '../../lib/roomsView.js'
import { isDev } from '../../core/permissions.js'
import { isNotModified } from '../../lib/tgErrors.js'
import { formatBytes } from '../../lib/format.js'

const execFileAsync = promisify(execFile)

const PONG = emojiTag('🏓', '5269563867305879894')

function formatSpeed(mbps: number): string {
  return mbps >= 1000 ? `${(mbps / 1000).toFixed(1)} GBPS` : `${mbps.toFixed(1)} MBPS`
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const parts = [
    d ? `${d}d` : '',
    h ? `${h}h` : '',
    m ? `${m}m` : '',
    !d && !h ? `${s}s` : '',
  ].filter(Boolean)
  return parts.join(' ') || '0s'
}

async function sampleCpuPercent(): Promise<number> {
  const startUsage = process.cpuUsage()
  const startTime = Date.now()
  await sleep(120)
  const diff = process.cpuUsage(startUsage)
  const elapsedMs = Date.now() - startTime
  const cpuMs = (diff.user + diff.system) / 1000
  return (cpuMs / elapsedMs) * 100
}

type Sys = { ram: string; cpu: string; uptime: string; rooms: number }

async function systemInfo(): Promise<Sys> {
  const mem = process.memoryUsage()
  const cpu = await sampleCpuPercent()
  return {
    ram: formatBytes(mem.rss),
    cpu: `${cpu.toFixed(1)}%`,
    uptime: formatUptime(process.uptime()),
    rooms: roomManager.activeRoomCount(),
  }
}

type SpeedOk = { down: string; up: string; imageUrl?: string }
type Speed = SpeedOk | { error: string }

const isEnoent = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'

async function runSpeedtest(): Promise<Speed> {
  try {
    const { stdout } = await execFileAsync(
      'speedtest',
      ['--format=json', '--accept-license', '--accept-gdpr'],
      { timeout: 90_000, maxBuffer: 1 << 20 },
    )
    const d = JSON.parse(stdout)
    return {
      down: formatSpeed((d.download.bandwidth * 8) / 1e6),
      up: formatSpeed((d.upload.bandwidth * 8) / 1e6),
      imageUrl: typeof d.result?.url === 'string' ? `${d.result.url}.png` : undefined,
    }
  } catch (ooklaErr) {
    try {
      const { stdout } = await execFileAsync('speedtest-cli', ['--json', '--share'], {
        timeout: 90_000,
        maxBuffer: 1 << 20,
      })
      const d = JSON.parse(stdout)
      return {
        down: formatSpeed(d.download / 1e6),
        up: formatSpeed(d.upload / 1e6),
        imageUrl: typeof d.share === 'string' ? d.share : undefined,
      }
    } catch (pyErr) {
      if (isEnoent(ooklaErr) && isEnoent(pyErr)) {
        return { error: 'speedtest CLI is not installed on the host.' }
      }
      return { error: 'speedtest failed to run.' }
    }
  }
}

function cover(url?: string): string {
  return url ? `[⁠](${url})` : ''
}

function pingHead(latency: number | null, coverUrl?: string): TextWithEntities {
  return md`${md(`${cover(coverUrl)}${PONG}`)} **Pong!**  ·  **${latency == null ? '-' : `${latency}ms`}**`
}

function pingText(latency: number | null, sys: Sys, speed?: SpeedOk, status?: TextWithEntities): TextWithEntities {
  const head = pingHead(latency, speed?.imageUrl)
  const system = lines(
    md`**System**`,
    md`•  RAM  -  ${sys.ram}`,
    md`•  CPU  -  ${sys.cpu}`,
    md`•  Uptime  -  ${sys.uptime}`,
    md`•  Active Rooms  -  ${sys.rooms.toLocaleString()}`,
  )
  const speedBlock = speed
    ? lines(md`**Speed Test**`, md`•  Download  -  ${speed.down}`, md`•  Upload  -  ${speed.up}`)
    : null
  return paragraphs(head, system, speedBlock, status ?? null)
}

function previewOpts(speed?: SpeedOk): { invertMedia: boolean; disableWebPreview: boolean } {
  return speed?.imageUrl
    ? { invertMedia: true, disableWebPreview: false }
    : { invertMedia: false, disableWebPreview: true }
}

function pingKeyboard(hasSpeed: boolean, rooms: number): ReturnType<typeof BotKeyboard.inline> | undefined {
  const row: ReturnType<typeof BotKeyboard.callback>[] = []
  if (!hasSpeed) row.push(emojiCallbackButton('Test Speed', 'png:sp', '5936170807716745162'))
  if (rooms > 0) row.push(BotKeyboard.callback('📋 View Rooms', 'png:rm:0'))
  return row.length ? BotKeyboard.inline([row]) : undefined
}

type Session = { latency: number; speed?: SpeedOk }
const sessions = new Map<string, Session>()
const MAX_SESSIONS = 300
const sessKey = (chatId: number, msgId: number): string => `${chatId}:${msgId}`

function remember(chatId: number, msgId: number, s: Session): void {
  sessions.set(sessKey(chatId, msgId), s)
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value as string)
}

export default defineCommand({
  name: 'ping',
  aliases: ['hello'],
  order: 7,
  description: 'Check the bot latency (developers also get a resource report).',
  usage: '/ping',
  category: 'general',
  contexts: 'any',
  reply: true,
  roles: [Role.USER],
  hidden: true,

  handler: async (ctx) => {
    const { msg, tg, role } = ctx

    const start = Date.now()
    const sent = await msg.answerText(md`${md(PONG)} Pinging…`)
    const latency = Date.now() - start
    const chatId = sent.chat.id

    if (!(role.mask & Role.DEV)) {
      await tg.editMessage({
        chatId,
        message: sent.id,
        text: pingHead(latency),
        disableWebPreview: true,
      })
      return
    }

    const sys = await systemInfo()
    await tg.editMessage({
      chatId,
      message: sent.id,
      text: pingText(latency, sys),
      replyMarkup: pingKeyboard(false, sys.rooms),
      invertMedia: false,
      disableWebPreview: true,
    })
    remember(chatId, sent.id, { latency })
  },
})

export function registerPingCallbacks(): void {
  dp.onCallbackQuery(filters.regex(/^png:sp$/), async (cq) => {
    if (!isDev(cq.user.id)) {
      await cq.answer({ text: 'Developers only.', alert: true })
      return
    }
    const chatId = cq.chat.id
    const msgId = cq.messageId
    const latency = sessions.get(sessKey(chatId, msgId))?.latency ?? null
    await cq.answer({ text: 'Running speed test' })

    const sys1 = await systemInfo()
    await cq.client
      .editMessage({
        chatId,
        message: msgId,
        text: pingText(latency, sys1, undefined, md`__Running speed test__`),
        replyMarkup: pingKeyboard(true, sys1.rooms),
        invertMedia: false,
        disableWebPreview: true,
      })
      .catch(() => {})

    const result = await runSpeedtest()
    const sys2 = await systemInfo()
    if ('error' in result) {
      await cq.client
        .editMessage({
          chatId,
          message: msgId,
          text: pingText(latency, sys2, undefined, md`**Speed Test** - ${result.error}`),
          replyMarkup: pingKeyboard(false, sys2.rooms),
          invertMedia: false,
          disableWebPreview: true,
        })
        .catch(() => {})
      return
    }

    remember(chatId, msgId, { latency: latency ?? 0, speed: result })
    await cq.client
      .editMessage({
        chatId,
        message: msgId,
        text: pingText(latency, sys2, result),
        replyMarkup: pingKeyboard(true, sys2.rooms),
        ...previewOpts(result),
      })
      .catch(() => {})
  })

  dp.onCallbackQuery(filters.regex(/^png:rm:(\d+)$/), async (cq) => {
    if (!isDev(cq.user.id)) {
      await cq.answer({ text: 'Developers only.', alert: true })
      return
    }
    const { text, page, pages } = renderRoomsList(Number(cq.match![1]))
    try {
      await cq.client.editMessage({
        chatId: cq.chat.id,
        message: cq.messageId,
        text,
        replyMarkup: roomsNavKeyboard(page, pages, 'png:rm', 'png:bk'),
        invertMedia: false,
        disableWebPreview: true,
      })
    } catch (err) {
      if (!isNotModified(err)) throw err
    }
    await cq.answer({})
  })
  dp.onCallbackQuery(filters.regex(/^png:rm:i$/), (cq) => cq.answer({}))

  dp.onCallbackQuery(filters.regex(/^png:bk$/), async (cq) => {
    if (!isDev(cq.user.id)) {
      await cq.answer({ text: 'Developers only.', alert: true })
      return
    }
    const sess = sessions.get(sessKey(cq.chat.id, cq.messageId))
    const sys = await systemInfo()
    try {
      await cq.client.editMessage({
        chatId: cq.chat.id,
        message: cq.messageId,
        text: pingText(sess?.latency ?? null, sys, sess?.speed),
        replyMarkup: pingKeyboard(!!sess?.speed, sys.rooms),
        ...previewOpts(sess?.speed),
      })
    } catch (err) {
      if (!isNotModified(err)) throw err
    }
    await cq.answer({})
  })
}
