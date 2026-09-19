import { tg } from '../../client.js'
import {
  nowPlayingCard,
  finishedCard,
  postponedCard,
  replayKeyboard,
  coverEmbed,
  type CardInfo,
} from '../playback/playcard.js'
import { roomManager, type RoomCardTrack } from './RoomManager.js'
import { roomControlsKeyboard, isPersonalRoom, roomYou } from './roomLink.js'
import type { RoomReplayInfo } from './roomFlow.js'

/**
 * The card is repainted on events, never on a clock.
 *
 * It used to tick every 7s to advance an elapsed reading, which is one
 * `editMessage` per active room per 7 seconds - a steady spend against the
 * rate limit, entirely to animate a number nobody is watching in a chat. It
 * now repaints when something actually happens: play, pause, seek, skip, the
 * track finishing.
 *
 * The elapsed reading went with the tick rather than freezing in place. Held
 * still it was only ever true as of the last transport event, and a card put up
 * by a fresh play has not had one - so it opened at `0:00` and stayed there,
 * which reads as a player that never started. What repaints now is the
 * Pause/Resume button, which is state rather than a clock and is correct
 * whenever it is drawn.
 */
type LiveCard = { cardId: number; info: CardInfo }
const liveByChat = new Map<number, LiveCard>()

const cardEditChain = new Map<number, Promise<unknown>>()

export function serialCardEdit(messageId: number, run: () => Promise<unknown>): Promise<unknown> {
  const prev = cardEditChain.get(messageId) ?? Promise.resolve()
  const next = prev.then(run, run)
  cardEditChain.set(messageId, next)
  void next.catch(() => {}).finally(() => {
    if (cardEditChain.get(messageId) === next) cardEditChain.delete(messageId)
  })
  return next
}

function youOf(chatId: number): string | undefined {
  const groupId = String(chatId)
  return isPersonalRoom(groupId) ? groupId : undefined
}

export async function paintRoomCard(chatId: number): Promise<void> {
  const groupId = String(chatId)
  const snap = roomManager.getSnapshot(groupId)
  if (!snap?.current) { stopRoomCard(chatId); return }
  const live = liveByChat.get(chatId)
  const cardId = live?.cardId ?? snap.current.statusMessageId ?? playingByChat.get(chatId)?.cardId
  if (!cardId) return
  const info: CardInfo = live?.info ?? {
    title: snap.current.title,
    sourceUrl: snap.current.sourceUrl,
    duration: snap.current.duration,
    requestedBy: snap.current.requestedBy,
    requestedById: snap.current.requestedById ?? '',
    video: snap.current.video,
    thumbnail: snap.current.thumbnail,
  }
  liveByChat.set(chatId, { cardId, info })
  const embed = coverEmbed(info.thumbnail)
  await serialCardEdit(cardId, () =>
    tg
      .editMessage({
        chatId,
        message: cardId,
        text: nowPlayingCard(info, { you: youOf(chatId) }),
        replyMarkup: roomControlsKeyboard(groupId, !snap.playing),
        invertMedia: embed,
        disableWebPreview: !embed,
      })
      .catch(() => {}),
  )
}

export function roomLiveCardId(chatId: number): number | undefined {
  return liveByChat.get(chatId)?.cardId
}

const MAX_REPLAY_CARDS = 200
const roomReplayByCard = new Map<number, RoomReplayInfo>()

function registerRoomReplay(cardId: number, info: RoomReplayInfo): void {
  roomReplayByCard.set(cardId, info)
  while (roomReplayByCard.size > MAX_REPLAY_CARDS) {
    roomReplayByCard.delete(roomReplayByCard.keys().next().value as number)
  }
}

export function takeRoomReplay(cardId: number): RoomReplayInfo | undefined {
  const info = roomReplayByCard.get(cardId)
  if (info) roomReplayByCard.delete(cardId)
  return info
}

function toInfo(t: RoomCardTrack): CardInfo {
  return {
    title: t.title,
    sourceUrl: t.sourceUrl,
    duration: t.duration,
    requestedBy: t.requestedBy,
    requestedById: t.requestedById ?? '',
    video: t.video,
    thumbnail: t.thumbnail,
    videoHeight: t.videoHeight,
  }
}

export function beginRoomCard(chatId: number, cardId: number, info: CardInfo): void {
  liveByChat.set(chatId, { cardId, info })
}

export function stopRoomCard(chatId: number): void {
  liveByChat.delete(chatId)
  playingByChat.delete(chatId)
}

const playingByChat = new Map<number, { cardId: number; commandId: number }>()

export async function showRoomPlaying(chatId: number, commandId: number): Promise<boolean> {
  const groupId = String(chatId)
  const snap = roomManager.getSnapshot(groupId)
  if (!snap?.current) return false
  const c = snap.current
  const info: CardInfo = liveByChat.get(chatId)?.info ?? {
    title: c.title,
    sourceUrl: c.sourceUrl,
    duration: c.duration,
    requestedBy: c.requestedBy,
    requestedById: c.requestedById ?? '',
    video: c.video,
    thumbnail: c.thumbnail,
  }
  const embed = coverEmbed(info.thumbnail)
  const sent = await tg
    .sendText(chatId, nowPlayingCard(info, { you: youOf(chatId) }), {
      replyTo: commandId,
      replyMarkup: roomControlsKeyboard(groupId, !snap.playing),
      invertMedia: embed,
      disableWebPreview: !embed,
    })
    .catch(() => null)
  if (!sent) return true

  const stale: number[] = []
  const prevPlaying = playingByChat.get(chatId)
  if (prevPlaying) stale.push(prevPlaying.cardId, prevPlaying.commandId)
  const prevLive = liveByChat.get(chatId)
  if (prevLive && prevLive.cardId !== sent.id) stale.push(prevLive.cardId)
  playingByChat.set(chatId, { cardId: sent.id, commandId })
  if (stale.length) void tg.deleteMessagesById(chatId, stale).catch(() => {})

  beginRoomCard(chatId, sent.id, info)
  return true
}

async function promoteNext(chatId: number, next: RoomCardTrack): Promise<void> {
  const groupId = String(chatId)
  const info = toInfo(next)
  const text = nowPlayingCard(info, { you: youOf(chatId) })
  const markup = roomControlsKeyboard(groupId, false)
  const embed = coverEmbed(info.thumbnail)
  if (next.statusMessageId) {
    const cardId = next.statusMessageId
    try {
      await serialCardEdit(cardId, () =>
        tg.editMessage({
          chatId,
          message: cardId,
          text,
          replyMarkup: markup,
          invertMedia: embed,
          disableWebPreview: !embed,
        }),
      )
      beginRoomCard(chatId, cardId, info)
      return
    } catch {
    }
  }
  const sent = await tg
    .sendText(chatId, text, { replyMarkup: markup, invertMedia: embed, disableWebPreview: !embed })
    .catch(() => null)
  if (sent) beginRoomCard(chatId, sent.id, info)
}

export function registerRoomCards(): void {
  roomManager.setLifecycle({
    // whoever moved the room - Telegram button, /pause, or the web player
    onTransport: (groupId) => { void paintRoomCard(Number(groupId)) },
    onAdvance: (groupId, { finished, next, reason, by, resumeAtSec }) => {
      const chatId = Number(groupId)
      const prevLive = liveByChat.get(chatId)
      liveByChat.delete(chatId)

      const cardId = finished?.statusMessageId ?? prevLive?.cardId

      /*
        A postponed track's card has to stop claiming it is playing.

        Nothing repainted it before: `natural` was the only branch here, and a
        real skip is repainted by the button that did the skipping. A forced
        play goes through neither, so the interrupted track's card sat in the
        chat saying "Now Playing" about a track that had just been pushed back.
      */
      if (reason === 'postponed' && cardId && finished) {
        void serialCardEdit(cardId, () =>
          tg
            .editMessage({
              chatId,
              message: cardId,
              text: postponedCard(toInfo(finished), {
                at: resumeAtSec,
                name: by?.name,
                id: by?.id,
                youId: roomYou(String(chatId)),
              }),
              replyMarkup: undefined,
              invertMedia: false,
              disableWebPreview: true,
            })
            .catch(() => {}),
        )
      }

      if (reason === 'natural' && cardId && finished) {
        let replay = finished.replaySource as RoomReplayInfo | undefined
        if (!replay && finished.sourceUrl) {
          replay = {
            source: { kind: 'query', query: finished.sourceUrl },
            wantVideo: finished.video,
            quality: null,
          }
        }
        if (replay) registerRoomReplay(cardId, replay)
        void serialCardEdit(cardId, () =>
          tg
            .editMessage({
              chatId,
              message: cardId,
              text: finishedCard(toInfo(finished), youOf(chatId)),
              replyMarkup: replay ? replayKeyboard() : undefined,
              invertMedia: false,
              disableWebPreview: true,
            })
            .catch(() => {}),
        )
      }

      if (next) {
        void promoteNext(chatId, next)
      } else {
        stopRoomCard(chatId)
      }
    },
  })
}
