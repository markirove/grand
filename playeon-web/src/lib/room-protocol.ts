export type RoomRole = "user" | "superuser" | "developer";

export type RoomParticipant = {
  id: string;
  name: string;
  username?: string;
  photoUrl?: string;
  role: RoomRole;
  canControl: boolean;
  online: boolean;
  present: boolean;
};

export type RoomVideoQuality = {
  label: "SD" | "HD" | "FHD" | "QHD" | "UHD";
  height: number;
  url: string;
};

export type RoomTrack = {
  id: string;
  title: string;
  artist?: string | null;
  artistAvatar?: string | null;
  lyricsArtist?: string | null;
  duration: number | null;
  sourceUrl?: string | null;
  thumbnail: string | null;
  video: boolean;
  requestedBy: string;
  requestedById?: string;
  mediaUrl?: string;
  sourceMode?: "download" | "split";
  videoUrl?: string;
  videoProxyUrl?: string;
  videoQualities?: RoomVideoQuality[];
};

export type RoomSnapshot = {
  type: "snapshot";
  rev: number;
  groupId: string;
  title: string | null;
  roomName: string | null;
  avatarUrl: string | null;
  current: RoomTrack | null;
  playing: boolean;
  startedAt: number;
  pausedPositionSec: number;
  queue: RoomTrack[];
  participants: RoomParticipant[];
  serverTime: number;
  lights?: boolean[];
};

export type RoomPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  seat: number;
};

export type RoomPoses = {
  type: "poses";
  poses: (RoomPose & { id: string })[];
  at: number;
};

export const POSE_TICK_MS = 100;

export type RoomLights = {
  type: "lights";
  lights: boolean[];
};

export const ROOM_LIGHTS_MAX = 12;

export type RoomAnomaly = {
  type: "anomaly";
  at: number;
};

export type RoomGestureKind = "slap" | "kiss" | "hug" | "kick";

export const ROOM_GESTURES: readonly RoomGestureKind[] = [
  "slap",
  "kiss",
  "hug",
  "kick",
];

/**
 * Everything anybody may send, and the only list the server checks against.
 *
 * Ordered by how often a room reaches for one, because the first six are also
 * the quick set the HUD tray offers - see `ROOM_QUICK_REACTIONS`. Adding to the
 * end of this is free; reordering it moves what the tray shows, which is a
 * decision rather than a tidy-up.
 */
export const ROOM_REACTIONS = [
  "😂",
  "❤️",
  "🔥",
  "👏",
  "😮",
  "🎉",
  "😍",
  "🥹",
  "😭",
  "🤯",
  "💀",
  "🙏",
  "👍",
  "🫶",
  "😎",
  "🤝",
] as const;

/**
 * What the HUD tray offers, which is not all of them.
 *
 * The tray is a column that opens off a button in the corner of a 3D room and
 * has to fit above it - sixteen of anything is taller than a phone, so it would
 * wrap into a grid covering the room it is a reaction *to*. The chat sheet has
 * a whole row to scroll and shows the lot; this is the handful worth reaching
 * for without opening anything.
 */
export const ROOM_QUICK_REACTIONS = ROOM_REACTIONS.slice(0, 6);

export type RoomReaction = (typeof ROOM_REACTIONS)[number];

export const CHAT_TEXT_MAX = 200;

export const CHAT_LOG_MAX = 50;

export type RoomChatMessage = {
  id: string;
  from: string;
  name: string;
  kind: "text" | "emoji";
  text: string;
  at: number;
};

export type RoomChat = {
  type: "chat";
  message: RoomChatMessage;
};

export type RoomChatLog = {
  type: "chatlog";
  messages: RoomChatMessage[];
};

export type RoomGesture = {
  type: "gesture";
  kind: RoomGestureKind;
  from: string;
  to: string;
  at: number;
};

export type RoomEventKind =
  | "join"
  | "leave"
  | "add"
  | "skip"
  | "clear"
  | "seek"
  | "pause"
  | "resume";

export type RoomEvent = {
  type: "event";
  kind: RoomEventKind;
  actor: string;
  actorId?: string;
  detail?: string;
  at: number;
};

export type ServerMessage =
  | RoomSnapshot
  | RoomPoses
  | RoomLights
  | RoomAnomaly
  | RoomChat
  | RoomChatLog
  | RoomGesture
  | RoomEvent
  | { type: "welcome"; self: RoomParticipant }
  | { type: "error"; message: string }
  | { type: "closed"; reason: "joined_elsewhere" | "rebooted" };

export type RoomControlAction =
  | { action: "play" }
  | { action: "pause" }
  | { action: "seek"; positionSec: number }
  | { action: "skip" }
  | { action: "clear" }
  | { action: "end" };

export type ClientMessage =
  | ({ type: "control" } & RoomControlAction)
  | { type: "presence"; present: boolean }
  | { type: "pose"; pose: RoomPose | null }
  | { type: "lights"; index: number; on: boolean }
  | { type: "anomaly" }
  | { type: "say"; text: string }
  | { type: "react"; emoji: string }
  | { type: "gesture"; kind: RoomGestureKind; targetId: string }
  | { type: "setRoomName"; name: string }
  | { type: "ping" };

export const ROOM_NAME_MAX = 60;

export const CLOSE_JOINED_ELSEWHERE = 4000;

export function withRoomToken(
  url: string | null | undefined,
  token: string,
): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!/^\/(avatar|media|video)\//.test(parsed.pathname)) return url;
    parsed.searchParams.set("token", token);
    return parsed.toString();
  } catch {
    return url;
  }
}

export function livePositionSec(
  snapshot: Pick<
    RoomSnapshot,
    "current" | "playing" | "startedAt" | "pausedPositionSec"
  > | null,
  clockOffsetMs: number,
): number {
  if (!snapshot?.current) return 0;
  if (!snapshot.playing) return snapshot.pausedPositionSec;
  const elapsed = (Date.now() + clockOffsetMs - snapshot.startedAt) / 1000;
  const duration = snapshot.current.duration;
  const capped = duration && duration > 0 ? Math.min(elapsed, duration) : elapsed;
  return Math.max(0, capped);
}
