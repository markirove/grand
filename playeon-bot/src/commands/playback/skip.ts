import { defineCommand, Role } from '../../core/command.js'
import { requirePlaybackControlOrRequester } from '../../services/auth/playbackControl.js'
import { performRoomSkip } from '../../services/room/roomFlow.js'

export default defineCommand({
  name: 'skip',
  order: 6,
  description: 'Skip the track currently playing and move to the next one in the queue.',
  summary: 'Skip the current track and play the next one.',
  usage: '/skip',
  category: 'playback',
  contexts: ['supergroup', 'group', 'private'],

  reply: true,
  roles: [Role.USER, Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],
  permissions: { custom: requirePlaybackControlOrRequester() },

  handler: (ctx) => performRoomSkip(ctx),
})
