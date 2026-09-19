import { defineCommand, Role } from '../../core/command.js'
import { performRoomPlay } from '../../services/room/roomFlow.js'

export default defineCommand({
  name: 'play',
  order: 2,
  description: 'Play a song in the group room: search a name, paste a link, or reply to an audio/video file. Queues if something is already playing. Add `-f` to start it now and push the current track back to the queue.',
  summary: 'Play a song - search by name, paste a link, or reply to a file.',
  usage: '/play <song name or link>',
  category: 'playback',
  contexts: ['supergroup', 'group', 'private'],

  reply: true,
  roles: [Role.USER, Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],

  handler: (ctx) => performRoomPlay(ctx, false),
})
