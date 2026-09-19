import "server-only";

import { env } from "./env";
import type { RoomMode, RoomStyleId } from "@/lib/room-style";

import {
  readRoomSettings,
  resolveRoomAccess,
  resolveStartParam,
} from "./room-access";
import { signRoomToken } from "./room-token";
import { resolveRole, verifyInitData } from "./telegram-auth";

/**
 * Turns a mini-app launch into a room session: verify who this is, decide
 * whether they may enter, mint the socket token, and fetch what the join
 * screen shows.
 *
 * Everything is re-verified here even though the client already ran through
 * Telegram - `initDataRaw` arrives from the browser and is only trustworthy
 * because of its signature.
 */

/** Matches the states `room-unavailable.tsx` can render. */
export type RoomBlockReason = "forbidden" | "expired" | "ended" | "not-found";

export type RoomPreview = {
  title: string | null;
  roomName: string | null;
  avatarUrl: string | null;
  playing: boolean;
  current: { title: string; video: boolean; thumbnail: string | null } | null;
  queued: number;
  participants: { id: string; name: string; photoUrl?: string }[];
};

export type RoomSession = {
  token: string;
  groupId: string;
  canControl: boolean;
  /** Which player this room opens in, and the paint it wears - set from the bot. */
  mode: RoomMode;
  style: RoomStyleId;
  user: { id: string; name: string; username?: string; photoUrl?: string };
  /** Null when the bot has no live room for this id yet - an idle room. */
  preview: RoomPreview | null;
};

export type JoinRoomResult =
  | { ok: true; session: RoomSession }
  | { ok: false; reason: RoomBlockReason };

/**
 * The socket URL doubles as the HTTP origin for preview and media, so swap the
 * scheme rather than carrying two env vars that could drift apart.
 */
function httpOrigin(): string {
  return env.roomBase.replace(/^ws/, "http");
}

async function fetchPreview(token: string): Promise<RoomPreview | null> {
  try {
    const res = await fetch(
      `${httpOrigin()}/preview?token=${encodeURIComponent(token)}`,
      { cache: "no-store", signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    // the bot answers `{ groupId, idle: true }` for a room nobody has opened
    if (!data || data.idle) return null;
    return {
      title: data.title ?? null,
      roomName: data.roomName ?? null,
      avatarUrl: data.avatarUrl ?? null,
      playing: Boolean(data.playing),
      current: data.current ?? null,
      queued: Number(data.queued) || 0,
      participants: Array.isArray(data.participants) ? data.participants : [],
    };
  } catch {
    // the room server being down shouldn't block the join screen - it renders
    // an idle room, and the socket will report the real state once it connects
    return null;
  }
}

export async function joinRoom(input: {
  initDataRaw: string | null | undefined;
  startParam: string | null | undefined;
}): Promise<JoinRoomResult> {
  const auth = await verifyInitData(input.initDataRaw);
  if (!auth.ok) {
    if (env.isDev) {
      const is3d = Boolean(input.startParam && (input.startParam.includes("3d") || input.startParam === "3d"));
      const devGroupId = input.startParam ? input.startParam.replace(/_3d|3d/i, "") || "test" : "test";
      const devPreview = await fetchPreview("dev_bypass");
      return {
        ok: true,
        session: {
          token: "dev_bypass",
          groupId: devGroupId,
          canControl: true,
          mode: is3d ? "3d" : "2d",
          style: "default",
          user: {
            id: "999999999",
            name: "Local Tester",
            username: "localtester",
            photoUrl: `${httpOrigin()}/avatar/user/999999999`,
          },
          preview: devPreview,
        },
      };
    }
    return { ok: false, reason: auth.reason === "expired" ? "expired" : "forbidden" };
  }

  const room = resolveStartParam(input.startParam);
  if (!room.ok) {
    if (env.isDev) {
      const devGroupId = input.startParam || "test";
      const devPreview = await fetchPreview("dev_bypass");
      return {
        ok: true,
        session: {
          token: "dev_bypass",
          groupId: devGroupId,
          canControl: true,
          mode: "2d",
          style: "default",
          user: {
            id: auth.user.id,
            name: auth.user.name,
            username: auth.user.username,
            photoUrl: auth.user.photoUrl,
          },
          preview: devPreview,
        },
      };
    }
    /*
      A missing param and a bad signature are the same answer to the person
      holding the link: it does not name a room we can serve. "Private" was
      the wrong word for it - that describes a room which exists and is shut,
      and saying so to someone probing raw ids would confirm the room is real.
    */
    return { ok: false, reason: "not-found" };
  }

  const role = await resolveRole(auth.user.id);
  const access = await resolveRoomAccess(role, room.groupId, auth.user.id);
  // "no such room" before "not your room" - see RoomAccess.missing
  if (access.missing) return { ok: false, reason: "not-found" };
  if (!access.join) return { ok: false, reason: "forbidden" };

  const token = await signRoomToken({
    user: {
      id: auth.user.id,
      name: auth.user.name,
      username: auth.user.username,
      firstName: auth.user.firstName,
      lastName: auth.user.lastName,
      photoUrl: auth.user.photoUrl,
      role,
    },
    groupId: room.groupId,
    canControl: access.control,
  });
  if (!token) return { ok: false, reason: "forbidden" };

  const settings = await readRoomSettings(room.groupId);

  return {
    ok: true,
    session: {
      token,
      groupId: room.groupId,
      canControl: access.control,
      mode: settings.mode,
      style: settings.style,
      user: {
        id: auth.user.id,
        name: auth.user.name,
        username: auth.user.username,
        photoUrl: auth.user.photoUrl,
      },
      preview: await fetchPreview(token),
    },
  };
}
