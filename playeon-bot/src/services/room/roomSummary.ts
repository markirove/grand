import { emojiTag } from '../../lib/emoji.js'
import { md } from '@mtcute/markdown-parser'
import { BotKeyboard, tl } from '@mtcute/node'
import { lines, paragraphs } from '../../lib/md.js'
import { mention } from '../../lib/mention.js'
import { titleOf } from '../playback/playcard.js'
import { roomManager } from './RoomManager.js'
import { isPersonalRoom, roomJoinUrl, joinRoomKeyboard } from './roomLink.js'
import { readRoomSettings } from './roomSettings.js'
import { AUTOPLAY_EMOJI } from '../../commands/playback/autoplay.js'

/**
 * What `/room` answers with, in group chats and in DMs alike.
 *
 * One builder for both, because they are the same card with a different name at
 * the top. It is a status board rather than a pitch: somebody typing `/room` in
 * a chat that already has one wants to know what is on and who is in there, and
 * every line has to be something they cannot find out from anywhere else.
 *
 * It is also the front page of a small menu. The two buttons under Join lead to
 * the style and mode pickers and back again, all by editing this one message,
 * so changing how the room looks never leaves a trail of dead cards in the
 * chat.
 */
const EMOJI = {
  room: emojiTag('✨', '6107332328273486711'),
} as const

/** Long titles get cut here. Telegram wraps, but a card should not. */
const TITLE_MAX = 46

/** Names listed before the rest become a count. */
const SHOWN = 6

function short(text: string): string {
  const clean = text.trim()
  if (clean.length <= TITLE_MAX) return clean
  return `${clean.slice(0, TITLE_MAX - 1).trimEnd()}…`
}

export type RoomSummary = {
  text: ReturnType<typeof md>
  replyMarkup: ReturnType<typeof BotKeyboard.inline>
}

/** What this room is called at the top of its card. */
export function roomHeading(roomId: string, chatTitle?: string | null): string {
  if (isPersonalRoom(roomId)) return 'Your Room'
  return `${chatTitle?.trim() || 'This group'}'s Room`
}

export async function roomSummary(
  roomId: string,
  chatTitle?: string | null,
): Promise<RoomSummary> {
  const snap = roomManager.getSnapshot(roomId)
  const { mode } = await readRoomSettings(roomId)

  const people = snap?.participants ?? []
  const track = snap?.current ?? null

  /*
    The mode belongs in the header, not in a line of its own.

    It is one word and it answers "what am I about to open", which is the same
    question the room's name answers. Sat on its own further down it read as a
    setting; sat next to the name it reads as what the room is.
  */
  const head = md`${md(EMOJI.room)} **${roomHeading(roomId, chatTitle)}  |  ${mode.toUpperCase()}**`

  /*
    A line about the track, or no line.

    Nothing replaces it when nothing is on. "Nothing is playing right now" is a
    sentence that exists to fill a space, and the card is shorter and reads
    better without it: what is left is the room, who is in it, and a button.
  */
  const playing = track
    ? md`**${!snap?.playing ? 'Paused' : track.video ? 'Streaming' : 'Now Playing'}:** ${titleOf(
        { title: short(track.title), sourceUrl: track.sourceUrl },
      )}`
    : md``

  /*
    Everyone gets their own line and their own mention.

    A comma-separated run of names reads as a list of strings; a bullet with a
    tappable name reads as people, which is what a room full of them is. Only
    the first few, because past that the card is a directory.
  */
  /*
    The owner of a personal room is "You" in it.

    Same reasoning as the join notice: a DM has one reader and it is the person
    the room belongs to. In a group there is no such person, so everybody keeps
    their name.
  */
  const personal = isPersonalRoom(roomId)
  const naming = (person: { id: string; name: string }) =>
    personal && person.id === roomId
      ? md`[**You**](tg://user?id=${person.id})`
      : mention(person.name, person.id)

  /*
    You first, everybody else in the order they arrived.

    A list you are on is read to find yourself in it, so the one name the reader
    already knows goes where they are already looking rather than three lines
    down among strangers.
  */
  const ordered = personal
    ? [...people].sort((a, b) => Number(b.id === roomId) - Number(a.id === roomId))
    : people

  const crowd = people.length
    ? lines(
        md`**People in the room (${people.length}):**`,
        ...ordered.slice(0, SHOWN).map((person) => md`•  ${naming(person)}`),
        people.length > SHOWN
          ? md`•  and ${people.length - SHOWN} more`
          : md``,
      )
    : md`No one is in the room right now.`

  const autoplayStatus = md`${AUTOPLAY_EMOJI} **Autoplay:** ${roomManager.getAutoplay(roomId) ? 'Enabled' : 'Disabled'}`

  return {
    text: paragraphs(head, playing, autoplayStatus, crowd),
    replyMarkup: roomMenu(roomId),
  }
}

/** Telegram's blue fill, for whichever option is the current one. */
export const ACTIVE_BUTTON: tl.RawKeyboardButtonStyle = {
  _: 'keyboardButtonStyle',
  bgPrimary: true,
}

/**
 * Join, and the way in to the settings about the room you can change.
 *
 * Styles, Modes, and Autoplay are shown to everybody and refused to anybody who cannot use
 * them, rather than hidden from them.
 */
export function roomMenu(roomId: string): ReturnType<typeof BotKeyboard.inline> {
  return BotKeyboard.inline([
    joinRoomKeyboard(roomId).buttons[0]!,
    [
      BotKeyboard.callback('Styles', 'rm:styles'),
      BotKeyboard.callback('Modes', 'rm:modes'),
      BotKeyboard.callback('Autoplay', 'rm:autoplay'),
    ],
  ])
}
