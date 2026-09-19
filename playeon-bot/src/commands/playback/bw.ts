import { defineCommand, Role } from '../../core/command.js'
import { requirePlaybackControl } from '../../services/auth/playbackControl.js'
import { performRoomSeek } from '../../services/room/roomFlow.js'

export default defineCommand({
  name: 'bw',
  order: 10,
  description: 'Rewind the current track by an amount, e.g. /bw 300, /bw 300s, or /bw 5m.',
  summary: 'Skip back within the current track.',
  usage: '/bw <duration>',
  category: 'playback',
  contexts: ['supergroup', 'group', 'private'],

  reply: true,
  roles: [Role.USER, Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],
  permissions: { custom: requirePlaybackControl() },

  handler: (ctx) => performRoomSeek(ctx, 'backward'),
})
