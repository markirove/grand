export type ChatDoc = {
  _id: string
  type: 'group' | 'supergroup' | 'channel'
  title: string
  prefix: string
  addedAt: Date
  addedBy?: string
  lastActiveAt?: Date
  /**
   * Set when the row was rebuilt from activity rather than by the join handler -
   * see `touchGroupActive`. Marks chats whose `addedAt` is a recovery estimate.
   */
  recoveredAt?: Date
}
