import { defineCommand, Role } from '../../core/command.js'
import { performRoomPlay } from '../../services/room/roomFlow.js'

export default defineCommand({
  name: 'vplay',
  aliases: ['stream'],
  order: 3,
  description: 'Like /play, but with video too - search, paste a link, or reply to a video file. The room plays 1080p by default; pick another quality with -sd/-hd/-fhd/-2k (-1440p)/-4k (-2160p)/-best. Add `-f` to start it now and push the current track back to the queue.',
  summary: 'Play with video - audio and picture together, at your chosen quality.',
  usage: '/vplay <video name or link> [-sd|-hd|-fhd|-2k|-1440p|-4k|-2160p|-best]',
  category: 'playback',
  contexts: ['supergroup', 'group', 'private'],

  reply: true,
  roles: [Role.USER, Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],

  handler: (ctx) => performRoomPlay(ctx, true),
})
