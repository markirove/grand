import { defineCommand, Role } from '../../core/command.js'
import { requirePlaybackControl } from '../../services/auth/playbackControl.js'
import { performRoomEnd } from '../../services/room/roomFlow.js'

export default defineCommand({
  name: 'end',
  order: 7,
  description: 'Stop playback and clear the whole queue for the room.',
  summary: 'Stop playback and clear the whole queue.',
  usage: '/end',
  category: 'playback',
  contexts: ['supergroup', 'group', 'private'],

  reply: true,
  roles: [Role.USER, Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],
  permissions: { custom: requirePlaybackControl() },

  handler: (ctx) => performRoomEnd(ctx),
})
