import { defineCommand, Role } from '../../core/command.js'
import { requirePlaybackControl } from '../../services/auth/playbackControl.js'
import { performRoomPause } from '../../services/room/roomFlow.js'

export default defineCommand({
  name: 'pause',
  order: 4,
  description: 'Pause the track currently playing in the room.',
  summary: 'Pause the track currently playing.',
  usage: '/pause',
  category: 'playback',
  contexts: ['supergroup', 'group', 'private'],

  reply: true,
  roles: [Role.USER, Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],
  permissions: { custom: requirePlaybackControl() },

  handler: (ctx) => performRoomPause(ctx),
})
