import { md } from '@mtcute/markdown-parser'
import { BotKeyboard, tl } from '@mtcute/node'
import type { CommandContext } from '../../core/command.js'
import { config } from '../../config.js'
import { ERROR_EMOJI, SUCCESS_EMOJI, WARNING_EMOJI, INFO_EMOJI } from '../../lib/feedback.js'
import { customEmoji, CANCEL_EMOJI_ID } from '../../lib/emoji.js'
import { resolveTrack, MusicError } from '../media/musicSource.js'
import { isPlaylistUrl, resolvePlaylist } from '../media/playlist.js'
import { getDirectVideoUrl } from '../media/ytdlp.js'
import { acquireAudio } from '../media/acquire.js'
import { mediaCache } from '../media/mediaCache.js'
import { downloadMediaToTemp } from '../media/download.js'
import { parseDuration, parseLoopCount } from '../media/parse.js'
import {
  fmtDuration,
  nowPlayingCard,
  lookupCard,
  downloadingCard,
  inlineLookupCard,
  inlineNowPlayingCard,
  queuedCard,
  playlistQueuedCard,
  type PlaylistCardInfo,
  inlineQueueCard,
  cancelKeyboard,
  inlineCancelKeyboard,
  actorLabel,
  controlLine,
  type CardInfo,
  type ControlAction,
} from '../playback/playcard.js'
import { withFakeProgress } from '../playback/fakeProgress.js'
import { registerCancel, clearCancel } from '../playback/cancel.js'
import { beginRoomCard, showRoomPlaying, roomLiveCardId, stopRoomCard, serialCardEdit } from './roomCards.js'
import { openEmptyQueueCard, openQueueCard } from '../playback/queue.js'
import { roomManager } from './RoomManager.js'
import { queuedKeyboard, rememberQueuedCard } from './queuedCards.js'
import { stripRoomFlag, parsePlayFlags, roomVideoHeight, type TrackSource, type VideoQuality } from './playMode.js'
import { joinRoomKeyboard, inlineJoinRoomKeyboard, roomControlsKeyboard, roomYou } from './roomLink.js'

export { roomJoinUrl, joinRoomKeyboard, inlineJoinRoomKeyboard } from './roomLink.js'

function friendly(err: unknown): string {
  if (err instanceof MusicError) {
    if (/no results/i.test(err.message)) return "I couldn't find anything for that. Try a different search."
    return `Couldn't fetch that track: ${err.message}`
  }
  if (err instanceof Error && err.message === 'queue_full') {
    return `The room queue is full (max ${config.room.maxQueue}). Try again once some tracks have played.`
  }
  return `Something went wrong: ${err instanceof Error ? err.message : String(err)}`
}

type PlayableReply = Parameters<typeof downloadMediaToTemp>[1]

function playableReply(reply: CommandContext['reply']): PlayableReply | null {
  const m = reply?.media
  if (
    m &&
    (m.type === 'audio' ||
      m.type === 'voice' ||
      m.type === 'video' ||
      (m.type === 'document' && (m.mimeType.startsWith('audio/') || m.mimeType.startsWith('video/'))))
  ) {
    return m as PlayableReply
  }
  return null
}

function isVideoReply(m: PlayableReply): boolean {
  if (m.type === 'video') return true
  return 'mimeType' in m && typeof m.mimeType === 'string' && m.mimeType.startsWith('video/')
}

function replyTitle(m: PlayableReply, video: boolean): string {
  if ('title' in m && m.title) {
    const performer = 'performer' in m ? m.performer : null
    return performer ? `${performer} - ${m.title}` : String(m.title)
  }
  return ('fileName' in m ? m.fileName : null) ?? (video ? 'Video' : 'Audio')
}

type RoomSource =
  // `source` rides along with the query so a replay looks the track up the same
  // way the original play did, rather than quietly falling back to YouTube.
  | { kind: 'query'; query: string; source?: TrackSource | null }
  | { kind: 'reply'; media: PlayableReply }

export type RoomReplayInfo = { source: RoomSource; wantVideo: boolean; quality: VideoQuality | null }

type RoomPlaybackParams = {
  tg: CommandContext['tg']
  db: CommandContext['db']
  chatId: number
  targetGroupId?: string
  wantVideo: boolean
  quality: VideoQuality | null
  requestedBy: string
  requestedById: string
  statusMessageId: number
  commandMsgId?: number
  /** Start it now, pushing the current track back to the queue. */
  force?: boolean
  source: RoomSource
  mirror?: { messageId: tl.TypeInputBotInlineMessageID; linkGroupId: string; title?: string; sourceUrl?: string }
}

export async function performRoomPlay(ctx: CommandContext, wantVideo: boolean, targetGroupId?: string): Promise<void> {
  const label = wantVideo ? '/vplay' : '/play'

  const replied = playableReply(ctx.reply)
  const { quality, source: trackSource, force, query: argQuery } = parsePlayFlags(ctx.rawArgs)
  const query = argQuery || (ctx.reply?.media ? '' : (ctx.reply?.text?.trim() ?? ''))

  if (!replied && !query) {
    await ctx.msg.replyText(
      md`${WARNING_EMOJI} Give me something to play in the room: \`${label} <song name or link>\`, or reply to an audio/video file.`,
    )
    return
  }

  const source: RoomSource = replied
    ? { kind: 'reply', media: replied }
    : { kind: 'query', query, source: trackSource }

  const status = await ctx.msg.replyText(md`Preparing for the room…`, { replyMarkup: cancelKeyboard() })
  await runRoomPlayback({
    tg: ctx.tg,
    db: ctx.db,
    chatId: ctx.msg.chat.id,
    targetGroupId,
    wantVideo,
    quality,
    requestedBy: ctx.msg.sender.displayName,
    requestedById: String(ctx.msg.sender.id),
    statusMessageId: status.id,
    commandMsgId: ctx.msg.id,
    force,
    source,
  })
}

export async function performRoomReplay(
  tg: CommandContext['tg'],
  db: CommandContext['db'],
  chatId: number,
  info: RoomReplayInfo,
  requestedBy: string,
  requestedById: string,
): Promise<void> {
  const status = await tg.sendText(chatId, md`Preparing for the room…`, { replyMarkup: cancelKeyboard() })
  await runRoomPlayback({
    tg,
    db,
    chatId,
    wantVideo: info.wantVideo,
    quality: info.quality,
    requestedBy,
    requestedById,
    statusMessageId: status.id,
    source: info.source,
  })
}

export async function performRoomPlayInto(
  tg: CommandContext['tg'],
  db: CommandContext['db'],
  roomGroupId: string,
  videoUrl: string,
  requestedBy: string,
  requestedById: string,
  inlineMessageId?: tl.TypeInputBotInlineMessageID,
  inlineTitle?: string,
): Promise<{ ok: boolean }> {
  const chatId = Number(roomGroupId)
  const status = await tg
    .sendText(chatId, md`Preparing for the room…`, { replyMarkup: cancelKeyboard() })
    .catch(() => null)
  if (!status) return { ok: false }
  await runRoomPlayback({
    tg,
    db,
    chatId,
    wantVideo: true,
    quality: null,
    requestedBy,
    requestedById,
    statusMessageId: status.id,
    source: { kind: 'query', query: videoUrl },
    mirror: inlineMessageId
      ? {
          messageId: inlineMessageId,
          linkGroupId: roomGroupId,
          title: inlineTitle,
          // the page the pick came from, so its title is a link while it loads
          sourceUrl: videoUrl,
        }
      : undefined,
  })
  return { ok: true }
}

export type InlineControl =
  | { action: 'pause' | 'resume' | 'skip' | 'end' | 'queue' }
  | { action: 'seek'; positionSec: number }
  | { action: 'loop'; count: number }

/*
  Inline control answers are read by one person, in their own room.

  Every one of these used to omit `youId`, so an inline `/pause` in your own
  room came back as "Playback was paused by Alice" - addressed to Alice, about
  Alice, in a message only Alice can see. `roomYou` returns the owner's id for a
  personal room and nothing for a group, which is exactly the condition.
*/
export async function performRoomControlInline(
  tg: CommandContext['tg'],
  groupId: string,
  control: InlineControl,
  name: string,
  id: string,
): Promise<ReturnType<typeof md>> {
  const chatId = Number(groupId)
  const video = currentIsVideo(chatId)

  switch (control.action) {
    case 'pause': {
      const res = roomManager.pause(groupId, name, id)
      if (res === 'nothing') return md`${INFO_EMOJI} Nothing is playing in your room right now.`
      if (res === 'already') return md`${INFO_EMOJI} The room is already paused.`
      return controlLine({ video, action: 'paused', name, id, youId: roomYou(groupId) })
    }
    case 'resume': {
      const res = roomManager.play(groupId, name, id)
      if (res === 'nothing') return md`${INFO_EMOJI} Nothing is playing in your room right now.`
      if (res === 'already') return md`${INFO_EMOJI} The room isn't paused.`
      return controlLine({ video, action: 'resumed', name, id, youId: roomYou(groupId) })
    }
    case 'skip': {
      const oldCard = roomLiveCardId(chatId)
      const res = roomManager.skip(groupId, name, id)
      if (res === 'nothing') return md`${INFO_EMOJI} Nothing is playing in your room right now.`
      const line = controlLine({ video, action: 'skipped', name, id, youId: roomYou(groupId) })
      if (oldCard) {
        void serialCardEdit(oldCard, () =>
          tg.editMessage({ chatId, message: oldCard, text: line, invertMedia: false, disableWebPreview: true }).catch(() => {}),
        )
      }
      return line
    }
    case 'end': {
      const oldCard = roomLiveCardId(chatId)
      const ended = await roomManager.end(groupId, name, id)
      if (!ended) return md`${INFO_EMOJI} Nothing is playing in your room right now.`
      stopRoomCard(chatId)
      const line = controlLine({ video, action: 'ended', name, id, youId: roomYou(groupId) })
      if (oldCard) {
        void serialCardEdit(oldCard, () =>
          tg.editMessage({ chatId, message: oldCard, text: line, invertMedia: false, disableWebPreview: true }).catch(() => {}),
        )
      }
      return line
    }
    case 'seek': {
      const res = roomManager.seek(groupId, control.positionSec, name, id)
      if (res === 'nothing') return md`${INFO_EMOJI} Nothing is playing in your room right now.`
      if (res === 'live') return md`${INFO_EMOJI} This is a live track with no known length, so it can't be seeked.`
      return controlLine({ video, action: 'seeked', name, id, youId: roomYou(groupId), detail: md`to \`${fmtDuration(res)}\`` })
    }
    case 'queue': {
      const snap = roomManager.getSnapshot(groupId)
      if (!snap?.current) return md`${INFO_EMOJI} Nothing is playing in your room right now.`
      return inlineQueueCard(
        snap.current,
        snap.queue.map((q) => ({
          title: q.title,
          duration: q.duration,
          sourceUrl: q.sourceUrl,
        })),
      )
    }
    case 'loop': {
      if (roomManager.setLoop(groupId, control.count) === 'nothing') {
        return md`${INFO_EMOJI} Nothing is playing in your room right now.`
      }
      const n = control.count
      return loopLine(n, name, id, roomYou(groupId))
    }
  }
}

export type PlaybackResult = {
  position: number
  trackId: string
  title: string
  artist: string | null
}

export async function runRoomPlayback(p: RoomPlaybackParams): Promise<PlaybackResult | null> {
  const { tg, db, chatId, targetGroupId, wantVideo, quality, requestedBy, requestedById, statusMessageId, commandMsgId, source, mirror, force } = p
  const groupId = targetGroupId ?? String(chatId)
  const replaySource: RoomReplayInfo = { source, wantVideo, quality }

  const mirrorJoinKb = mirror ? inlineJoinRoomKeyboard(mirror.linkGroupId) : undefined
  const mirrorCancelKb = mirror ? inlineCancelKeyboard(chatId, statusMessageId) : undefined
  let lastMirrorAt = 0
  const paintMirror = (
    text: ReturnType<typeof md>,
    opts: { force?: boolean; kb?: ReturnType<typeof BotKeyboard.inline>; cover?: string | null } = {},
  ): void => {
    if (!mirror) return
    const now = Date.now()
    if (!opts.force && now - lastMirrorAt < 1500) return
    lastMirrorAt = now
    const embed = !!opts.cover && config.features.thumbnailEmbed
    void tg
      .editInlineMessage({
        messageId: mirror.messageId,
        text,
        replyMarkup: opts.kb ?? mirrorJoinKb,
        invertMedia: embed,
        disableWebPreview: !embed,
      })
      .catch(() => {})
  }

  const edit = (
    text: ReturnType<typeof md>,
    kb?: ReturnType<typeof BotKeyboard.inline>,
    cover?: string | null,
  ): Promise<unknown> => {
    const embed = !!cover && config.features.thumbnailEmbed
    return tg
      .editMessage({ chatId, message: statusMessageId, text, replyMarkup: kb, invertMedia: embed, disableWebPreview: !embed })
      .catch(() => {})
  }
  const controller = new AbortController()
  registerCancel(chatId, statusMessageId, { requesterId: requestedById, abort: () => controller.abort() })

  let media: { path: string; dispose: () => Promise<void> } | undefined
  let enqueued = false
  try {
    let title: string
    /** The track's own page, for the card's linked title. Absent for a file. */
    let sourceUrl: string | null = null
    // the uploader/channel, when the source knows one - shown as the author
    let artist: string | null = null
    let artistAvatar: string | null = null
    let lyricsArtist: string | null = null
    let duration: number | null
    let thumbnail: string | null = null
    let video: boolean
    let sourceMode: 'download' | 'split' = 'download'
    let videoDirectUrl: string | undefined
    let videoSourceUrl: string | undefined
    let videoMaxHeight: number | undefined
    let cardVideoHeight: number | undefined

    if (source.kind === 'reply') {
      const replied = source.media
      video = wantVideo && isVideoReply(replied)
      title = replyTitle(replied, video)
      duration = 'duration' in replied && typeof replied.duration === 'number' ? Math.round(replied.duration) : null
      const size = replied.fileSize ?? 0
      const limit = config.media.maxVideoMb * 1024 * 1024
      if (size && size > limit) {
        await edit(md`${WARNING_EMOJI} That file is too large (${Math.round(size / 1024 / 1024)}MB > ${config.media.maxVideoMb}MB).`)
        return null
      }
      const info: CardInfo = { title, sourceUrl, duration, requestedBy, requestedById, video, thumbnail }
      media = await withFakeProgress(
        (pct) => edit(downloadingCard(info, { percent: pct }), cancelKeyboard(), thumbnail),
        () => downloadMediaToTemp(tg, replied),
      )
    } else if (config.features.playlists && isPlaylistUrl(source.query)) {
      const query = source.query
      await edit(lookupCard(query), cancelKeyboard())
      paintMirror(inlineLookupCard(mirror?.title, mirror?.sourceUrl), { force: true, kb: mirrorCancelKb })

      const playlist = await resolvePlaylist(query, config.room.maxQueue, { signal: controller.signal })
      if (playlist.tracks.length === 0) throw new MusicError('No playable tracks found in playlist')

      const snap = roomManager.getSnapshot(groupId)
      const currentQueueLen = snap?.queue.length ?? 0
      const remainingCap = Math.max(0, config.room.maxQueue - currentQueueLen)
      if (remainingCap <= 0 && snap?.current) {
        throw new Error('queue_full')
      }

      const tracksToQueue = playlist.tracks.slice(0, snap?.current ? remainingCap : remainingCap + 1)
      if (tracksToQueue.length === 0) throw new Error('queue_full')

      const firstTrack = tracksToQueue[0]!
      const firstMedia = await withFakeProgress(
        (pct) => {
          const info: CardInfo = {
            title: firstTrack.title,
            sourceUrl: firstTrack.url,
            duration: firstTrack.duration,
            requestedBy,
            requestedById,
            video: false,
            thumbnail: firstTrack.thumbnail,
          }
          return edit(downloadingCard(info, { percent: pct }), cancelKeyboard(), firstTrack.thumbnail)
        },
        () => acquireAudio(tg, db, firstTrack, undefined, { signal: controller.signal }),
      )
      media = firstMedia

      if (controller.signal.aborted) throw new Error('canceled')

      const willStartNow = !snap?.current || !!force
      const { position: firstPos, trackId: firstTrackId } = roomManager.enqueue({
        groupId,
        force,
        title: firstTrack.title,
        artist: firstTrack.uploader ?? null,
        artistAvatar: firstTrack.artistAvatar ?? null,
        lyricsArtist: firstTrack.credits ?? null,
        duration: firstTrack.duration,
        sourceUrl: firstTrack.url,
        thumbnail: firstTrack.thumbnail,
        video: false,
        requestedBy,
        requestedById,
        mediaFsPath: firstMedia.path,
        dispose: firstMedia.dispose,
        sourceMode: 'download',
        statusMessageId: willStartNow ? statusMessageId : undefined,
        replaySource,
      })
      enqueued = true

      for (let i = 1; i < tracksToQueue.length; i++) {
        const t = tracksToQueue[i]!
        roomManager.enqueue({
          groupId,
          title: t.title,
          artist: t.uploader ?? null,
          artistAvatar: t.artistAvatar ?? null,
          lyricsArtist: t.credits ?? null,
          duration: t.duration,
          sourceUrl: t.url,
          thumbnail: t.thumbnail,
          video: false,
          requestedBy,
          requestedById,
          acquireMedia: () => acquireAudio(tg, db, t),
          sourceMode: 'download',
        })
      }

      const playlistInfo: PlaylistCardInfo = {
        title: playlist.title,
        sourceUrl: playlist.url,
        trackCount: tracksToQueue.length,
        totalDuration: playlist.totalDuration,
        requestedBy,
        requestedById,
        thumbnail: playlist.thumbnail,
      }

      if (firstPos === 0) {
        const info: CardInfo = {
          title: firstTrack.title,
          sourceUrl: firstTrack.url,
          duration: firstTrack.duration,
          requestedBy,
          requestedById,
          video: false,
          thumbnail: firstTrack.thumbnail,
        }
        await edit(nowPlayingCard(info, { you: roomYou(groupId) }), roomControlsKeyboard(groupId, false), firstTrack.thumbnail)
        paintMirror(inlineNowPlayingCard(info), { force: true, cover: firstTrack.thumbnail })
        beginRoomCard(chatId, statusMessageId, info)

        if (tracksToQueue.length > 1) {
          await tg.sendText(
            chatId,
            playlistQueuedCard(playlistInfo, 1, { where: 'room', you: roomYou(groupId) }),
            {
              replyTo: commandMsgId ?? statusMessageId,
              replyMarkup: queuedKeyboard(groupId),
              disableWebPreview: true,
            },
          ).catch(() => null)
        }
      } else {
        await edit(
          playlistQueuedCard(playlistInfo, firstPos, { where: 'room', you: roomYou(groupId) }),
          queuedKeyboard(groupId),
        )
        rememberQueuedCard(chatId, statusMessageId, {
          roomId: groupId,
          trackId: firstTrackId,
          commandMsgId,
          requesterId: requestedById,
        })
      }

      return {
        position: firstPos,
        trackId: firstTrackId,
        title: playlist.title,
        artist: playlist.uploader ?? null,
      }
    } else {
      const query = source.query
      await edit(lookupCard(query), cancelKeyboard())
      paintMirror(inlineLookupCard(mirror?.title, mirror?.sourceUrl), { force: true, kb: mirrorCancelKb })
      const track = await resolveTrack(query, {
        signal: controller.signal,
        source: source.source,
        video: wantVideo,
      })
      video = wantVideo
      title = track.title
      sourceUrl = track.url
      artist = track.uploader ?? null
      artistAvatar = track.artistAvatar ?? null
      lyricsArtist = track.credits ?? null
      duration = track.duration
      thumbnail = track.thumbnail
      const max = config.media.maxTrackSeconds
      if (max > 0 && duration && duration > max) {
        await edit(md`${WARNING_EMOJI} That track is too long (${fmtDuration(duration)} > ${fmtDuration(max)}).`)
        return null
      }
      if (wantVideo) {
        const maxHeight = roomVideoHeight(quality)
        const info: CardInfo = { title, sourceUrl, duration, requestedBy, requestedById, video: true, thumbnail }
        const [direct, audio] = await withFakeProgress(
          (pct) => {
            paintMirror(downloadingCard(info, { percent: pct }), { kb: mirrorCancelKb, cover: thumbnail })
            return edit(downloadingCard(info, { percent: pct }), cancelKeyboard(), thumbnail)
          },
          () =>
            Promise.all([
              getDirectVideoUrl(track, maxHeight, controller.signal),
              acquireAudio(tg, db, track, undefined, { signal: controller.signal }),
            ]),
        )
        video = true
        media = audio
        videoDirectUrl = direct.url
        videoSourceUrl = track.url
        videoMaxHeight = maxHeight
        cardVideoHeight = direct.height ?? Math.min(maxHeight, 1080)
        sourceMode = 'split'
      } else {
        video = false
        const isCached = await mediaCache.lookup(db, track.id, false).catch(() => null)
        if (isCached) {
          media = await acquireAudio(tg, db, track, undefined, { signal: controller.signal })
        } else {
          const info: CardInfo = { title, sourceUrl, duration, requestedBy, requestedById, video: false, thumbnail }
          media = await withFakeProgress(
            (pct) => {
              paintMirror(downloadingCard(info, { percent: pct }), { kb: mirrorCancelKb, cover: thumbnail })
              return edit(downloadingCard(info, { percent: pct }), cancelKeyboard(), thumbnail)
            },
            () => acquireAudio(tg, db, track, undefined, { signal: controller.signal }),
          )
        }
      }
    }

    if (controller.signal.aborted) throw new Error('canceled')

    const { position, trackId } = roomManager.enqueue({
      groupId,
      force,
      title,
      artist,
      artistAvatar,
      lyricsArtist,
      duration,
      sourceUrl,
      thumbnail,
      video,
      requestedBy,
      requestedById,
      mediaFsPath: media.path,
      dispose: media.dispose,
      sourceMode,
      videoDirectUrl,
      videoSourceUrl,
      videoMaxHeight,
      cardVideoHeight,
      statusMessageId,
      replaySource,
    })
    enqueued = true

    if (position === 0) {
      const info: CardInfo = { title, sourceUrl, duration, requestedBy, requestedById, video, thumbnail, videoHeight: cardVideoHeight }
      await edit(nowPlayingCard(info, { you: roomYou(groupId) }), roomControlsKeyboard(groupId, false), thumbnail)
      paintMirror(inlineNowPlayingCard(info), { force: true, cover: thumbnail })
      beginRoomCard(chatId, statusMessageId, info)
    } else {
      const queued = { title, sourceUrl, duration, requestedBy, requestedById }
      await edit(
        queuedCard(queued, position, { where: 'room', you: roomYou(groupId) }),
        queuedKeyboard(groupId),
      )
      /*
        Remembered by the message it is printed on, so Play Now and Delete know
        which track they belong to without carrying a UUID through 64 bytes of
        callback data. Also carries the message that asked for it, which Delete
        takes away along with the card.
      */
      rememberQueuedCard(chatId, statusMessageId, {
        roomId: groupId,
        trackId,
        commandMsgId,
        requesterId: requestedById,
      })
      paintMirror(queuedCard(queued, position, { where: 'room', requestor: false }), { force: true })
    }

    return {
      position,
      trackId,
      title,
      artist,
    }
  } catch (err) {
    if (media && !enqueued) await media.dispose().catch(() => {})
    if (controller.signal.aborted) {
      const ids = commandMsgId != null ? [statusMessageId, commandMsgId] : [statusMessageId]
      await tg.deleteMessagesById(chatId, ids).catch(() => {})
      paintMirror(md`${customEmoji('❌', CANCEL_EMOJI_ID)} Canceled`, { force: true })
      return null
    }
    const errText = md`${ERROR_EMOJI} ${friendly(err)}`
    await edit(errText)
    paintMirror(errText, { force: true })
    return null
  } finally {
    clearCancel(chatId, statusMessageId)
  }
}

function currentIsVideo(chatId: number): boolean {
  return roomManager.getSnapshot(String(chatId))?.current?.video ?? false
}

/**
 * What the room says when somebody sets or clears the loop.
 *
 * One builder for the command and the inline version, which had drifted into
 * two copies of the same sentence. The actor is inside the sentence rather than
 * trailing after a dash: "You" or a mention, doing something, which is how the
 * pause and skip lines already read.
 */
function loopLine(
  count: number,
  name: string,
  id?: string | number | null,
  youId?: string | number | null,
): ReturnType<typeof md> {
  const who = actorLabel(name, id, youId)
  if (count === 0) {
    return md`${SUCCESS_EMOJI} ${who} turned looping off. The current track plays once and moves on.`
  }
  const times = count === 1 ? md`one more time` : md`**${count}** more times`
  return md`${SUCCESS_EMOJI} ${who} set the current track to repeat ${times}.`
}

function roomLine(
  ctx: CommandContext,
  video: boolean,
  action: ControlAction,
  opts?: { lead?: ReturnType<typeof md>; detail?: ReturnType<typeof md> },
): ReturnType<typeof md> {
  const youId = ctx.msg.chat.type === 'user' ? ctx.msg.sender.id : undefined
  return controlLine({ video, action, name: ctx.msg.sender.displayName, id: ctx.msg.sender.id, youId, ...opts })
}

export async function performRoomPause(ctx: CommandContext): Promise<void> {
  const chatId = ctx.msg.chat.id
  const video = currentIsVideo(chatId)
  const res = roomManager.pause(String(chatId), ctx.msg.sender.displayName, String(ctx.msg.sender.id))
  if (res === 'nothing') await ctx.msg.replyText(md`${INFO_EMOJI} Nothing is playing in the room right now.`)
  else if (res === 'already') await ctx.msg.replyText(md`${INFO_EMOJI} The room is already paused. Use \`${ctx.prefix}resume\`.`)
  else {
    await ctx.msg.replyText(roomLine(ctx, video, 'paused'))
  }
}

export async function performRoomResume(ctx: CommandContext): Promise<void> {
  const chatId = ctx.msg.chat.id
  const video = currentIsVideo(chatId)
  const res = roomManager.play(String(chatId), ctx.msg.sender.displayName, String(ctx.msg.sender.id))
  if (res === 'nothing') await ctx.msg.replyText(md`${INFO_EMOJI} Nothing is playing in the room right now.`)
  else if (res === 'already') await ctx.msg.replyText(md`${INFO_EMOJI} The room isn't paused.`)
  else {
    await ctx.msg.replyText(roomLine(ctx, video, 'resumed'))
  }
}

export async function performRoomSkip(ctx: CommandContext): Promise<void> {
  const chatId = ctx.msg.chat.id
  const video = currentIsVideo(chatId)
  const oldCard = roomLiveCardId(chatId)
  const res = roomManager.skip(String(chatId), ctx.msg.sender.displayName, String(ctx.msg.sender.id))
  if (res === 'nothing') { await ctx.msg.replyText(md`${INFO_EMOJI} Nothing is playing in the room right now.`); return }
  const line = roomLine(ctx, video, 'skipped')
  if (oldCard) {
    void serialCardEdit(oldCard, () =>
      ctx.tg
        .editMessage({ chatId, message: oldCard, text: line, invertMedia: false, disableWebPreview: true })
        .catch(() => {}),
    )
  }
  await ctx.msg.replyText(line)
}

export async function performRoomEnd(ctx: CommandContext): Promise<void> {
  const chatId = ctx.msg.chat.id
  const video = currentIsVideo(chatId)
  const oldCard = roomLiveCardId(chatId)
  const ended = await roomManager.end(String(chatId), ctx.msg.sender.displayName, String(ctx.msg.sender.id))
  if (!ended) { await ctx.msg.replyText(md`${INFO_EMOJI} Nothing is playing in the room right now.`); return }
  stopRoomCard(chatId)
  const line = roomLine(ctx, video, 'ended')
  if (oldCard) {
    void serialCardEdit(oldCard, () =>
      ctx.tg
        .editMessage({ chatId, message: oldCard, text: line, invertMedia: false, disableWebPreview: true })
        .catch(() => {}),
    )
  }
  await ctx.msg.replyText(line)
}

export async function performRoomSeek(ctx: CommandContext, kind: 'forward' | 'backward' | 'seek'): Promise<void> {
  const groupId = String(ctx.msg.chat.id)
  const snapshot = roomManager.getSnapshot(groupId)
  if (!snapshot?.current) {
    await ctx.msg.replyText(md`${INFO_EMOJI} Nothing is playing in the room right now.`)
    return
  }
  const duration = snapshot.current.duration
  if (duration == null || duration <= 0) {
    await ctx.msg.replyText(md`${INFO_EMOJI} This is a live track with no known length, so it can't be seeked.`)
    return
  }
  const elapsed = snapshot.playing
    ? Math.max(0, Math.floor((snapshot.serverTime - snapshot.startedAt) / 1000))
    : Math.floor(snapshot.pausedPositionSec)

  const cmd = kind === 'seek' ? 'seek' : kind === 'forward' ? 'fw' : 'bw'
  const usage =
    kind === 'seek'
      ? md`${WARNING_EMOJI} Give me where to seek: \`${ctx.prefix}seek 4:02\`, \`${ctx.prefix}seek 90s\`, or \`${ctx.prefix}seek -90s\`.`
      : md`${WARNING_EMOJI} Give me an amount: \`${ctx.prefix}${cmd} 90s\` or \`${ctx.prefix}${cmd} 1m30s\`.`

  const arg = stripRoomFlag(ctx.rawArgs)
  if (!arg) { await ctx.msg.replyText(usage); return }

  let target: number
  if (kind === 'seek' && arg.includes(':')) {
    const abs = parseDuration(arg)
    if (abs == null) { await ctx.msg.replyText(usage); return }
    target = abs
  } else {
    const sign = kind === 'backward' ? -1 : 1
    const signed = arg.replace(/^\+/, '')
    const negative = kind === 'seek' && signed.startsWith('-')
    const amount = parseDuration(negative ? signed.slice(1) : signed)
    if (amount == null) { await ctx.msg.replyText(usage); return }
    target = elapsed + (negative ? -1 : sign) * amount
  }

  if (target < 0) {
    await ctx.msg.replyText(md`${WARNING_EMOJI} Can't rewind that far. The track is only **${fmtDuration(elapsed)}** in.`)
    return
  }
  if (target > duration) {
    await ctx.msg.replyText(md`${WARNING_EMOJI} Can't seek past the end. The track is **${fmtDuration(duration)}** long.`)
    return
  }

  const res = roomManager.seek(groupId, target, ctx.msg.sender.displayName, String(ctx.msg.sender.id))
  if (typeof res === 'number') {
    const detail = md`to \`${fmtDuration(res)}\``
    await ctx.msg.replyText(roomLine(ctx, snapshot.current.video, 'seeked', { detail }))
  } else {
    await ctx.msg.replyText(md`${ERROR_EMOJI} Couldn't seek the room right now.`)
  }
}

export async function performRoomPlaying(ctx: CommandContext): Promise<void> {
  const playing = await showRoomPlaying(ctx.msg.chat.id, ctx.msg.id)
  if (!playing) {
    await ctx.msg.replyText(md`${INFO_EMOJI} Nothing is playing in the room right now.`, {
      replyMarkup: joinRoomKeyboard(String(ctx.msg.chat.id)),
    })
  }
}

export async function performRoomQueue(ctx: CommandContext): Promise<void> {
  const chatId = ctx.msg.chat.id
  const groupId = String(chatId)
  const shown = await openQueueCard(ctx.msg.client, chatId, ctx.msg.id, () => {
    const snap = roomManager.getSnapshot(groupId)
    if (!snap?.current) return null
    const c = snap.current
    const current: CardInfo = {
      title: c.title, sourceUrl: c.sourceUrl, duration: c.duration, requestedBy: c.requestedBy,
      requestedById: c.requestedById ?? '', video: c.video, thumbnail: c.thumbnail,
    }
    return {
      current,
      queue: snap.queue.map((q) => ({
        title: q.title,
        sourceUrl: q.sourceUrl,
        duration: q.duration,
        requestedBy: q.requestedBy,
        requestedById: q.requestedById,
      })),
    }
  })
  if (!shown) {
    await openEmptyQueueCard(
      ctx.tg,
      ctx.msg.chat.id,
      ctx.msg.id,
      md`${INFO_EMOJI} Nothing is playing in the room right now.`,
    )
  }
}

export async function performRoomLoop(ctx: CommandContext): Promise<void> {
  const groupId = String(ctx.msg.chat.id)
  const n = parseLoopCount(stripRoomFlag(ctx.rawArgs))
  if (n == null) {
    await ctx.msg.replyText(md`${WARNING_EMOJI} Tell me how many times to repeat: \`${ctx.prefix}loop 5\`, or \`${ctx.prefix}loop off\` to stop.`)
    return
  }
  if (roomManager.setLoop(groupId, n) === 'nothing') {
    await ctx.msg.replyText(md`${INFO_EMOJI} Nothing is playing in the room right now.`, { replyMarkup: joinRoomKeyboard(groupId) })
    return
  }
  await ctx.msg.replyText(
    loopLine(n, ctx.msg.sender.displayName, ctx.msg.sender.id, roomYou(groupId)),
  )
}
