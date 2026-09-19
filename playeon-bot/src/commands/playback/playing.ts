import { defineCommand, Role } from '../../core/command.js'
import { performRoomPlaying } from '../../services/room/roomFlow.js'

export default defineCommand({
  name: 'playing',
  order: 8,
  description: 'Show the track currently playing. Use /queue to see what is up next.',
  summary: "See what's playing right now.",
  usage: '/playing',
  category: 'playback',
  contexts: ['supergroup', 'group', 'private'],
  aliases: ['nowplaying'],

  reply: true,
  roles: [Role.USER, Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],

  handler: (ctx) => performRoomPlaying(ctx),
})
