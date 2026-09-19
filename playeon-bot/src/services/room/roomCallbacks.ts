import { filters } from '@mtcute/dispatcher'
import type { CallbackQueryContext } from '@mtcute/dispatcher'
import type { BotKeyboard } from '@mtcute/node'
import type { md } from '@mtcute/markdown-parser'
import { dp, tg } from '../../client.js'
import { collections } from '../mongo.js'
import { SUCCESS_EMOJI } from '../../lib/feedback.js'
import { controlLine } from '../playback/playcard.js'
import { canControlRoomId } from '../auth/playbackControl.js'
import { getCancel, sameUser } from '../playback/cancel.js'
import { roomManager } from './RoomManager.js'
import { roomLiveCardId, takeRoomReplay } from './roomCards.js'
import { forgetQueuedCard, getQueuedCard } from './queuedCards.js'
import { performRoomReplay } from './roomFlow.js'
import { isPersonalRoom, roomYou } from './roomLink.js'
import { isRoomStyleId, readRoomSettings, styleById } from './roomSettings.js'
import {
  applyModePick,
  applyStylePick,
  canConfigureRoom,
  modeKeyboard,
  modeMessage,
  parseModeCallback,
  parseStyleCallback,
  styleKeyboard,
  styleMessage,
} from './roomSettingsFlow.js'
import { roomSummary } from './roomSummary.js'
import { deleteStaleCard } from '../../lib/tempMessages.js'
import { autoplayCardText, autoplayKeyboard } from '../../commands/playback/autoplay.js'

const NO_CONTROL = 'Only video-chat admins or authorized users can control playback. Ask an admin to /auth you.'

const NO_QUEUE_DELETE =
  'Only whoever queued this track, or a video-chat admin, can remove it.'

const NO_STYLE_CONTROL = 'Only admins with the Manage Video Chats right can change this room.'

/**
 * The chat's own name, where it has one.
 *
 * A private chat is a `User` and has no title at all, which is fine: a personal
 * room is named after its owner rather than after the conversation.
 */
function chatTitleOf(chat: unknown): string | null {
  const named = chat as { title?: string | null }
  return typeof named.title === 'string' ? named.title : null
}

/** Swap what a card says and what its buttons are, in place. */
function repaint(
  cq: CallbackQueryContext,
  text: ReturnType<typeof md>,
  replyMarkup: ReturnType<typeof BotKeyboard.inline>,
): Promise<unknown> {
  return cq.client
    .editMessage({
      chatId: cq.chat.id,
      message: cq.messageId,
      text,
      replyMarkup,
      disableWebPreview: true,
    })
    .catch(() => {})
}

export function registerRoomCallbacks(): void {
  dp.onCallbackQuery(filters.regex(/^pr:toggle$/), async (cq) => {
    const chatId = cq.chat.id
    const groupId = String(chatId)
    if (!(await canControlRoomId(groupId, cq.user.id))) {
      await cq.answer({ text: NO_CONTROL, alert: true })
      return
    }
    const currentCard = roomLiveCardId(chatId)
    if (!currentCard || cq.messageId !== currentCard) {
      await cq.answer({ text: 'This interaction is no longer valid', alert: true })
      deleteStaleCard(cq)
      return
    }
    const snap = roomManager.getSnapshot(groupId)
    if (!snap?.current) {
      await cq.answer({ text: 'This interaction is no longer valid', alert: true })
      deleteStaleCard(cq)
      return
    }
    const video = snap.current.video
    const who = { name: cq.user.displayName, id: cq.user.id, youId: roomYou(groupId) }
    if (snap.playing) {
      roomManager.pause(groupId, cq.user.displayName, String(cq.user.id))
      await cq.answer({ text: 'Paused' })
      const line = controlLine({ video, action: 'paused', ...who })
      void cq.client.sendText(chatId, line, { replyTo: cq.messageId }).catch(() => {})
    } else {
      roomManager.play(groupId, cq.user.displayName, String(cq.user.id))
      await cq.answer({ text: 'Resumed' })
      const line = controlLine({ video, action: 'resumed', ...who })
      void cq.client.sendText(chatId, line, { replyTo: cq.messageId }).catch(() => {})
    }
    // the card repaints itself via RoomLifecycle.onTransport
  })

  dp.onCallbackQuery(filters.regex(/^pr:skip$/), async (cq) => {
    const chatId = cq.chat.id
    const groupId = String(chatId)
    const snap = roomManager.getSnapshot(groupId)
    const isRequester = snap?.current?.requestedById === String(cq.user.id)
    if (!isRequester && !(await canControlRoomId(groupId, cq.user.id))) {
      await cq.answer({ text: NO_CONTROL, alert: true })
      return
    }
    const currentCard = roomLiveCardId(chatId)
    if (!currentCard || cq.messageId !== currentCard) {
      await cq.answer({ text: 'This interaction is no longer valid', alert: true })
      deleteStaleCard(cq)
      return
    }
    const video = roomManager.getSnapshot(groupId)?.current?.video ?? false
    const oldCard = currentCard
    const res = roomManager.skip(groupId, cq.user.displayName, String(cq.user.id))
    if (res === 'nothing') {
      await cq.answer({ text: 'This interaction is no longer valid', alert: true })
      deleteStaleCard(cq)
      return
    }
    if (oldCard) {
      void cq.client
        .editMessage({
          chatId,
          message: oldCard,
          text: controlLine({ video, action: 'skipped', name: cq.user.displayName, id: cq.user.id, youId: roomYou(groupId) }),
          invertMedia: false,
          disableWebPreview: true,
        })
        .catch(() => {})
    }
    await cq.answer({ text: res === 'skipped_last' ? 'Skipped - the room queue is empty.' : 'Skipped' })
  })

  /*
    The style picker.

    Repaints its own message rather than sending a new one: the picker is a
    radio group, and a radio group that answers a click with another copy of
    itself further down the chat leaves the reader deciding which of the two is
    the truth. Edited in place, the marked button moves and that is the whole
    feedback - the toast is only there for the case where nothing changed.
  */
  dp.onCallbackQuery(filters.regex(/^rsb?:[a-z0-9_-]+$/), async (cq) => {
    const groupId = String(cq.chat.id)
    const { id: picked, from } = parseStyleCallback(cq.dataStr ?? '')
    if (!isRoomStyleId(picked)) {
      await cq.answer({ text: 'That style is no longer available.', alert: true })
      return
    }

    const result = await applyStylePick(groupId, cq.user.id, picked)
    if (!result.ok) {
      await cq.answer({ text: NO_STYLE_CONTROL, alert: true })
      return
    }

    const style = styleById(picked)
    if (!result.changed) {
      await cq.answer({ text: `Already ${style.label}.` })
      return
    }

    await cq.answer({ text: `Style set to ${style.label}.` })
    await repaint(cq, styleMessage(picked, isPersonalRoom(groupId)), styleKeyboard(picked, from))
  })

  /*
    The room card's little menu: two screens and a way back, all on the one
    message.

    Editing in place rather than sending is the whole point. A picker that
    answers with a new message leaves the chat holding several cards that each
    claim to describe the room, and only one of them is still true.
  */
  dp.onCallbackQuery(filters.regex(/^rm:(styles|modes|autoplay|back)$/), async (cq) => {
    const roomId = String(cq.chat.id)
    const screen = (cq.dataStr ?? '').slice(3)

    if (screen === 'back') {
      const card = await roomSummary(roomId, chatTitleOf(cq.chat))
      await cq.answer({})
      await repaint(cq, card.text, card.replyMarkup)
      return
    }

    if (!(await canConfigureRoom(roomId, cq.user.id))) {
      await cq.answer({ text: NO_STYLE_CONTROL, alert: true })
      return
    }

    const settings = await readRoomSettings(roomId)
    await cq.answer({})
    if (screen === 'styles') {
      await repaint(
        cq,
        styleMessage(settings.style, isPersonalRoom(roomId)),
        styleKeyboard(settings.style, 'card'),
      )
    } else if (screen === 'modes') {
      await repaint(cq, modeMessage(settings.mode), modeKeyboard(settings.mode))
    } else if (screen === 'autoplay') {
      const enabled = roomManager.getAutoplay(roomId)
      await repaint(cq, autoplayCardText(enabled), autoplayKeyboard(roomId, enabled, 'room'))
    }
  })

  dp.onCallbackQuery(filters.regex(/^rd:(2d|3d)$/), async (cq) => {
    const roomId = String(cq.chat.id)
    const picked = parseModeCallback(cq.dataStr ?? '') as '2d' | '3d'

    const result = await applyModePick(roomId, cq.user.id, picked)
    if (!result.ok) {
      await cq.answer({ text: NO_STYLE_CONTROL, alert: true })
      return
    }
    if (!result.changed) {
      await cq.answer({ text: `Already ${picked.toUpperCase()}.` })
      return
    }

    await cq.answer({ text: `Room set to ${picked.toUpperCase()}.` })
    await repaint(cq, modeMessage(picked), modeKeyboard(picked))
  })

  /*
    The two buttons on a queued card.

    Both look the card up by the message they are printed on rather than
    carrying a track id, so the payload stays tiny and cannot be forged into
    pointing at somebody else's track. A card the process has forgotten - after
    a restart - says so instead of doing nothing.
  */
  dp.onCallbackQuery(filters.regex(/^pq:(play|del)$/), async (cq) => {
    const card = getQueuedCard(cq.chat.id, cq.messageId)
    if (!card) {
      await cq.answer({ text: 'This interaction is no longer valid', alert: true })
      deleteStaleCard(cq)
      return
    }

    const action = (cq.dataStr ?? '').slice(3)
    const controls = await canControlRoomId(card.roomId, cq.user.id)

    if (action === 'play') {
      if (!controls) {
        await cq.answer({ text: NO_CONTROL, alert: true })
        return
      }
      const res = roomManager.forcePlay(
        card.roomId,
        card.trackId,
        cq.user.displayName,
        String(cq.user.id),
      )
      if (res !== 'ok') {
        await cq.answer({ text: 'This interaction is no longer valid', alert: true })
        forgetQueuedCard(cq.chat.id, cq.messageId)
        deleteStaleCard(cq, card.commandMsgId)
        return
      }
      await cq.answer({ text: 'Playing now.' })
      forgetQueuedCard(cq.chat.id, cq.messageId)
      return
    }

    /*
      Delete is the requester's own button, and an admin's.

      Whoever queued a track can take it back without needing rights over the
      room - it is theirs. Anybody else needs the same control rights that let
      them skip it, which is the same power by another route.
    */
    const theirs =
      card.requesterId != null && card.requesterId === String(cq.user.id)
    if (!theirs && !controls) {
      await cq.answer({ text: NO_QUEUE_DELETE, alert: true })
      return
    }

    const removed = await roomManager.removeQueued(card.roomId, card.trackId)
    if (!removed) {
      await cq.answer({ text: 'This interaction is no longer valid', alert: true })
      forgetQueuedCard(cq.chat.id, cq.messageId)
      deleteStaleCard(cq, card.commandMsgId)
      return
    }
    await cq.answer({ text: 'Removed from the queue.' })
    forgetQueuedCard(cq.chat.id, cq.messageId)

    // the card, and the message that asked for it
    deleteStaleCard(cq, card.commandMsgId)
  })

  dp.onCallbackQuery(filters.regex(/^pb:cancel$/), async (cq) => {
    const entry = getCancel(cq.chat.id, cq.messageId)
    if (!entry) {
      await cq.answer({ text: 'This interaction is no longer valid', alert: true })
      deleteStaleCard(cq)
      return
    }
    if (!sameUser(entry.requesterId, cq.user.id)) {
      await cq.answer({ text: 'Only the person who requested this can cancel it', alert: true })
      return
    }
    entry.abort()
    await cq.answer({ text: 'Canceling…' })
  })

  dp.onCallbackQuery(filters.regex(/^pb:replay$/), async (cq) => {
    const info = takeRoomReplay(cq.messageId)
    if (!info) {
      await cq.answer({ text: 'This interaction is no longer valid', alert: true })
      deleteStaleCard(cq)
      return
    }
    await cq.answer({ text: 'Replaying…' })
    await cq.client
      .editMessage({
        chatId: cq.chat.id,
        message: cq.messageId,
        replyMarkup: undefined,
      })
      .catch(() => {})
    await performRoomReplay(tg, collections, cq.chat.id, info, cq.user.displayName, String(cq.user.id)).catch(() => {})
  })
}
