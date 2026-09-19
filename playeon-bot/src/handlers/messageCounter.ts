import type { Chat, User } from '@mtcute/node'
import { dp } from '../client.js'
import { collections } from '../services/mongo.js'

export function registerMessageCounter() {
  dp.onNewMessage(async (msg) => {
    if (msg.chat.type === 'user') return
    const chat = msg.chat as Chat
    if (chat.chatType !== 'supergroup' && chat.chatType !== 'group') return

    const sender = msg.sender
    if (sender.type !== 'user' || (sender as User).isBot) return
    if (msg.isService) return

    const user = sender as User
    const now = new Date()

    void collections.users.updateOne(
      { _id: String(user.id) },
      {
        $set: {
          lastSeenAt: now,
          ...(user.username ? { username: user.username } : {}),
          ...(user.firstName ? { firstName: user.firstName } : {}),
          ...(user.lastName ? { lastName: user.lastName } : {}),
        },
        $setOnInsert: { firstSeenAt: now },
      },
      { upsert: true },
    ).catch(() => {})
  }, -2)
}

