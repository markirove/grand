import { defineCommand, Role } from '../../core/command.js'
import { requirePlaybackControl } from '../../services/auth/playbackControl.js'
import { performRoomLoop } from '../../services/room/roomFlow.js'

export default defineCommand({
  name: 'loop',
  order: 12,
  description: 'Repeat the current track a number of times before moving on, e.g. /loop 5. Use /loop off to stop.',
  summary: 'Repeat the current track a set number of times.',
  usage: '/loop <count> | /loop off',
  category: 'playback',
  contexts: ['supergroup', 'group', 'private'],

  reply: true,
  roles: [Role.USER, Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],
  permissions: { custom: requirePlaybackControl() },

  handler: (ctx) => performRoomLoop(ctx),
})
