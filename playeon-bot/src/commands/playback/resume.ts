import { defineCommand, Role } from '../../core/command.js'
import { requirePlaybackControl } from '../../services/auth/playbackControl.js'
import { performRoomResume } from '../../services/room/roomFlow.js'

export default defineCommand({
  name: 'resume',
  order: 5,
  description: 'Resume a paused track in the room.',
  summary: 'Resume the paused track.',
  usage: '/resume',
  category: 'playback',
  contexts: ['supergroup', 'group', 'private'],

  reply: true,
  roles: [Role.USER, Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],
  permissions: { custom: requirePlaybackControl() },

  handler: (ctx) => performRoomResume(ctx),
})
