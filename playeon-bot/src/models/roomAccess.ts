export type JoinPolicy = 'members' | 'anyone'
export type ControlPolicy = 'owner' | 'anyone'

/** Which player the room opens in - see `roomSettings`. */
export type RoomMode = '2d' | '3d'

/** Which paint the room wears - see `roomSettings`. */
export type RoomStyleId = 'default' | 'sushi' | 'poolrooms' | 'halloween'

export type RoomAccessDoc = {
  _id: string
  joinPolicy?: JoinPolicy
  controlPolicy?: ControlPolicy
  roomName?: string
  /**
   * The room's look and player, read straight out of this document by the mini
   * app when somebody taps Join.
   *
   * Here rather than in a collection of their own because they are the same
   * kind of thing as the policies above - a per-room setting an admin chose -
   * and the web app is already reading this document to answer whether the
   * person knocking is allowed in. One read, one place to be wrong.
   */
  mode?: RoomMode
  style?: RoomStyleId
  autoplay?: boolean
  updatedAt: Date
  updatedBy?: string
}
