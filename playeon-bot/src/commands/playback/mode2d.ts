import { defineCommand, Role } from '../../core/command.js'
import { performRoomMode } from '../../services/room/roomSettingsFlow.js'

export default defineCommand({
  name: '2d',
  order: 12,
  description: 'Open this group\'s room as the flat player - the queue, the lyrics and everyone listening, with no 3D scene to render.',
  summary: 'Make the room open as the flat player.',
  usage: '/2d',
  category: 'playback',

  contexts: ['supergroup', 'group', 'private'],
  reply: true,
  roles: [Role.USER, Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],
  permissions: { chatAdminRights: ['manageVideoChats'] },

  handler: (ctx) => performRoomMode(ctx, '2d'),
})

