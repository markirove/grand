export type ListenStatDoc = {
  _id: string // `${groupId}:${userId}:${day}`
  groupId: number
  userId: number
  day: string // "YYYY-MM-DD"
  dayStart: Date
  tracksCount: number
  secondsCount: number
  updatedAt: Date
}
