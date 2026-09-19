import { defineCommand, Role } from '../../core/command.js'
import { requirePlaybackControl, canControlRoomId } from '../../services/auth/playbackControl.js'
import { roomManager } from '../../services/room/RoomManager.js'
import { SUCCESS_EMOJI, WARNING_EMOJI } from '../../lib/feedback.js'
import { md } from '@mtcute/markdown-parser'
import { BotKeyboard } from '@mtcute/node'
import { dp } from '../../client.js'
import { filters } from '@mtcute/dispatcher'
import { customEmoji } from '../../lib/emoji.js'
import { emojiCallbackButton } from '../../lib/keyboard.js'
import { deleteStaleCard } from '../../lib/tempMessages.js'

export const AUTOPLAY_EMOJI = customEmoji('✨', '6107285762238062894')

export function autoplayCardText(enabled: boolean): ReturnType<typeof md> {
  const stateStr = enabled ? 'Enabled' : 'Disabled'
  return md`${AUTOPLAY_EMOJI} **Autoplay Mode:** **${stateStr}**

When autoplay is on, the room automatically picks and plays similar music recommendations when the queue ends.`
}

export function autoplayKeyboard(
  groupId: string,
  enabled: boolean,
  mode: 'cmd' | 'room' = 'cmd',
  cmdMsgId: number = 0,
): ReturnType<typeof BotKeyboard.inline> {
  const enabledBtn = enabled
    ? emojiCallbackButton('Enabled', `ap:set:${groupId}:1:${mode}:${cmdMsgId}`, undefined, 'blue')
    : BotKeyboard.callback('Enabled', `ap:set:${groupId}:1:${mode}:${cmdMsgId}`)

  const disabledBtn = !enabled
    ? emojiCallbackButton('Disabled', `ap:set:${groupId}:0:${mode}:${cmdMsgId}`, undefined, 'blue')
    : BotKeyboard.callback('Disabled', `ap:set:${groupId}:0:${mode}:${cmdMsgId}`)

  const bottomRow = mode === 'room'
    ? [BotKeyboard.callback('Back', 'rm:back')]
    : [BotKeyboard.callback('Close', `ap:close:${cmdMsgId}`)]

  return BotKeyboard.inline([
    [enabledBtn, disabledBtn],
    bottomRow,
  ])
}

export default defineCommand({
  name: 'autoplay',
  aliases: ['ap', 'radiomode'],
  order: 13,
  description:
    'Toggle autoplay/radio mode in the room. When enabled, the bot automatically selects and plays unpersonalized similar tracks when the queue runs out.',
  summary: 'Keep playing similar tracks when queue finishes.',
  usage: '/autoplay [on | off | toggle]',
  category: 'playback',
  contexts: ['supergroup', 'group', 'private'],

  reply: true,
  roles: [Role.USER, Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],
  permissions: { custom: requirePlaybackControl() },

  handler: async (ctx) => {
    const groupId = String(ctx.msg.chat.id)
    const arg = ctx.rawArgs.trim().toLowerCase()
    const current = roomManager.getAutoplay(groupId)

    let nextState: boolean
    if (arg === 'on' || arg === 'enable' || arg === 'true' || arg === '1') {
      nextState = true
    } else if (arg === 'off' || arg === 'disable' || arg === 'false' || arg === '0') {
      nextState = false
    } else if (arg === 'toggle') {
      nextState = !current
    } else if (!arg) {
      await ctx.msg.replyText(
        autoplayCardText(current),
        { replyMarkup: autoplayKeyboard(groupId, current, 'cmd', ctx.msg.id) },
      )
      return
    } else {
      await ctx.msg.replyText(
        md`${WARNING_EMOJI} Usage: \`${ctx.prefix}autoplay on\`, \`${ctx.prefix}autoplay off\`, or \`${ctx.prefix}autoplay toggle\`.`,
      )
      return
    }

    roomManager.setAutoplay(groupId, nextState)
    const statusText = nextState ? 'Enabled' : 'Disabled'
    await ctx.msg.replyText(
      md`${AUTOPLAY_EMOJI} Autoplay is now **${statusText}** for this room. ${nextState ? 'The room will seamlessly keep playing recommendations when the queue runs out.' : 'Playback will stop when the queue finishes.'}`,
    )
  },
})

export function registerAutoplayCallbacks(): void {
  // Radio button tap: ap:set:<groupId>:<0|1>:<cmd|room>:<cmdMsgId>
  dp.onCallbackQuery(filters.regex(/^ap:set:(-?\d+):(0|1):(cmd|room):(\d+)$/), async (cq) => {
    const groupId = cq.match![1]!
    const targetState = cq.match![2] === '1'
    const mode = cq.match![3] as 'cmd' | 'room'
    const cmdMsgId = Number(cq.match![4]) || 0

    if (!(await canControlRoomId(groupId, cq.user.id))) {
      await cq.answer({
        text: 'Only video-chat admins or authorized users can change autoplay settings.',
        alert: true,
      })
      return
    }

    const current = roomManager.getAutoplay(groupId)
    if (current === targetState) {
      await cq.answer({ text: `Already ${targetState ? 'Enabled' : 'Disabled'}.` })
      return
    }

    roomManager.setAutoplay(groupId, targetState)
    await cq.answer({ text: `Autoplay ${targetState ? 'Enabled' : 'Disabled'}.` })

    await cq.client.editMessage({
      chatId: cq.chat.id,
      message: cq.messageId,
      text: autoplayCardText(targetState),
      replyMarkup: autoplayKeyboard(groupId, targetState, mode, cmdMsgId),
      disableWebPreview: true,
    }).catch(() => {})
  })

  // Close button tap: ap:close:<cmdMsgId> -> deletes response and command message
  dp.onCallbackQuery(filters.regex(/^ap:close:(\d+)$/), async (cq) => {
    const cmdMsgId = Number(cq.match![1]) || undefined
    deleteStaleCard(cq, cmdMsgId)
  })
}
