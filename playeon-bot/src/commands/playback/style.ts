import { defineCommand, Role } from '../../core/command.js'
import { performRoomStyle } from '../../services/room/roomSettingsFlow.js'

export default defineCommand({
  name: 'style',
  order: 13,
  description: 'Show the style this group\'s room is wearing and switch it - everyone who joins sees the room the same way.',
  summary: 'Show and switch the room\'s style.',
  usage: '/style',
  category: 'playback',

  contexts: ['supergroup', 'group', 'private'],
  reply: true,
  roles: [Role.USER, Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],
  permissions: { chatAdminRights: ['manageVideoChats'] },

  handler: (ctx) => performRoomStyle(ctx),
})
