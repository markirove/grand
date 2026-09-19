import { defineCommand, Role } from '../../core/command.js'
import { performRoomQueue } from '../../services/room/roomFlow.js'

export default defineCommand({
  name: 'queue',
  order: 13,
  description: 'List the tracks lined up next (not the one currently playing). Use /playing for the current track.',
  summary: 'See the tracks lined up next.',
  usage: '/queue',
  category: 'playback',
  contexts: ['supergroup', 'group', 'private'],

  reply: true,
  roles: [Role.USER, Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],

  handler: (ctx) => performRoomQueue(ctx),
})
