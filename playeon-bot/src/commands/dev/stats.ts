import { md } from '@mtcute/markdown-parser'
import { defineCommand, Role } from '../../core/command.js'
import { totals } from '../../services/stats.js'
import { roomManager } from '../../services/room/RoomManager.js'

export default defineCommand({
  name: 'stats',
  order: 41,
  description: 'Live bot stats - users, groups, and active rooms right now.',
  usage: '/stats',
  category: 'dev',
  contexts: 'any',
  reply: true,
  roles: [Role.DEV],

  handler: async (ctx) => {
    const { users, groups } = await totals()
    const activeRooms = roomManager.activeRoomCount()

    await ctx.msg.replyText(md`📊 **Playeon Stats**

👥 **Users:** \`${users.toLocaleString()}\`
💬 **Groups:** \`${groups.toLocaleString()}\`
🍿 **Active rooms:** \`${activeRooms.toLocaleString()}\``)
  },
})
