import { defineCommand, Role } from '../../core/command.js'
import { performRoomMode } from '../../services/room/roomSettingsFlow.js'

export default defineCommand({
  name: '3d',
  order: 11,
  description: 'Open this group\'s room as the 3D lounge - a space everyone walks around in, with a couch for six and the screen on the wall.',
  summary: 'Make the room open as the 3D lounge.',
  usage: '/3d',
  category: 'playback',

  contexts: ['supergroup', 'group', 'private'],
  reply: true,
  roles: [Role.USER, Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],
  permissions: { chatAdminRights: ['manageVideoChats'] },

  handler: (ctx) => performRoomMode(ctx, '3d'),
})
