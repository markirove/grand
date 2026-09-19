import { md } from '@mtcute/markdown-parser'
import { defineCommand, Role } from '../../core/command.js'
import { roomManager } from '../../services/room/RoomManager.js'
import { roomLiveCardId, stopRoomCard, serialCardEdit } from '../../services/room/roomCards.js'
import { canControlPlayback } from '../../services/auth/playbackControl.js'
import { SUCCESS_EMOJI, WARNING_EMOJI, INFO_EMOJI } from '../../lib/feedback.js'

export default defineCommand({
  name: 'reboot',
  order: 13,
  description: 'Reset your room - stop playback, clear the queue, and disconnect everyone.',
  summary: 'Reset the room - stop playback and disconnect everyone.',
  usage: '/reboot',
  category: 'playback',
  contexts: 'any',
  reply: true,
  roles: [Role.USER, Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],

  permissions: {
    custom: async (ctx) => {
      if (ctx.msg.chat.type === 'user') return true
      if (await canControlPlayback(ctx.db, ctx.msg.chat.id, ctx.msg.sender.id, ctx.role)) return true
      await ctx.msg.replyText(md`${WARNING_EMOJI} Only video-chat admins or authorized users can reboot the room.`)
      return false
    },
  },

  handler: async (ctx) => {
    const { msg, tg } = ctx
    const chatId = msg.chat.id
    const roomId = String(chatId)

    const oldCard = roomLiveCardId(chatId)

    const rebooted = await roomManager.reboot(roomId)
    if (!rebooted) {
      await msg.replyText(md`${INFO_EMOJI} There's no active room to reboot.`)
      return
    }

    stopRoomCard(chatId)
    if (oldCard) {
      void serialCardEdit(oldCard, () =>
        tg.editMessage({
          chatId,
          message: oldCard,
          text: md`${SUCCESS_EMOJI} Playback finished - the room was rebooted.`,
          invertMedia: false,
          disableWebPreview: true,
        }).catch(() => {}),
      )
    }

    await msg.replyText(
      md`${SUCCESS_EMOJI} Room rebooted - playback stopped, queue cleared, and everyone disconnected.`,
    )
  },
})
