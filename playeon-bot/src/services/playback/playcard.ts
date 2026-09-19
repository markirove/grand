import { emojiTag, WORD_JOINER, PLAY_EMOJI_ID, PAUSE_EMOJI_ID, SKIP_EMOJI_ID, CANCEL_EMOJI_ID, TEXT_PAUSE_EMOJI_ID, TEXT_PLAY_EMOJI_ID, TEXT_SKIP_EMOJI_ID, TEXT_END_EMOJI_ID, TOGGLE_EMOJI_ID, PROGRESS_BAR_EMOJIS } from '../../lib/emoji.js'
import Long from 'long'
import { md } from '@mtcute/markdown-parser'
import { BotKeyboard, tl } from '@mtcute/node'
import { botInfo } from '../../client.js'
import { config } from '../../config.js'
import { SUCCESS_EMOJI, INFO_EMOJI } from '../../lib/feedback.js'
import { mentionOr as mention } from '../../lib/mention.js'

export type CardInfo = {
  title: string
  /** The track's own page, when it has one. See {@link titleOf}. */
  sourceUrl?: string | null
  duration: number | null
  requestedBy: string
  requestedById: number | string
  video: boolean
  thumbnail: string | null
  videoHeight?: number | null
}

/**
 * The title, linked to wherever the track came from.
 *
 * A title on a card is the one thing a reader might want to act on - to open
 * the original, check the upload, share it on - and it was flat text, so the
 * only route back was to search for it again. Every source we resolve from
 * hands us its page for free.
 *
 * Falls back to plain text rather than a dead link: a track lifted off a
 * replied Telegram file has no page, and a link that goes nowhere is worse
 * than no link.
 */
export function titleOf(info: Pick<CardInfo, 'title' | 'sourceUrl'>): ReturnType<typeof md> {
  return info.sourceUrl ? md`[${info.title}](${info.sourceUrl})` : md`${info.title}`
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || sec < 0) return 'live'
  /*
    Floored first, not just divided.

    The seconds field was `sec % 60` on whatever it was handed, which is exact
    for a track length and wrong for a playback position: those are fractional,
    and the card printed `0:13.997`. One floor at the top fixes every caller at
    once.
  */
  const whole = Math.floor(sec)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

const EMOJI = {
  lookup: { char: '🔎', id: '6100663669991940492' },
  downloading: { char: '⬇️', id: '6102939671946338698' },
  nowAudio: { char: '🎵', id: '6102591453177850414' },
  nowVideoHi: { char: '🎬', id: '6102916384633659626' },
  nowVideo: { char: '🎬', id: '6102916384633659626' },
  duration: { char: '🕒', id: '5778605968208170641' },
  requestor: { char: '👤', id: '5879770735999717115' },
  queued: { char: '📋', id: '6102801751956529285' },
  skip: { char: '⏭️', id: TEXT_SKIP_EMOJI_ID },
  pause: { char: '⏸️', id: TEXT_PAUSE_EMOJI_ID },
  resume: { char: '▶️', id: TEXT_PLAY_EMOJI_ID },
  end: { char: '⏹️', id: TEXT_END_EMOJI_ID },
  roomHint: { char: '📺', id: '5836749569014109509' },
} as const

function emoji(e: { char: string; id: string }): string {
  return emojiTag(e.char, e.id)
}

export const PAUSE_EMOJI = md(emoji(EMOJI.pause))
export const RESUME_EMOJI = md(emoji(EMOJI.resume))

const HI_RES_HEIGHT = 1440

function nowGlyph(info: Pick<CardInfo, 'video' | 'videoHeight'>): { char: string; id: string } {
  if (!info.video) return EMOJI.nowAudio
  return (info.videoHeight ?? 0) >= HI_RES_HEIGHT ? EMOJI.nowVideoHi : EMOJI.nowVideo
}

function verb(info: Pick<CardInfo, 'video'>, finished = false): string {
  const state = finished ? 'Finished' : 'Now'
  return info.video ? `${state} Streaming` : `${state} Playing`
}

export function coverEmbed(thumbnail: string | null | undefined): boolean {
  return !!thumbnail && config.features.thumbnailEmbed
}

function coverLink(thumbnail: string | null | undefined): string {
  return coverEmbed(thumbnail) ? `[⁠](${thumbnail})` : ''
}

/**
 * The track's length, and only its length.
 *
 * This used to lead with an elapsed reading - `1:20 / 3:45` - from when the
 * card repainted on a timer. That tick is gone (see `roomCards`), so the figure
 * could only ever be as old as the last transport event, and on a freshly
 * started track there has not been one: every new card opened reading
 * `0:00 / 3:45` and sat there, which reads as a player that failed to start
 * rather than as a length.
 *
 * The running position lives on the web player, which has a clock that actually
 * moves. A card in a chat is a record of what was put on, and a length is the
 * part of that which stays true.
 */
export function durationLine(duration: number | null | undefined): ReturnType<typeof md> {
  return md`**Duration:** ${fmtDuration(duration)}`
}

function nowPlayingHeader(
  info: Pick<CardInfo, 'title' | 'sourceUrl' | 'duration' | 'video' | 'videoHeight'> & { thumbnail?: string | null },
  cover = false,
): ReturnType<typeof md> {
  const glyph = cover ? `${coverLink(info.thumbnail)}${emoji(nowGlyph(info))}` : emoji(nowGlyph(info))
  return md`${md(glyph)} **${verb(info)}**\n${titleOf(info)}\n\n${durationLine(info.duration)}`
}

function isYou(actorId: string | number | null | undefined, youId: string | number | null | undefined): boolean {
  return youId != null && youId !== '' && String(actorId) === String(youId)
}

export function requestorLine(
  info: Pick<CardInfo, 'requestedBy' | 'requestedById'>,
  youId?: string | number | null,
): ReturnType<typeof md> {
  const isAutoplay =
    info.requestedBy === 'Playeon' ||
    info.requestedBy === 'Autoplay' ||
    (botInfo.id && String(info.requestedById) === String(botInfo.id))

  if (isAutoplay) {
    const name = botInfo.displayName || 'Playeon'
    const who = botInfo.id
      ? md`**[${name}](tg://user?id=${botInfo.id})**`
      : md`**${name}**`
    return md`**Requested By:** ${who}`
  }

  const who = isYou(info.requestedById, youId)
    ? mention('You', info.requestedById)
    : mention(info.requestedBy, info.requestedById)
  return md`**Requested By:** ${who}`
}

/**
 * The card's closing line, and its call to action.
 *
 * It points at the button directly below it rather than describing the room in
 * the abstract - "Open the web room" named no control anyone could see, and
 * left the reader to work out that the thing to press was the one marked Join
 * Room. Kept in step with `roomControlsKeyboard`: if that label changes, this
 * sentence is wrong.
 *
 * Deliberately the same words as `roomInviteMessage`. The invite is where the
 * product gets explained - together, in sync, all of it - so by the time this
 * card is on screen the reader has either had that pitch or does not need it.
 * Repeating it every track would nag, and it is the same door either way, so
 * it is worth it being the same phrase.
 */
function joinHint(): ReturnType<typeof md> {
  return md`Tap **Join Room** below to hop in.`
}

export function nowPlayingCard(
  info: CardInfo,
  opts: { you?: string | number | null } = {},
): ReturnType<typeof md> {
  const head = md(`${coverLink(info.thumbnail)}${emoji(nowGlyph(info))}`)
  return md`${head} **${verb(info)}**\n${titleOf(info)}\n\n${durationLine(info.duration)}\n${requestorLine(info, opts.you)}\n\n${joinHint()}`
}

export function finishedCard(info: CardInfo, youId?: string | number | null): ReturnType<typeof md> {
  return md`${SUCCESS_EMOJI} **${verb(info, true)}**\n${titleOf(info)}\n\n${durationLine(info.duration)}\n${requestorLine(info, youId)}`
}

/**
 * The bot's own page, used as somewhere for a query to point.
 *
 * `botInfo` is filled in at boot, so this can be empty for the first moments of
 * a process and the caller has to cope rather than emit a broken link.
 */
function botLink(): string | null {
  const username = config.room.botUsername || botInfo.username
  return username ? `https://t.me/${username}` : null
}

export function lookupCard(query: string): ReturnType<typeof md> {
  /*
    The query is a link to the bot, for the colour rather than the destination.

    There is nothing to link a search phrase to: the track it will become does
    not exist yet, and that is the whole state this card describes. But a plain
    run of grey text after a bold label reads as a fragment, and the phrase is
    the one part of the line the reader supplied and wants to check. Pointing it
    at the bot makes it blue, and lands somewhere harmless if anybody taps it.
  */
  const link = botLink()
  return link
    ? md`${md(emoji(EMOJI.lookup))} **Searching for** [${query}](${link})`
    : md`${md(emoji(EMOJI.lookup))} **Searching for** ${query}`
}

/**
 * The first thing an inline pick posts, while the track is still being found.
 *
 * The title is a link wherever one is known, for the same reason it is on every
 * other card: the track has a page, somebody reading the message may want it,
 * and this message can sit in the chat for a few seconds before anything
 * replaces it. Falls back to plain text when there is no page to point at, such
 * as a track lifted off a replied file.
 */
export function inlineLookupCard(
  title?: string | null,
  sourceUrl?: string | null,
): ReturnType<typeof md> {
  /*
    "Fetching", not "Searching for".

    These two cards look alike and are not the same moment. The other one goes
    out while a phrase is being turned into a track, which is a search. This one
    goes out after somebody picked an exact result, so the searching is over and
    the bot is resolving a URL it already has. Saying it is searching describes
    work that finished before the message existed.

    Without a title there is nothing to fetch by name yet, so that case keeps
    the search wording.
  */
  if (!title) return md`${md(emoji(EMOJI.lookup))} **Searching for your track**`
  /*
    No trailing ellipsis.

    The card is replaced the moment the track resolves, so the dots were saying
    "still working" to somebody who is about to watch the message change on its
    own. What they actually did was leave a gap after a linked title, which
    reads as a typo rather than as patience.
  */
  return md`${md(emoji(EMOJI.lookup))} **Fetching** ${titleOf({
    title,
    sourceUrl,
  })}`
}

export function inlineNowPlayingCard(info: CardInfo): ReturnType<typeof md> {
  return nowPlayingHeader(info, true)
}

/**
 * The card of a track that was interrupted by a forced play.
 *
 * Its own state, because neither of the two we had describes it. "Finished" is
 * a lie - it did not finish, and its card sitting in the chat saying so is the
 * bug this fixes. "Skipped" is a different lie: skipping throws a track away,
 * and this one is first in the queue with its second saved.
 */
export function postponedCard(
  info: Pick<CardInfo, 'title' | 'sourceUrl' | 'video'>,
  opts: { at?: number | null; name?: string; id?: string | number | null; youId?: string | number | null },
): ReturnType<typeof md> {
  const who = opts.name ? actorLabel(opts.name, opts.id, opts.youId) : null
  const head = who ? md`**Postponed By** ${who}` : md`**Postponed**`
  const tail =
    opts.at != null && opts.at > 0
      ? md`Picks up at **${fmtDuration(opts.at)}** once the new track ends.`
      : md`Starts again once the new track ends.`
  return md`${md(emoji(EMOJI.pause))} ${head}\n${titleOf(info)}\n\n${tail}`
}

export function queuedCard(
  info: Pick<CardInfo, 'title' | 'sourceUrl' | 'duration' | 'requestedBy' | 'requestedById'>,
  position: number,
  opts: { where?: string; you?: string | number | null; requestor?: boolean } = {},
): ReturnType<typeof md> {
  const head = opts.where
    ? md`${md(emoji(EMOJI.queued))} **Added to the ${opts.where} queue · #${position}**`
    : md`${md(emoji(EMOJI.queued))} **Added to the queue · #${position}**`
  const body = md`${head}\n${titleOf(info)}\n\n${durationLine(info.duration)}`
  return opts.requestor === false ? body : md`${body}\n${requestorLine(info, opts.you)}`
}

export type PlaylistCardInfo = {
  title: string
  sourceUrl?: string | null
  trackCount: number
  totalDuration?: number | null
  requestedBy: string
  requestedById: number | string
  thumbnail?: string | null
}

export function playlistQueuedCard(
  info: PlaylistCardInfo,
  position: number,
  opts: { where?: string; you?: string | number | null; requestor?: boolean } = {},
): ReturnType<typeof md> {
  const head = opts.where
    ? md`${md(emoji(EMOJI.queued))} **Added playlist to the ${opts.where} queue · #${position}**`
    : md`${md(emoji(EMOJI.queued))} **Added playlist to the queue · #${position}**`
  const durStr = info.totalDuration ? ` \`(${fmtDuration(info.totalDuration)})\`` : ''
  const s = info.trackCount === 1 ? '' : 's'
  const countLine = md`**Tracks Added:** ${info.trackCount} track${s}${durStr}`
  const body = md`${head}\n${titleOf(info)}\n\n${countLine}`
  return opts.requestor === false ? body : md`${body}\n${requestorLine(info, opts.you)}`
}

export function inlineQueueCard(
  current: Pick<CardInfo, 'title' | 'sourceUrl' | 'duration' | 'video' | 'videoHeight' | 'requestedBy'> & {
    requestedById?: number | string | null
  },
  upNext: { title: string; duration: number | null; sourceUrl?: string | null }[],
): ReturnType<typeof md> {
  /*
    The head names what is on and nothing else.

    A queue card is a list, and the entry at the top of it was carrying a
    duration and a requested-by line that none of the entries below it had. The
    question being asked is "what is on and what is next", and the answer to the
    first half is one line long.
  */
  const head = md`${md(emoji(nowGlyph(current)))} **${verb(current)}**\n${titleOf(current)}`
  if (upNext.length === 0) return md`${head}\n\n${INFO_EMOJI} Nothing else queued.`

  const shown = upNext.slice(0, 5)
  const extra = upNext.length - shown.length
  const count = md`**Up Next (${upNext.length}):**`
  const lines = joinLines(
    shown.map((t, i) => md`\`${i + 1}.\` ${titleOf(t)} \`(${fmtDuration(t.duration)})\``),
  )
  return extra > 0 ? md`${head}\n\n${count}\n${lines}\n+${extra} more` : md`${head}\n\n${count}\n${lines}`
}

export function downloadingCard(
  info: CardInfo,
  progress: { percent?: number | null } = {},
): ReturnType<typeof md> {
  const head = md(`${coverLink(info.thumbnail)}${emoji(EMOJI.downloading)}`)
  const title = md`${head} **Downloading**\n${titleOf(info)} \`(${fmtDuration(info.duration)})\``
  return progress.percent != null ? md`${title}\n\n${progressBar(progress.percent)}` : title
}

const PREMIUM_BAR_CELLS = 9
const GLYPH_BAR_CELLS = 11

export function premiumProgressBar(percent: number, cells = PREMIUM_BAR_CELLS): ReturnType<typeof md> {
  const pct = Math.max(0, Math.min(100, percent))
  const filled = Math.round((pct / 100) * cells)

  let barStr = ''
  for (let i = 0; i < cells; i++) {
    const isFilled = i < filled
    let docId: string
    if (i === 0) {
      docId = isFilled ? PROGRESS_BAR_EMOJIS.fillLeft : PROGRESS_BAR_EMOJIS.outlineLeft
    } else if (i === cells - 1) {
      docId = isFilled ? PROGRESS_BAR_EMOJIS.fillEnd : PROGRESS_BAR_EMOJIS.outlineEnd
    } else {
      docId = isFilled ? PROGRESS_BAR_EMOJIS.fillCenter : PROGRESS_BAR_EMOJIS.outlineCenter
    }
    barStr += `[🍫](tg://emoji?id=${docId})`
  }

  return md(`${barStr}  \`${String(Math.round(pct))}%\``)
}

export function glyphProgressBar(percent: number, cells = GLYPH_BAR_CELLS): ReturnType<typeof md> {
  const pct = Math.max(0, Math.min(100, percent))
  const filled = Math.round((pct / 100) * cells)
  const bar = `${'▰'.repeat(filled)}${'▱'.repeat(cells - filled)}`
  return md`\`${bar}\`  \`${String(Math.round(pct))}%\``
}

export function progressBar(percent: number): ReturnType<typeof md> {
  if (config.features.emoji && config.features.premiumProgressBar) {
    return premiumProgressBar(percent)
  }
  return glyphProgressBar(percent)
}

/*
  Cancel is red, here and inline.

  It is the same colour language the room keyboards use: red is the button that
  takes something away, and cancelling a download throws away work that is
  already in progress. It is also the only button on these cards, so the colour
  is doing the whole job of saying what pressing it means.
*/
const CANCEL_STYLE: tl.RawKeyboardButtonStyle = {
  _: 'keyboardButtonStyle',
  bgDanger: true,
  icon: Long.fromString(CANCEL_EMOJI_ID),
}
const PLAY_STYLE: tl.RawKeyboardButtonStyle = {
  _: 'keyboardButtonStyle',
  bgSuccess: true,
  icon: Long.fromString(PLAY_EMOJI_ID),
}
const PAUSE_STYLE: tl.RawKeyboardButtonStyle = {
  _: 'keyboardButtonStyle',
  icon: Long.fromString(PAUSE_EMOJI_ID),
}
const TOGGLE_STYLE: tl.RawKeyboardButtonStyle = {
  _: 'keyboardButtonStyle',
  icon: Long.fromString(TOGGLE_EMOJI_ID),
}
const SKIP_STYLE: tl.RawKeyboardButtonStyle = {
  _: 'keyboardButtonStyle',
  bgDanger: true,
  icon: Long.fromString(SKIP_EMOJI_ID),
}

export function cancelKeyboard(): ReturnType<typeof BotKeyboard.inline> {
  return BotKeyboard.inline([
    [BotKeyboard.callback('Cancel', 'pb:cancel', { style: CANCEL_STYLE })],
  ])
}

export function inlineCancelKeyboard(chatId: number, statusMessageId: number): ReturnType<typeof BotKeyboard.inline> {
  return BotKeyboard.inline([
    [
      BotKeyboard.callback('Cancel', `pbi:cancel:${chatId}:${statusMessageId}`, {
        style: CANCEL_STYLE,
      }),
    ],
  ])
}

export function replayKeyboard(): ReturnType<typeof BotKeyboard.inline> {
  return BotKeyboard.inline([[BotKeyboard.callback('Play Again', 'pb:replay', { style: PLAY_STYLE })]])
}

export function dismissKeyboard(): ReturnType<typeof BotKeyboard.inline> {
  return BotKeyboard.inline([[BotKeyboard.callback('Dismiss', 'pb:dismiss')]])
}

const PROGRESS_WIDTH = 12

export function progressLabel(elapsed: number, duration: number | null | undefined): string {
  const el = Math.max(0, Math.floor(elapsed))
  if (duration == null || duration <= 0) return `LIVE · ${fmtDuration(el)}`
  const total = Math.floor(duration)
  const pos = Math.round(Math.min(1, el / total) * (PROGRESS_WIDTH - 1))
  let bar = ''
  for (let i = 0; i < PROGRESS_WIDTH; i++) bar += i < pos ? '━' : i === pos ? 'I' : '─'
  return `${fmtDuration(el)} ${bar} ${fmtDuration(total)}`
}

export function playbackKeyboard(paused: boolean, progress = '…'): ReturnType<typeof BotKeyboard.inline> {
  const toggle = BotKeyboard.callback(WORD_JOINER, 'pb:toggle', {
    style: paused ? PLAY_STYLE : PAUSE_STYLE,
  })
  const skip = BotKeyboard.callback(WORD_JOINER, 'pb:skip', { style: SKIP_STYLE })
  const bar = BotKeyboard.callback(progress, 'pb:pos')
  const { endButton, downloadButton } = config.features

  if (!endButton && !downloadButton) {
    return BotKeyboard.inline([[bar], [toggle, skip]])
  }

  const topRow = [toggle, ...(endButton ? [BotKeyboard.callback('End', 'pb:end')] : [])]
  const bottomRow = [skip, ...(downloadButton ? [BotKeyboard.callback('Download', 'pb:download')] : [])]
  return BotKeyboard.inline([topRow, [bar], bottomRow])
}

export function joinLines(lines: ReturnType<typeof md>[]): ReturnType<typeof md> {
  return lines.reduce((acc, line, i) => (i === 0 ? line : md`${acc}\n${line}`), md``)
}

export { mention }

export function byLine(body: ReturnType<typeof md>, name: string, id?: number | string | null): ReturnType<typeof md> {
  return md`${body} - ${mention(name, id)}`
}

/**
 * Whoever did the thing, as the person reading it sees them.
 *
 * "You" in a room that belongs to the reader, a mention anywhere else. Every
 * card that names an actor should go through this: a personal room has one
 * reader and printing their own name at them reads like the bot talking about
 * somebody who is not there.
 */
export function actorLabel(
  name: string,
  id?: number | string | null,
  youId?: number | string | null,
): ReturnType<typeof md> {
  // clickable like every other name in these lines, not plain bold text
  if (isYou(id, youId)) return md`**${mention('You', id)}**`
  return id != null && id !== '' ? md`**${mention(name, id)}**` : md`**${name}**`
}

export type ControlAction = 'paused' | 'resumed' | 'skipped' | 'ended' | 'seeked'

export function controlLine(opts: {
  video: boolean
  action: ControlAction
  name: string
  id?: number | string | null
  youId?: number | string | null
  lead?: ReturnType<typeof md>
  detail?: ReturnType<typeof md>
}): ReturnType<typeof md> {
  /*
    Somebody did something, said as a sentence.

    This used to be passive and bold in three places at once: "**Playback** was
    **paused** by **Alice**". Three emphasised fragments in six words leaves
    nothing emphasised, and the reader meets the subject last. Actor first, one
    bold thing in the line, and the rest reads the way a person would say it.

    One icon for all of them, too. A pause glyph on the pause line and a play
    glyph on the resume line sounds tidy and means the icon column flickers
    between three shapes while saying nothing the sentence does not.
  */
  const subject = opts.video ? 'the stream' : 'playback'
  const phrase =
    opts.action === 'paused'
      ? md`paused ${subject}`
      : opts.action === 'resumed'
        ? md`resumed ${subject}`
        : opts.action === 'skipped'
          ? md`skipped the track`
          : opts.action === 'ended'
            ? md`ended ${subject}`
            : md`jumped`

  const who = actorLabel(opts.name, opts.id, opts.youId)
  const body = opts.detail
    ? md`${who} ${phrase} ${opts.detail}.`
    : md`${who} ${phrase}.`
  const defaultLead =
    opts.action === 'skipped'
      ? md(emoji(EMOJI.skip))
      : opts.action === 'paused'
        ? md(emoji(EMOJI.pause))
        : opts.action === 'resumed'
          ? md(emoji(EMOJI.resume))
          : opts.action === 'ended'
            ? md(emoji(EMOJI.end))
            : SUCCESS_EMOJI
  return md`${opts.lead ?? defaultLead} ${body}`
}

export const QUEUE_PAGE_SIZE = 4

export type QueueItem = {
  title: string
  /** The track's own page. Without it the entry's title is dead text. */
  sourceUrl?: string | null
  duration?: number | null
  requestedBy: string
  requestedById?: number | string | null
}

export type QueueView = { current: CardInfo; queue: QueueItem[] }

export function queueCard(view: QueueView, page: number): { text: ReturnType<typeof md>; page: number; pages: number } {
  const total = view.queue.length
  const pages = Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE))
  const p = Math.min(Math.max(0, Math.trunc(page)), pages - 1)
  const c = view.current
  const header = md`${md(emoji(nowGlyph(c)))} **${verb(c)}**\n${titleOf(c)}`
  if (total === 0) return { text: md`${header}\n\nNothing else is queued.`, page: p, pages }
  const start = p * QUEUE_PAGE_SIZE
  const lines = view.queue
    .slice(start, start + QUEUE_PAGE_SIZE)
    .map((it, i) => {
      /*
        Same shape as the inline queue's entries, down to the punctuation.

        The title is a link, and the requested-by that used to trail every line
        is gone with the em dash that separated it: two facts per row, one of
        which repeated the same name a dozen times down a page, made the list
        harder to read than the queue it describes.
      */
      const n = start + i + 1
      return it.duration != null
        ? md`\`${n}.\` ${titleOf(it)} \`(${fmtDuration(it.duration)})\``
        : md`\`${n}.\` ${titleOf(it)}`
    })
  const count = md`**Up Next (${total}):**`
  return { text: md`${header}\n\n${count}\n${joinLines(lines)}`, page: p, pages }
}

export function queueKeyboard(page: number, pages: number): ReturnType<typeof BotKeyboard.inline> {
  const rows: ReturnType<typeof BotKeyboard.callback>[][] = []
  if (pages > 1) {
    rows.push([
      BotKeyboard.callback('Previous', `q:page:${(page - 1 + pages) % pages}`),
      BotKeyboard.callback(`${page + 1}/${pages}`, 'q:noop'),
      BotKeyboard.callback('Next', `q:page:${(page + 1) % pages}`),
    ])
  }
  rows.push([BotKeyboard.callback('Close', 'q:close')])
  return BotKeyboard.inline(rows)
}
