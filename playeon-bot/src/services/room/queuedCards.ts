import { BotKeyboard, tl } from '@mtcute/node'
import Long from 'long'
import { roomJoinUrl } from './roomLink.js'
import { WORD_JOINER, PLAY_EMOJI_ID, JOIN_EMOJI_ID, REMOVE_EMOJI_ID } from '../../lib/emoji.js'

/**
 * What each "added to the queue" card is about.
 *
 * The card's two buttons need three things the callback cannot see: which track
 * the card is for, which message asked for it, and who asked. None of that fits
 * in callback data - a track id alone is a 36-character UUID and Telegram allows
 * 64 bytes for the whole payload - so the card is looked up by the message it is
 * printed on, and the buttons carry nothing but a verb.
 *
 * Held in memory, like every other registry here. A restart makes old buttons
 * inert, which the handlers answer with a plain "this card has expired" rather
 * than pretending to work.
 */
export type QueuedCard = {
  roomId: string
  trackId: string
  /** The message that asked for the track, so Delete can take it too. */
  commandMsgId?: number
  /** Who queued it. They may delete it without being an admin. */
  requesterId?: string
}

const cards = new Map<string, QueuedCard>()

/** Plenty for any real chat, and a ceiling so a busy month cannot grow forever. */
const MAX = 500

function key(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`
}

export function rememberQueuedCard(
  chatId: number,
  messageId: number,
  card: QueuedCard,
): void {
  const at = key(chatId, messageId)
  cards.delete(at)
  cards.set(at, card)
  if (cards.size > MAX) {
    const oldest = cards.keys().next().value
    if (oldest !== undefined) cards.delete(oldest)
  }
}

export function getQueuedCard(chatId: number, messageId: number): QueuedCard | null {
  return cards.get(key(chatId, messageId)) ?? null
}

export function forgetQueuedCard(chatId: number, messageId: number): void {
  cards.delete(key(chatId, messageId))
}

/**
 * Join, then the two things you can do to the track that was just queued.
 *
 * Join stays on top for the same reason it does on every other room card: it is
 * the only button everybody in the chat can press.
 */
const JOIN_STYLE: tl.RawKeyboardButtonStyle = {
  _: 'keyboardButtonStyle',
  bgPrimary: true,
  icon: Long.fromString(JOIN_EMOJI_ID),
}
const PLAY_STYLE: tl.RawKeyboardButtonStyle = {
  _: 'keyboardButtonStyle',
  bgSuccess: true,
  icon: Long.fromString(PLAY_EMOJI_ID),
}
const REMOVE_STYLE: tl.RawKeyboardButtonStyle = {
  _: 'keyboardButtonStyle',
  bgDanger: true,
  icon: Long.fromString(REMOVE_EMOJI_ID),
}

export function queuedKeyboard(roomId: string): ReturnType<typeof BotKeyboard.inline> {
  return BotKeyboard.inline([
    [BotKeyboard.url('Join Room', roomJoinUrl(roomId), { style: JOIN_STYLE })],
    [
      BotKeyboard.callback(WORD_JOINER, 'pq:play', { style: PLAY_STYLE }),
      BotKeyboard.callback(WORD_JOINER, 'pq:del', { style: REMOVE_STYLE }),
    ],
  ])
}
