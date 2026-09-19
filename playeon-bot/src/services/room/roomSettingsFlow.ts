import { customEmoji } from '../../lib/emoji.js'
import { md } from '@mtcute/markdown-parser'
import { BotKeyboard, tl } from '@mtcute/node'
import { tg } from '../../client.js'
import type { CommandContext } from '../../core/command.js'
import { hasChatAdminRights, resolveRoleByIds } from '../../core/permissions.js'
import { WARNING_EMOJI, SUCCESS_EMOJI, INFO_EMOJI } from '../../lib/feedback.js'
import type { RoomMode, RoomStyleId } from '../../models/roomAccess.js'
import { isPersonalRoom } from './roomLink.js'
import {
  ROOM_STYLES,
  readRoomSettings,
  styleById,
  writeRoomMode,
  writeRoomStyle,
} from './roomSettings.js'

/** The shooting star, as a premium emoji for styles. */
const STYLE_EMOJI = customEmoji('🌠', '6106891875082313974')

/** The door emoji for room modes. */
const MODE_EMOJI = customEmoji('🚪', '6107411432981143297')

/** How the modes read in a sentence. */
const MODE_LABEL: Record<RoomMode, string> = { '2d': '2D', '3d': '3D' }

const MODE_BLURB: Record<RoomMode, string> = {
  '2d': 'Join opens the player, with the queue, the lyrics and everyone listening.',
  '3d': 'Join opens the lounge, a room you walk around in with a couch for six.',
}

/**
 * Who may change how a room looks.
 *
 * Stricter than playback control on purpose. `/auth` hands someone the queue
 * for an evening; this changes what the room *is* for everybody who opens it
 * afterwards, so it stays with the people who run the video chat. A personal
 * room answers to the one person whose room it is.
 */
export async function canConfigureRoom(roomId: string, userId: number): Promise<boolean> {
  if (isPersonalRoom(roomId)) return roomId === String(userId)
  const chat = await tg.getChat(Number(roomId)).catch(() => null)
  if (!chat) return false
  const role = await resolveRoleByIds(userId, Number(roomId), chat)
  return hasChatAdminRights(role, ['manageVideoChats']).ok
}

/**
 * Which screen a pick was made from.
 *
 * Carried in the callback data rather than remembered anywhere, because the
 * only thing it changes is whether the picker keeps its Back button, and a
 * button cannot be asked where it came from. Stateless: the message can be
 * hours old and pressing it still does the right thing.
 */
export type Origin = 'command' | 'card'

const STYLE_PREFIX = 'rs:'
const STYLE_CARD_PREFIX = 'rsb:'
const MODE_PREFIX = 'rd:'

export function styleCallbackData(id: RoomStyleId, from: Origin): string {
  return `${from === 'card' ? STYLE_CARD_PREFIX : STYLE_PREFIX}${id}`
}

export function parseStyleCallback(data: string): { id: string; from: Origin } {
  return data.startsWith(STYLE_CARD_PREFIX)
    ? { id: data.slice(STYLE_CARD_PREFIX.length), from: 'card' }
    : { id: data.slice(STYLE_PREFIX.length), from: 'command' }
}

export function parseModeCallback(data: string): string {
  return data.slice(MODE_PREFIX.length)
}

/** Applying a pick from the mode picker. Same shape as the style one. */
export async function applyModePick(
  roomId: string,
  userId: number,
  picked: RoomMode,
): Promise<{ ok: true; changed: boolean } | { ok: false }> {
  if (!(await canConfigureRoom(roomId, userId))) return { ok: false }
  const { mode } = await readRoomSettings(roomId)
  if (mode === picked) return { ok: true, changed: false }
  await writeRoomMode(roomId, picked, String(userId))
  return { ok: true, changed: true }
}

/**
 * The picker: one row per style, the current one painted.
 *
 * `bgPrimary` is Telegram's own blue button fill, which is what a radio group
 * wants - the selected option is a different object on the screen rather than
 * the same object with a marker glued to its label. Nothing else in the group
 * is styled, so the filled one is the only thing the eye has to find, and the
 * labels stay the style names alone.
 */
const ACTIVE_STYLE: tl.RawKeyboardButtonStyle = {
  _: 'keyboardButtonStyle',
  bgPrimary: true,
}

/** Styles to a row. Two fits the labels and halves the height of the picker. */
const PER_ROW = 2

export function styleKeyboard(
  active: RoomStyleId,
  from: Origin = 'command',
): ReturnType<typeof BotKeyboard.inline> {
  const buttons = ROOM_STYLES.map((style) =>
    BotKeyboard.callback(
      style.label,
      styleCallbackData(style.id, from),
      style.id === active ? { style: ACTIVE_STYLE } : undefined,
    ),
  )

  const rows: (typeof buttons)[] = []
  for (let at = 0; at < buttons.length; at += PER_ROW) {
    rows.push(buttons.slice(at, at + PER_ROW))
  }
  if (from === 'card') rows.push([BotKeyboard.callback('Back', 'rm:back')])
  return BotKeyboard.inline(rows)
}

/**
 * The mode picker, which is the same idea as the style one.
 *
 * Both modes are always shown and the current one is filled in, rather than
 * offering only the one you are not on. A toggle labelled with its opposite is
 * the classic way to leave somebody unsure which state they are in.
 */
export function modeMessage(active: RoomMode): ReturnType<typeof md> {
  return md`${MODE_EMOJI} **Room Mode: ${MODE_LABEL[active]}**

${MODE_BLURB[active]}

Anyone already inside keeps what they opened. The change kicks in next time someone taps Join.`
}

export function modeKeyboard(active: RoomMode): ReturnType<typeof BotKeyboard.inline> {
  const button = (mode: RoomMode) =>
    BotKeyboard.callback(
      MODE_LABEL[mode],
      `${MODE_PREFIX}${mode}`,
      mode === active ? { style: ACTIVE_STYLE } : undefined,
    )
  return BotKeyboard.inline([
    [button('2d'), button('3d')],
    [BotKeyboard.callback('Back', 'rm:back')],
  ])
}

export function styleMessage(active: RoomStyleId, personal: boolean): ReturnType<typeof md> {
  const style = styleById(active)
  const whose = personal ? 'you invite' : 'joins'
  return md`${STYLE_EMOJI} **Room Style: ${style.label}**

${style.blurb}

Everyone who ${whose} gets this look. Tap one below to switch.`
}

export async function performRoomStyle(ctx: CommandContext): Promise<void> {
  const roomId = String(ctx.msg.chat.id)
  const { style } = await readRoomSettings(roomId)
  await ctx.msg.replyText(styleMessage(style, isPersonalRoom(roomId)), {
    replyMarkup: styleKeyboard(style),
    disableWebPreview: true,
  })
}

export async function performRoomMode(ctx: CommandContext, mode: RoomMode): Promise<void> {
  const roomId = String(ctx.msg.chat.id)
  const current = await readRoomSettings(roomId)

  if (current.mode === mode) {
    await ctx.msg.replyText(
      md`${INFO_EMOJI} This room is already **${MODE_LABEL[mode]}**. ${MODE_BLURB[mode]}`,
    )
    return
  }

  await writeRoomMode(roomId, mode, String(ctx.msg.sender.id))
  await ctx.msg.replyText(
    md`${SUCCESS_EMOJI} Room set to **${MODE_LABEL[mode]}**. ${MODE_BLURB[mode]}

Anyone already inside keeps what they opened. The change kicks in next time someone taps Join.`,
  )
}

/**
 * Applying a pick from the picker.
 *
 * Returns what the caller should say, rather than saying it, because the
 * callback has two things to answer: the toast on the button and the message
 * the buttons are attached to.
 */
export async function applyStylePick(
  roomId: string,
  userId: number,
  picked: RoomStyleId,
): Promise<{ ok: true; changed: boolean } | { ok: false }> {
  if (!(await canConfigureRoom(roomId, userId))) return { ok: false }
  const { style } = await readRoomSettings(roomId)
  if (style === picked) return { ok: true, changed: false }
  await writeRoomStyle(roomId, picked, String(userId))
  return { ok: true, changed: true }
}
