import { md } from '@mtcute/markdown-parser'
import { BotKeyboard, Long, tl } from '@mtcute/node'
import { botInfo } from '../client.js'
import { config } from '../config.js'
import { paragraphs } from './md.js'
import { roomJoinUrl } from '../services/room/roomLink.js'
import { JOIN_EMOJI_ID } from './emoji.js'

const JOIN_STYLE: tl.RawKeyboardButtonStyle = {
  _: 'keyboardButtonStyle',
  bgPrimary: true,
  icon: Long.fromString(JOIN_EMOJI_ID),
}

export function startText(firstName: string | null, userId: number): ReturnType<typeof md> {
  const user = md`[${firstName ?? 'there'}](tg://user?id=${userId})`
  const bot = botInfo.username
    ? md`[**Playeon**](https://t.me/${botInfo.username})`
    : md`**Playeon**`

  return paragraphs(
    md`**Hey ${user}**, welcome to ${bot}.`,
    md`Stream synchronized **YouTube** music and video directly inside Telegram web rooms.`,
    md`Tap below to launch your personal player or add ${bot} to a group.`,
  )
}

export function groupStartText(firstName: string | null, userId: number): ReturnType<typeof md> {
  const user = md`[${firstName ?? 'there'}](tg://user?id=${userId})`
  const bot = botInfo.username
    ? md`[**Playeon**](https://t.me/${botInfo.username})`
    : md`**Playeon**`

  return paragraphs(
    md`**Hey ${user}**, welcome to ${bot}.`,
    md`Stream synchronized **YouTube** music and video directly inside Telegram web rooms.`,
    md`Tap below to launch the room lounge or explore the guide.`,
  )
}

export function startKeyboard(origin: number, userId?: number) {
  const rows: (ReturnType<typeof BotKeyboard.url> | ReturnType<typeof BotKeyboard.callback>)[][] = []

  if (userId) {
    rows.push([
      BotKeyboard.url('Open Room', roomJoinUrl(String(userId)), { style: JOIN_STYLE }),
      BotKeyboard.url('Add to Group', `https://t.me/${botInfo.username}?startgroup=true`),
    ])
  } else {
    rows.push([
      BotKeyboard.url('Add to Group', `https://t.me/${botInfo.username}?startgroup=true`),
    ])
  }

  rows.push([
    BotKeyboard.callback('Help & Commands', `help:menu:${origin}:s`),
  ])

  rows.push([
    BotKeyboard.url('Channel', config.links.channelUrl),
    BotKeyboard.url('Support', config.links.supportUrl),
  ])

  return BotKeyboard.inline(rows)
}

export function groupStartKeyboard(groupId?: string) {
  const rows: (ReturnType<typeof BotKeyboard.url> | ReturnType<typeof BotKeyboard.callback>)[][] = []

  if (groupId) {
    rows.push([
      BotKeyboard.url('Open Room', roomJoinUrl(groupId), { style: JOIN_STYLE }),
      BotKeyboard.url('Help & Commands', `https://t.me/${botInfo.username}?start=guide`),
    ])
  } else {
    rows.push([
      BotKeyboard.url('Help & Commands', `https://t.me/${botInfo.username}?start=guide`),
    ])
  }

  rows.push([
    BotKeyboard.url('Channel', config.links.channelUrl),
    BotKeyboard.url('Support', config.links.supportUrl),
  ])

  return BotKeyboard.inline(rows)
}

export function groupIntroText(
  chatTitle: string,
  actor?: { firstName?: string | null; id?: number } | null,
): ReturnType<typeof md> {
  const bot = botInfo.username
    ? md`[**Playeon**](https://t.me/${botInfo.username})`
    : md`**Playeon**`

  const user = actor?.id
    ? md`[${actor.firstName ?? 'there'}](tg://user?id=${actor.id})`
    : null

  const greeting = user
    ? md`**Hey ${user}**, thanks for adding ${bot} to **${chatTitle}**.`
    : md`**Hey everyone**, welcome to ${bot} in **${chatTitle}**.`

  return paragraphs(
    greeting,
    md`Stream synchronized **YouTube** music and video directly inside Telegram web rooms.`,
    md`Tap below to launch the room lounge or explore the guide.`,
  )
}

export function groupIntroKeyboard(groupId?: string) {
  return groupStartKeyboard(groupId)
}
