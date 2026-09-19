import { tg, dp } from '../../client.js'
import { filters } from '@mtcute/dispatcher'
import { BotKeyboard } from '@mtcute/node'
import { md } from '@mtcute/markdown-parser'
import { sendRichMessage } from '@mtcute/core/methods.js'
import { fmtDuration } from './playcard.js'
import { config } from '../../config.js'
import { roomManager, type RoomCardTrack } from '../room/RoomManager.js'
import { getRecommendedTracks } from '../media/recommendations.js'
import { extractVideoId, type ResolvedTrack } from '../media/musicSource.js'
import { acquireAudio } from '../media/acquire.js'
import { randomUUID } from 'node:crypto'

type RecSession = {
  groupId: string
  tracks: ResolvedTrack[]
  createdAt: number
}

const sessions = new Map<string, RecSession>()
const MAX_SESSIONS = 200

function saveSession(id: string, session: RecSession): void {
  sessions.set(id, session)
  while (sessions.size > MAX_SESSIONS) {
    sessions.delete(sessions.keys().next().value as string)
  }
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Render recommendations as native Telegram Rich Message HTML with <ol> lists and <blockquote>.
 */
export function renderRichRecommendationsHtml(
  finishedTitle: string,
  finishedUrl: string | null | undefined,
  tracks: ResolvedTrack[],
): string {
  const heading = '<b>Recommendations</b>'
  const seedHtml = finishedUrl
    ? `<a href="${escapeHtml(finishedUrl)}"><b>${escapeHtml(finishedTitle)}</b></a>`
    : `<b>${escapeHtml(finishedTitle)}</b>`
  const sub = `<blockquote>Based on ${seedHtml}</blockquote>`

  const items = tracks
    .map((t) => {
      const titleLink = `<a href="${escapeHtml(t.url)}"><b>${escapeHtml(t.title)}</b></a>`
      const artist = t.uploader ? ` - ${escapeHtml(t.uploader)}` : ''
      const duration = t.duration ? ` <code>(${fmtDuration(t.duration)})</code>` : ''
      return `<li>${titleLink}${artist}${duration}</li>`
    })
    .join('\n')

  return `${heading}\n${sub}\n\n<ol>\n${items}\n</ol>\n\n<i>Tap a number below to play next:</i>`
}

/**
 * Fallback markdown text.
 */
export function formatRecCard(
  finishedTitle: string,
  finishedUrl: string | null | undefined,
  tracks: ResolvedTrack[],
): ReturnType<typeof md> {
  const seedLinked = finishedUrl ? md`[**${finishedTitle}**](${finishedUrl})` : md`**${finishedTitle}**`
  const head = md`**Recommendations**\n> Based on ${seedLinked}\n`

  const list = tracks.map((t, i) => {
    const num = `${i + 1}.`
    const duration = t.duration ? ` \`(${fmtDuration(t.duration)})\`` : ''
    const artist = t.uploader ? ` - ${t.uploader}` : ''
    return md`**${num}** [**${t.title}**](${t.url})${artist}${duration}`
  })

  return md`${head}\n${list.reduce((acc, l) => md`${acc}\n${l}`)}\n\n_Tap a number below to play next:_`
}

export function makeRecKeyboard(sessionId: string, count: number): ReturnType<typeof BotKeyboard.inline> {
  const numButtons = []
  for (let i = 0; i < count; i++) {
    numButtons.push(BotKeyboard.callback(`${i + 1}`, `rec:q:${sessionId}:${i}`))
  }

  return BotKeyboard.inline([
    numButtons,
    [BotKeyboard.callback('Close', `rec:close:${sessionId}`)],
  ])
}

export async function sendRoomRecommendations(chatId: number, finished: RoomCardTrack): Promise<void> {
  const groupId = String(chatId)
  const seedId = finished.sourceUrl ? extractVideoId(finished.sourceUrl) : null

  try {
    const prefetched = roomManager.getPrefetchedRecommendations(groupId)
    const history = roomManager.getRecentTrackHistory(groupId)
    const tracks = prefetched && prefetched.length > 0
      ? prefetched.slice(0, 5)
      : await getRecommendedTracks(
          history.length > 0 ? history : [{ id: seedId, title: finished.title }],
          { limit: 5 },
        )

    if (tracks.length === 0) return

    // Double check that queue is still empty and nothing started in the meantime
    const snap = roomManager.getSnapshot(groupId)
    if (snap?.current || (snap?.queue.length ?? 0) > 0) return

    const sessionId = randomUUID().slice(0, 8)
    saveSession(sessionId, {
      groupId,
      tracks,
      createdAt: Date.now(),
    })

    const richHtml = renderRichRecommendationsHtml(finished.title, finished.sourceUrl, tracks)
    const replyMarkup = makeRecKeyboard(sessionId, tracks.length)

    try {
      await sendRichMessage(tg, chatId, {
        content: {
          type: 'html',
          content: richHtml,
        },
        replyMarkup,
      })
    } catch {
      const fallbackText = formatRecCard(finished.title, finished.sourceUrl, tracks)
      await tg.sendText(chatId, fallbackText, {
        replyMarkup,
        disableWebPreview: true,
      }).catch(() => null)
    }
  } catch (err) {
    console.error('[recommendations] Failed to send recommendations card:', err)
  }
}

export function registerRecommendationCardCallbacks(): void {
  // Numeric button tap: rec:q:<sessionId>:<index>
  dp.onCallbackQuery(filters.regex(/^rec:q:([a-f0-9]+):(\d+)$/), async (cq) => {
    const sessionId = cq.match![1]!
    const index = Number(cq.match![2]!)
    const session = sessions.get(sessionId)
    if (!session) {
      await cq.answer({ text: 'This recommendation card has expired.', alert: true })
      return
    }

    const track = session.tracks[index]
    if (!track) {
      await cq.answer({ text: 'Track not found.', alert: true })
      return
    }

    const requesterName = cq.user.displayName
    const requesterId = String(cq.user.id)
    const clientTg = cq.client
    const db = dp.deps.db

    const { position } = roomManager.enqueue({
      groupId: session.groupId,
      title: track.title,
      artist: track.uploader ?? null,
      artistAvatar: track.artistAvatar ?? null,
      lyricsArtist: track.credits ?? null,
      duration: track.duration,
      sourceUrl: track.url,
      thumbnail: track.thumbnail,
      video: false,
      requestedBy: requesterName,
      requestedById: requesterId,
      acquireMedia: () => acquireAudio(clientTg, db, track),
      sourceMode: 'download',
    })

    const actionStr = position === 0 ? 'Playing now' : `Queued at #${position}`
    await cq.answer({ text: `${actionStr}: ${track.title.slice(0, 30)}` })
  })

  // Close button tap: rec:close:<sessionId> -> deletes recommendation message
  dp.onCallbackQuery(filters.regex(/^rec:close:([a-f0-9]+)$/), async (cq) => {
    const sessionId = cq.match![1]!
    sessions.delete(sessionId)
    await cq.client.deleteMessagesById(cq.chat.id, [cq.messageId]).catch(() => {})
    await cq.answer({})
  })
}
