import { defineCommand, Role } from '../../core/command.js'
import { requirePlaybackControl } from '../../services/auth/playbackControl.js'
import { performRoomSeek } from '../../services/room/roomFlow.js'

export default defineCommand({
  name: 'seek',
  order: 9,
  description: 'Jump the current track to a position: /seek 4:02 (absolute), /seek 90s (forward), or /seek -90s (back).',
  summary: 'Jump to a specific point in the track.',
  usage: '/seek <m:ss> | /seek <±duration>',
  category: 'playback',
  contexts: ['supergroup', 'group', 'private'],

  reply: true,
  roles: [Role.USER, Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],
  permissions: { custom: requirePlaybackControl() },

  handler: (ctx) => performRoomSeek(ctx, 'seek'),
})
