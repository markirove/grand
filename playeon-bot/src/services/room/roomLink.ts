import { createHmac } from 'node:crypto'
import { md } from '@mtcute/markdown-parser'
import { BotKeyboard, tl } from '@mtcute/node'
import Long from 'long'
import { config } from '../../config.js'
import { botInfo } from '../../client.js'
import { WORD_JOINER, PLAY_EMOJI_ID, PAUSE_EMOJI_ID, SKIP_EMOJI_ID, JOIN_EMOJI_ID } from '../../lib/emoji.js'

export function roomBotUsername(): string {
  return config.room.botUsername || botInfo.username
}

export function isPersonalRoom(groupId: string): boolean {
  const n = Number(groupId)
  return Number.isInteger(n) && n > 0
}

export function roomYou(groupId: string): string | undefined {
  return isPersonalRoom(groupId) ? groupId : undefined
}

function personalRoomSig(userId: string): string {
  return createHmac('sha256', config.room.jwtSecret)
    .update(`room:personal:${userId}`)
    .digest('base64url')
    .slice(0, 16)
}

export function roomStartParam(groupId: string): string {
  return isPersonalRoom(groupId) ? `p${groupId}_${personalRoomSig(groupId)}` : groupId
}

export function roomJoinUrl(groupId: string): string {
  return `https://t.me/${roomBotUsername()}/room?startapp=${roomStartParam(groupId)}`
}

/**
 * The one-button keyboard, blue like every other Join in the bot.
 *
 * Styled here rather than at each call site because this is the same button
 * wherever it appears: inline results, the join notice, the invite, an idle
 * room card. A colour that means "the way in" only means it if it is the same
 * colour every time.
 */
/*
  One colour language across every room keyboard: blue is the way in, green
  starts playback, red takes something away.

  Pause is the exception and stays unstyled. Resume starts playback so it is
  green like Play Now, but painting a stop green would be the button lying about
  what it does, and Telegram offers no third colour to reach for.
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
const PAUSE_STYLE: tl.RawKeyboardButtonStyle = {
  _: 'keyboardButtonStyle',
  icon: Long.fromString(PAUSE_EMOJI_ID),
}
const SKIP_STYLE: tl.RawKeyboardButtonStyle = {
  _: 'keyboardButtonStyle',
  bgDanger: true,
  icon: Long.fromString(SKIP_EMOJI_ID),
}

export function joinRoomKeyboard(groupId: string): ReturnType<typeof BotKeyboard.inline> {
  return BotKeyboard.inline([
    [BotKeyboard.url('Join Room', roomJoinUrl(groupId), { style: JOIN_STYLE })],
  ])
}

export const inlineJoinRoomKeyboard = joinRoomKeyboard

export function roomInviteMessage(inviterName: string, groupId: string): {
  text: ReturnType<typeof md>
  replyMarkup: ReturnType<typeof BotKeyboard.inline>
} {
  const text = md`**${inviterName}** invited you to their room on **Playeon** - watch videos and listen to music **together**, in perfect sync.

Tap **Join Room** to hop in.`
  return { text, replyMarkup: inlineJoinRoomKeyboard(groupId) }
}

export function roomControlsKeyboard(groupId: string, paused: boolean): ReturnType<typeof BotKeyboard.inline> {
  /*
    Join on top, transport underneath.

    Join is what most people reading the card want and the only thing everybody
    is allowed to press - Pause and Skip refuse anyone without control rights.
    The primary action should not be the last row, under two buttons that will
    turn most readers away.
  */
  return BotKeyboard.inline([
    [BotKeyboard.url('Join Room', roomJoinUrl(groupId), { style: JOIN_STYLE })],
    [
      BotKeyboard.callback(WORD_JOINER, 'pr:toggle', {
        style: paused ? PLAY_STYLE : PAUSE_STYLE,
      }),
      BotKeyboard.callback(WORD_JOINER, 'pr:skip', { style: SKIP_STYLE }),
    ],
  ])
}
