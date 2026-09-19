export type MemberListenStatDoc = {
  _id: string // `${groupId}:${userId}`
  groupId: number
  userId: number
  tracksCount: number
  secondsCount: number
  firstListenedAt: Date
  lastListenedAt: Date
}
