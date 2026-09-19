import { defineCommand, Role } from '../../core/command.js'
import { requirePlaybackControl } from '../../services/auth/playbackControl.js'
import { performRoomSeek } from '../../services/room/roomFlow.js'

export default defineCommand({
  name: 'fw',
  order: 11,
  description: 'Fast-forward the current track by an amount, e.g. /fw 300, /fw 300s, or /fw 5m.',
  summary: 'Skip forward within the current track.',
  usage: '/fw <duration>',
  category: 'playback',
  contexts: ['supergroup', 'group', 'private'],

  reply: true,
  roles: [Role.USER, Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],
  permissions: { custom: requirePlaybackControl() },

  handler: (ctx) => performRoomSeek(ctx, 'forward'),
})
