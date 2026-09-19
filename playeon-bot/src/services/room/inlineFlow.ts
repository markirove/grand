import { md } from '@mtcute/markdown-parser'
import { BotInline, BotInlineMessage } from '@mtcute/node'
import { filters } from '@mtcute/dispatcher'
import { dp, botInfo } from '../../client.js'
import { config } from '../../config.js'
import { collections } from '../mongo.js'
import { searchTracks, resolveTrack, extractVideoId, MusicError, type ResolvedTrack } from '../media/musicSource.js'
import { fmtDuration, inlineLookupCard } from '../playback/playcard.js'
import { parseLoopCount } from '../media/parse.js'
import { getCancel, sameUser } from '../playback/cancel.js'
import { joinRoomKeyboard, inlineJoinRoomKeyboard, roomInviteMessage } from './roomLink.js'
import { touchUserActive } from '../stats.js'
import { canControlRoomId } from '../auth/playbackControl.js'
import { roomManager } from './RoomManager.js'
import { performRoomPlayInto, performRoomControlInline, type InlineControl } from './roomFlow.js'
import { INLINE_COMMANDS, type InlineCommandAction } from './inlineCommands.js'
import { INFO_EMOJI, WARNING_EMOJI, ERROR_EMOJI } from '../../lib/feedback.js'

const MAX_RESULTS = 12
const INLINE_ICON_BASE_URL = `${config.webPublicUrl}/assets/`
const SEARCH_THUMB = `${INLINE_ICON_BASE_URL}search-inline-v10.png`
const INVITE_THUMB = `${INLINE_ICON_BASE_URL}invite-inline-v10.png`
const UNKNOWN_THUMB = `${INLINE_ICON_BASE_URL}unknown-inline-v10.png`
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/

const titleById = new Map<string, string>()
const TITLE_CACHE_MAX = 300
function rememberTitle(id: string, title: string): void {
  titleById.delete(id)
  titleById.set(id, title)
  if (titleById.size > TITLE_CACHE_MAX) {
    const oldest = titleById.keys().next().value
    if (oldest !== undefined) titleById.delete(oldest)
  }
}

function targetRoomFor(userId: number): string {
  return roomManager.currentRoomOf(String(userId)) ?? String(userId)
}

function commandRoomFor(userId: number): string | null {
  const uid = String(userId)
  return roomManager.currentRoomOf(uid) ?? (roomManager.isActive(uid) ? uid : null)
}

const COMMAND_THUMB: Partial<Record<InlineCommandAction, string>> = {
  pause: `${INLINE_ICON_BASE_URL}pause-inline-v10.png`,
  resume: `${INLINE_ICON_BASE_URL}resume-inline-v10.png`,
  skip: `${INLINE_ICON_BASE_URL}skip-inline-v10.png`,
  end: `${INLINE_ICON_BASE_URL}end-inline-v10.png`,
  queue: `${INLINE_ICON_BASE_URL}queue-inline-v10.png`,
  loop: `${INLINE_ICON_BASE_URL}loop-inline-v10.png`,
}

function commandThumb(action: InlineCommandAction): string {
  return COMMAND_THUMB[action] ?? SEARCH_THUMB
}

const COMMAND_PLACEHOLDER: Record<InlineCommandAction, string> = {
  pause: 'Pausing your room…',
  resume: 'Resuming your room…',
  skip: 'Skipping…',
  end: 'Ending playback…',
  queue: 'Fetching your queue…',
  loop: 'Setting loop…',
}

async function answerCommandQuery(iq: Parameters<Parameters<typeof dp.onInlineQuery>[0]>[0]): Promise<void> {
  const raw = iq.query.trim().slice(1)
  const word = raw.split(/\s+/, 1)[0]!.toLowerCase()
  const arg = raw.slice(word.length).trim()
  const kb = inlineJoinRoomKeyboard(commandRoomFor(iq.user.id) ?? String(iq.user.id))

  const matches = INLINE_COMMANDS.filter((c) => c.name.startsWith(word))
  if (matches.length === 0) {
    await iq.answer(
      [
        noticeArticle(
          'cmd-none',
          'Unknown command',
          `No command matches /${word}`,
          md`No command matches **/${word}**. Try \`/pause\`, \`/skip\`, \`/seek 1:30\`, \`/queue\`…`,
          UNKNOWN_THUMB,
        ),
      ],
      { cacheTime: 10, private: true },
    )
    return
  }

  const results = matches.map((c) => (c.name === 'loop' ? buildLoopArticle(arg, kb) : buildCommandArticle(c, kb)))
  await iq.answer(results, { cacheTime: 3, private: true })
}

async function answerInviteQuery(iq: Parameters<Parameters<typeof dp.onInlineQuery>[0]>[0]): Promise<void> {
  const { text, replyMarkup } = roomInviteMessage(iq.user.displayName, String(iq.user.id))
  const result = BotInline.article('invite', {
    title: 'Invite to your room',
    description: 'Send a shareable invite to watch together in your room',
    thumb: INVITE_THUMB,
    message: BotInlineMessage.text(text, { replyMarkup }),
  })
  await iq.answer([result], { cacheTime: 5, private: true })
}

function buildCommandArticle(
  c: (typeof INLINE_COMMANDS)[number],
  kb: ReturnType<typeof joinRoomKeyboard>,
): ReturnType<typeof BotInline.article> {
  return BotInline.article(`cmd:${c.name}`, {
    title: c.title,
    description: c.description,
    thumb: commandThumb(c.name),
    message: BotInlineMessage.text(md`${COMMAND_PLACEHOLDER[c.name]}`, { replyMarkup: kb }),
  })
}

function buildLoopArticle(arg: string, kb: ReturnType<typeof joinRoomKeyboard>): ReturnType<typeof BotInline.article> {
  const parsed = parseLoopCount(arg)
  const count = arg === '' ? 1 : (parsed ?? 1)
  const description =
    count === 0 ? 'Turn looping off' : `Repeat the current track ${count} time${count === 1 ? '' : 's'}`
  return BotInline.article(`cmd:loop:${count}`, {
    title: 'Loop',
    description,
    thumb: commandThumb('loop'),
    message: BotInlineMessage.text(md`${COMMAND_PLACEHOLDER.loop}`, { replyMarkup: kb }),
  })
}

function parseControlId(id: string): InlineControl | null {
  const rest = id.slice('cmd:'.length)
  if (rest === 'pause' || rest === 'resume' || rest === 'skip' || rest === 'end' || rest === 'queue') {
    return { action: rest }
  }
  const loop = rest.match(/^loop:(\d+)$/)
  if (loop) return { action: 'loop', count: Math.min(Number(loop[1]), 100) }
  return null
}

async function runChosenCommand(
  chosen: Parameters<Parameters<typeof dp.onChosenInlineResult>[0]>[0],
  id: string,
): Promise<void> {
  const messageId = chosen.messageId
  if (!messageId) return
  const user = chosen.user
  const room = commandRoomFor(user.id)
  const control = parseControlId(id)
  const kb = control?.action === 'queue' ? inlineJoinRoomKeyboard(room ?? String(user.id)) : undefined
  /*
    Every inline command answers through here, and none of them wants a preview.

    The queue card links each track it lists, so Telegram would pick one of
    them and paste its video card underneath a message that is already a list.
  */
  const paint = (text: ReturnType<typeof md>): Promise<unknown> =>
    chosen
      .editMessage({ messageId, text, replyMarkup: kb, disableWebPreview: true })
      .catch(() => {})

  if (!room) {
    await paint(md`${INFO_EMOJI} You're not in an active room. Open your room (or play something) first, then try again.`)
    return
  }
  if (!control) {
    await paint(md`${WARNING_EMOJI} I didn't recognize that command. Try \`/pause\`, \`/skip\`, \`/end\`, \`/queue\`…`)
    return
  }
  if (control.action !== 'queue' && !(await canControlRoomId(room, user.id))) {
    await paint(md`${WARNING_EMOJI} You don't have permission to control this room's playback.`)
    return
  }
  try {
    const text = await performRoomControlInline(chosen.client, room, control, user.displayName, String(user.id))
    await paint(text)
  } catch (err) {
    console.error('[inline] command failed:', err)
    await paint(md`${ERROR_EMOJI} Couldn't run that just now - try again.`)
  }
}

function noticeArticle(
  id: string,
  title: string,
  description: string,
  body: ReturnType<typeof md>,
  thumb: string = SEARCH_THUMB,
): ReturnType<typeof BotInline.article> {
  return BotInline.article(id, { title, description, thumb, message: BotInlineMessage.text(body) })
}

export function registerInlineHandlers(): void {
  dp.onInlineQuery(async (iq) => {
    let query = iq.query.trim()

    // no `started`: inline mode works without ever having opened a DM
    touchUserActive(iq.user)

    if (/^\/?invite$/i.test(query)) {
      await answerInviteQuery(iq)
      return
    }

    if (query.startsWith('/')) {
      const room = commandRoomFor(iq.user.id)
      const controllable = !!room && !!roomManager.getSnapshot(room)?.current
      if (controllable) {
        await answerCommandQuery(iq)
        return
      }
      query = query.slice(1).trim()
    }

    if (!query) {
      await iq.answer(
        [
          noticeArticle(
            'hint',
            'Search YouTube',
            'Type a song or video name, or paste a link, to play in your room',
            md`Type a name (or paste a YouTube link) after @${botInfo.username}, then tap a result to play it in your room.`,
          ),
        ],
        { cacheTime: 10, private: true },
      )
      return
    }

    const linkId = extractVideoId(query)
    let tracks: ResolvedTrack[]
    try {
      tracks = linkId ? [await resolveTrack(query)] : await searchTracks(query, MAX_RESULTS)
    } catch (err) {
      const reason = err instanceof MusicError ? err.message : 'search failed'
      await iq.answer(
        [noticeArticle('error', "Couldn't search", reason, md`${reason}. Try a different search.`)],
        { cacheTime: 5, private: true },
      )
      return
    }

    if (tracks.length === 0) {
      await iq.answer(
        [noticeArticle('empty', 'No results', `Nothing found for "${query}"`, md`No results for **${query}**.`)],
        { cacheTime: 15, private: true },
      )
      return
    }

    const roomKb = inlineJoinRoomKeyboard(targetRoomFor(iq.user.id))
    const results = tracks.map((t) => {
      const dur = t.duration != null ? fmtDuration(t.duration) : 'live'
      const description = t.uploader ? `${t.uploader} · ${dur}` : dur
      rememberTitle(t.id, t.title)
      return BotInline.article(t.id, {
        title: t.title,
        description,
        thumb: t.thumbnail ?? SEARCH_THUMB,
        /*
          The card names a track and links it, and Telegram would answer that
          by pasting the video's whole preview under a one-line message. The
          download card that replaces it seconds later carries the artwork
          properly, as an inverted media embed.
        */
        message: BotInlineMessage.text(inlineLookupCard(t.title, t.url), {
          replyMarkup: roomKb,
          disableWebPreview: true,
        }),
      })
    })

    await iq.answer(results, { cacheTime: 60, private: true })
  })

  dp.onChosenInlineResult(async (chosen) => {
    const videoId = chosen.id
    if (videoId.startsWith('cmd:')) {
      await runChosenCommand(chosen, videoId)
      return
    }
    if (!VIDEO_ID_RE.test(videoId)) return

    const user = chosen.user
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`
    const roomGroupId = targetRoomFor(user.id)
    const inlineMessageId = chosen.messageId ?? undefined
    const title = titleById.get(videoId)

    let ok = false
    try {
      const res = await performRoomPlayInto(
        chosen.client,
        collections,
        roomGroupId,
        watchUrl,
        user.displayName,
        String(user.id),
        inlineMessageId,
        title,
      )
      ok = res.ok
    } catch (err) {
      console.error('[inline] room play failed:', err)
    }

    if (ok || !chosen.messageId) return
    const isPersonal = roomGroupId === String(user.id)
    const text = isPersonal
      ? md`${INFO_EMOJI} Start a chat with @${botInfo.username} first (open it and tap **Start**), then try again.`
      : md`${INFO_EMOJI} I couldn't reach that room's chat - make sure I'm still in it, then try again.`
    await chosen
      .editMessage({
        messageId: chosen.messageId,
        text,
        replyMarkup: joinRoomKeyboard(roomGroupId),
        disableWebPreview: true,
      })
      .catch(() => {})
  })

  dp.onInlineCallbackQuery(filters.regex(/^pbi:cancel:(-?\d+):(\d+)$/), async (cq) => {
    const chatId = Number(cq.match![1])
    const statusMessageId = Number(cq.match![2])
    const entry = getCancel(chatId, statusMessageId)
    if (!entry) {
      await cq.answer({ text: 'This interaction is no longer valid', alert: true })
      await cq.editMessage({ replyMarkup: undefined }).catch(() => {})
      return
    }
    if (!sameUser(entry.requesterId, cq.user.id)) {
      await cq.answer({ text: 'Only the person who requested this can cancel it', alert: true })
      return
    }
    entry.abort()
    await cq.answer({ text: 'Canceling…' })
  })
}
