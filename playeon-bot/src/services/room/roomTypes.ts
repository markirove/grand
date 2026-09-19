
export type RoomParticipant = {
  id: string
  name: string
  username?: string
  photoUrl?: string
  role: 'user' | 'superuser' | 'developer'
  canControl: boolean
  online: boolean
  present: boolean
}

export type RoomTrack = {
  id: string
  title: string
  /** Uploader / channel, when the source gave us one. */
  artist?: string | null
  /** Channel avatar for the artist; a public URL, unlike our own media. */
  artistAvatar?: string | null
  /**
   * Who actually performed it, when `artist` is showing something else.
   *
   * JioSaavn tracks display the source rather than the performer, but the
   * performer is what the lyrics provider matches on - and it is the thing
   * that makes those lookups work at all, since a YouTube title rarely
   * yields a usable artist. Kept apart so the display choice cannot cost us
   * the lyrics.
   */
  lyricsArtist?: string | null
  duration: number | null
  /**
   * Where the track came from - the YouTube watch page, the JioSaavn song
   * page. Carried so a title can be a link back to the original rather than
   * dead text, and absent for a track lifted off a replied Telegram file,
   * which has no page to point at.
   */
  sourceUrl?: string | null
  thumbnail: string | null
  video: boolean
  requestedBy: string
  requestedById?: string
  mediaUrl?: string
  sourceMode?: 'download' | 'split'
  videoUrl?: string
  /**
   * The same picture, streamed through this server instead of straight from
   * the CDN.
   *
   * Exists for one reason: WebGL refuses to read pixels out of a video whose
   * bytes arrived without CORS permission, and googlevideo grants that only to
   * its own origins. A 2D player paints the element and needs none of this, so
   * it keeps using `videoUrl` and the CDN keeps carrying the bytes; the 3D
   * lounge needs a texture, and a texture needs this.
   *
   * Nothing is cached behind it - it forwards the range the client asked for
   * and holds nothing - so the cost is bandwidth for as long as someone is
   * actually watching in 3D, and nothing at all otherwise.
   */
  videoProxyUrl?: string
  videoQualities?: RoomVideoQuality[]
  statusMessageId?: number
}

export type RoomVideoQuality = {
  label: 'SD' | 'HD' | 'FHD' | 'QHD' | 'UHD'
  height: number
  url: string
}

export type RoomSnapshot = {
  type: 'snapshot'
  rev: number
  groupId: string
  title: string | null
  roomName: string | null
  avatarUrl: string | null
  current: RoomTrack | null
  playing: boolean
  startedAt: number
  pausedPositionSec: number
  queue: RoomTrack[]
  participants: RoomParticipant[]
  serverTime: number
  /**
   * Which of the lounge's ceiling lamps are lit, in the lounge's own order.
   *
   * Room state rather than a client's own setting: two people in the same room
   * are in the same light, and one of them turning it off for themselves alone
   * is the kind of disagreement about a shared space that nobody can debug from
   * inside it.
   *
   * Absent until somebody touches a switch, which means "all on" - the server
   * has no model of that room and does not know how many lamps it has, exactly
   * as it has no model of where anyone is standing. Anything past the end of
   * this array, or a room that has never carried it, is lit.
   */
  lights?: boolean[]
}

/**
 * Where someone is standing in the mini app's 3D lounge, in its own metres.
 *
 * Stored and fanned out as given: the server has no model of that room's
 * geometry, and a client that lies about its position can only misplace its own
 * body. Sent by the lounge alone - a room nobody has opened it in never carries
 * any of this.
 */
export type RoomPose = {
  x: number
  /** Height of the feet, so a jump reads as one. */
  y: number
  z: number
  /** Radians. */
  yaw: number
  /** Which cushion they are on, or −1 for standing. */
  seat: number
}

/**
 * Everyone in the lounge, at one instant.
 *
 * Deliberately not part of the snapshot. A snapshot is a whole room state read
 * by React on every change; this arrives ten times a second and is read by a
 * render loop, and folding one into the other would re-render every client's
 * queue and roster at 10 Hz.
 */
/**
 * The lamps changed.
 *
 * Its own message rather than a snapshot, for the reason poses are: a snapshot
 * bumps the revision and re-renders every client's queue, roster and transport,
 * and somebody flicking a light switch has changed none of those. Whole state
 * rather than the one that moved, so a client that misses a message is correct
 * again on the next one.
 */
export type RoomLights = {
  type: 'lights'
  lights: boolean[]
}

/**
 * The most lamps a room will track.
 *
 * A bound rather than a count: the server does not know how many lamps that
 * lounge has and has no business deciding, but it does have to refuse an index
 * of nine million before it allocates an array for it.
 */
export const ROOM_LIGHTS_MAX = 12

/**
 * The room's lights failing, called by somebody in it.
 *
 * Carries nothing but the moment it happened. What the failure *is* - how long,
 * how hard, which lamps - belongs to the lounge, and the server has no more
 * business describing it than it has describing where the couch is. This is the
 * cue, not the performance.
 */
export type RoomAnomaly = {
  type: 'anomaly'
  /** Server clock at the moment it was called. */
  at: number
}

/**
 * How long the room refuses another one.
 *
 * The effect runs for about twenty-five seconds at the far end of this, and a
 * second call landing in the middle of one would either restart it - a stutter,
 * which reads as a bug - or do nothing while looking like it should have. Held
 * slightly under the run so a room is never dead to it while plainly idle.
 */
export const ROOM_ANOMALY_COOLDOWN_MS = 24_000

export type RoomPoses = {
  type: 'poses'
  poses: (RoomPose & { id: string })[]
  at: number
}

/** How often poses are fanned out. Clients publish at the same rate. */
export const POSE_TICK_MS = 100

/**
 * One person doing something to another in the lounge.
 *
 * Named rather than described. The server has no model of that room and no
 * opinion about what a slap looks like, exactly as it has none about where the
 * couch is - it carries who did what to whom, and every lounge plays its own
 * copy of the animation.
 */
export type RoomGestureKind = 'slap' | 'kiss' | 'hug' | 'kick'

export const ROOM_GESTURES: readonly RoomGestureKind[] = ['slap', 'kiss', 'hug', 'kick']

/**
 * The emoji anyone may react with.
 *
 * Checked here and not only in the mini app's tray. An open field would put
 * arbitrary text over the head of every body in the room by a route that never
 * passes the chat's own length limit; a tray is a UI, not a boundary.
 */
/**
 * Everything anybody may send, and the only list this checks against.
 *
 * The mini app shows all of these in its chat sheet and a shorter quick set in
 * its heads-up tray, but that is the app's own business - here the list is
 * exactly one thing: what a `react` message is allowed to carry. Anything else
 * is dropped, so this and the app's copy have to be extended together or the
 * new ones silently never arrive.
 */
export const ROOM_REACTIONS = [
  '😂',
  '❤️',
  '🔥',
  '👏',
  '😮',
  '🎉',
  '😍',
  '🥹',
  '😭',
  '🤯',
  '💀',
  '🙏',
  '👍',
  '🫶',
  '😎',
  '🤝',
] as const

/** As long as a line can be before it stops being a bubble. */
export const CHAT_TEXT_MAX = 200

/**
 * How much of the conversation a room remembers.
 *
 * Kept so somebody arriving mid-conversation is not dropped into a silent room,
 * and small because that is the whole ambition: the last few things said in a
 * listening room, not a message history. In memory, with the rest of the room
 * state, and gone with the process for the same reason everything else here is.
 */
export const CHAT_LOG_MAX = 50

/**
 * Something said in the room - typed, or picked out of the reaction tray.
 *
 * Both are one kind of thing: written the same way, kept in the same log, and
 * floating above the same head. The only difference is how the lounge draws
 * them, which is what `kind` is for and is the whole of the server's interest
 * in the distinction.
 */
export type RoomChatMessage = {
  id: string
  /** Participant id of whoever said it. */
  from: string
  /**
   * Their display name as of the moment they said it, copied rather than looked
   * up later - a line should still have a name against it once its author has
   * left the room.
   */
  name: string
  kind: 'text' | 'emoji'
  text: string
  at: number
}

export type RoomChat = {
  type: 'chat'
  message: RoomChatMessage
}

/**
 * The conversation so far, sent once to a connection that has just opened.
 *
 * Its own message rather than a field on the snapshot: a snapshot goes out on
 * every change - every track, every join, every pause - and the log would ride
 * along with all of them for the sake of the one moment anybody needs it.
 */
export type RoomChatLog = {
  type: 'chatlog'
  messages: RoomChatMessage[]
}

/**
 * A gesture that landed, broadcast to everyone including whoever threw it.
 *
 * Both ends are named because both ends animate: the actor swings and the
 * target recoils, and a client told only about the actor would draw a slap that
 * nobody reacted to.
 */
export type RoomGesture = {
  type: 'gesture'
  kind: RoomGestureKind
  from: string
  to: string
  at: number
}

/**
 * How often one connection may say something, or throw a gesture.
 *
 * Slower than a person types and far slower than a finger can hit the same
 * emoji, so nobody legitimate will ever meet it. It is here because a bubble
 * over a head and a line in everyone's log is a broadcast to the whole room,
 * and a broadcast anybody can trigger in a loop needs a floor under it.
 */
export const CHAT_MIN_INTERVAL_MS = 600
export const GESTURE_MIN_INTERVAL_MS = 700

export type RoomEvent = {
  type: 'event'
  kind: 'join' | 'leave' | 'add' | 'skip' | 'clear' | 'seek' | 'pause' | 'resume'
  actor: string
  actorId?: string
  detail?: string
  at: number
}

export type ServerMessage =
  | RoomSnapshot
  | RoomPoses
  | RoomLights
  | RoomAnomaly
  | RoomChat
  | RoomChatLog
  | RoomGesture
  | RoomEvent
  | { type: 'welcome'; self: RoomParticipant }
  | { type: 'error'; message: string }
  | { type: 'closed'; reason: 'joined_elsewhere' | 'rebooted' }

export type RoomControlAction =
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'seek'; positionSec: number }
  | { action: 'skip' }
  | { action: 'clear' }
  | { action: 'end' }

export type ClientMessage =
  | ({ type: 'control' } & RoomControlAction)
  | { type: 'presence'; present: boolean }
  /** A lounge position, or `null` on leaving the 3D room without leaving the room. */
  | { type: 'pose'; pose: RoomPose | null }
  /**
   * Work one of the lounge's light switches.
   *
   * One lamp rather than the whole set, so that two people flicking different
   * switches in the same moment do not overwrite each other - a full array from
   * a client would carry its own idea of every other lamp with it, including
   * the ones it has not heard about yet.
   *
   * Open to everyone in the room, unlike playback: the lights are furniture, and
   * a room where only an admin may turn a lamp off is a stranger place than one
   * where anybody can.
   */
  | { type: 'lights'; index: number; on: boolean }
  /**
   * Call the lights down, for everybody in the room.
   *
   * Open to anyone, like the switches: the button that does this is on a wall
   * of the lounge, and a room where only an admin may frighten anybody is a
   * strange room.
   */
  | { type: 'anomaly' }
  /**
   * Say something to the room.
   *
   * Nothing is shown by the sender first: the line that comes back is the line
   * everyone else got, so a message that was refused - too long, too fast, or
   * from a socket that had already gone - is never one this client alone
   * believes it sent.
   */
  | { type: 'say'; text: string }
  /** Pick one of `ROOM_REACTIONS`. Anything else is dropped. */
  | { type: 'react'; emoji: string }
  /**
   * Slap, kiss or hug somebody else in the room.
   *
   * The target is named by id rather than by position - the client decided who
   * it was aiming at, and there is no geometry here to check that against. All
   * this end verifies is that the target is somebody in the same room, and that
   * it is not the sender.
   */
  | { type: 'gesture'; kind: RoomGestureKind; targetId: string }
  | { type: 'setRoomName'; name: string }
  | { type: 'ping' }

export const ROOM_NAME_MAX = 60
