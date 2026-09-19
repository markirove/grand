import type { ObjectId } from 'mongodb'

/**
 * One track played. Deliberately just a timestamp: it carried a `surface` of
 * `'vc' | 'room'` back when tracks could play into a voice chat, and once that
 * went the field only ever held `'room'` - written on every play and read by
 * nothing, since the stats only ever count these documents.
 */
export type PlayEventDoc = {
  _id?: ObjectId
  at: Date
}
