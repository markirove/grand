
export type PlaybackDoc = {

  _id: string

  sourceId: string

  sourceUrl: string

  video: boolean
  title: string
  duration: number | null

  channelMessageId: number
  fileName?: string
  fileSize?: number
  createdAt: Date

  lastUsedAt: Date
  useCount: number
}
