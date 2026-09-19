import { collections } from '../mongo.js'
import type { RoomMode, RoomStyleId } from '../../models/roomAccess.js'

/**
 * A room's look and which player it opens in.
 *
 * Set from here, stored on the room's access document, and read by the mini app
 * at the moment somebody taps Join - the bot is the only writer and the web app
 * is the only reader, so there is no third copy to drift. The vocabulary is
 * mirrored in the app's `lib/room-style.ts`, and the ids below are the contract
 * between them: change one without the other and a room repaints itself back to
 * the default, which is the safest way for that mistake to land.
 */
export type RoomStyle = {
  id: RoomStyleId
  label: string
  blurb: string
}

export const ROOM_STYLES: readonly RoomStyle[] = [
  {
    id: 'default',
    label: 'Midnight',
    blurb: 'The one it comes with. Deep blues, warm lamps and dark wood.',
  },
  {
    id: 'poolrooms',
    label: 'Poolrooms',
    blurb: 'White ceramic tile in every direction, ankle-deep and blue-green.',
  },
  {
    id: 'halloween',
    label: 'Halloween',
    blurb: 'A shuttered parlour lit by candles that will not sit still.',
  },
  {
    id: 'sushi',
    label: 'Sushi',
    blurb: 'Near-white walls with a blush of pink, pale seamless boards, soft rose lamps.',
  },
]

export const DEFAULT_STYLE: RoomStyleId = 'default'
export const DEFAULT_MODE: RoomMode = '3d'
export const DEFAULT_AUTOPLAY = false

export function isRoomStyleId(value: unknown): value is RoomStyleId {
  return ROOM_STYLES.some((s) => s.id === value)
}

export function styleById(id: RoomStyleId): RoomStyle {
  return ROOM_STYLES.find((s) => s.id === id) ?? ROOM_STYLES[0]!
}

export type RoomSettings = { mode: RoomMode; style: RoomStyleId; autoplay: boolean }

const FALLBACK: RoomSettings = { mode: DEFAULT_MODE, style: DEFAULT_STYLE, autoplay: DEFAULT_AUTOPLAY }

/**
 * What the room is set to now.
 *
 * A room nobody has configured has no document at all, and an unreachable
 * database is not a reason to claim a room is something it is not - both answer
 * with the defaults, which is what the mini app would have shown anyway.
 */
export async function readRoomSettings(roomId: string): Promise<RoomSettings> {
  try {
    const doc = await collections.roomAccess.findOne(
      { _id: roomId },
      { projection: { mode: 1, style: 1, autoplay: 1 } },
    )
    return {
      mode: doc?.mode === '2d' || doc?.mode === '3d' ? doc.mode : DEFAULT_MODE,
      style: isRoomStyleId(doc?.style) ? doc.style : DEFAULT_STYLE,
      autoplay: typeof doc?.autoplay === 'boolean' ? doc.autoplay : DEFAULT_AUTOPLAY,
    }
  } catch {
    return FALLBACK
  }
}

export async function readRoomAutoplay(roomId: string): Promise<boolean> {
  try {
    const doc = await collections.roomAccess.findOne(
      { _id: roomId },
      { projection: { autoplay: 1 } },
    )
    return typeof doc?.autoplay === 'boolean' ? doc.autoplay : DEFAULT_AUTOPLAY
  } catch {
    return DEFAULT_AUTOPLAY
  }
}

export async function writeRoomAutoplay(
  roomId: string,
  autoplay: boolean,
  by?: string,
): Promise<void> {
  await collections.roomAccess.updateOne(
    { _id: roomId },
    { $set: { autoplay, updatedAt: new Date(), ...(by ? { updatedBy: by } : {}) } },
    { upsert: true },
  )
}

export async function writeRoomMode(
  roomId: string,
  mode: RoomMode,
  by?: string,
): Promise<void> {
  await collections.roomAccess.updateOne(
    { _id: roomId },
    { $set: { mode, updatedAt: new Date(), ...(by ? { updatedBy: by } : {}) } },
    { upsert: true },
  )
}

export async function writeRoomStyle(
  roomId: string,
  style: RoomStyleId,
  by?: string,
): Promise<void> {
  await collections.roomAccess.updateOne(
    { _id: roomId },
    { $set: { style, updatedAt: new Date(), ...(by ? { updatedBy: by } : {}) } },
    { upsert: true },
  )
}
