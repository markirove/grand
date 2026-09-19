export type UserDoc = {
  _id: string
  username?: string
  firstName?: string
  lastName?: string
  firstSeenAt: Date
  lastSeenAt: Date
  startedAt?: Date
  totalTracksListened?: number
  totalSecondsListened?: number
  totalMessages?: number
  level?: number
  /**
   * Set when the row was rebuilt from a live interaction rather than by a real
   * `/start` - see `touchUserActive`. Marks the users whose `startedAt` is a
   * recovery estimate rather than the date they actually started the bot.
   */
  recoveredAt?: Date
}

