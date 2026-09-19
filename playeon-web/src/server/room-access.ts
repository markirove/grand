import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { env, type AppRole } from "./env";
import {
  normalizeMode,
  normalizeStyle,
  type RoomMode,
  type RoomStyleId,
} from "@/lib/room-style";

import { getDb, mongoConfigured } from "./mongo";

/**
 * Who may enter a room, and who may drive it.
 *
 * This is the single enforcement point: a user who fails `join` never receives
 * a token, so they cannot open the socket at all, and `control` is baked into
 * the token the socket then trusts per action.
 *
 * Room type is inferred from the id exactly as the bot does in `roomLink.ts` -
 * a positive integer is someone's personal room, anything else is a group.
 *
 *   Personal room                        Group room
 *   ─────────────                        ──────────
 *   join:    anyone holding the link     join:    members | anyone  (settable)
 *   control: owner | anyone  (settable)  control: admins + /auth list
 */

export type RoomVariant = "group" | "personal";
export type JoinPolicy = "members" | "anyone";
export type ControlPolicy = "owner" | "anyone";

export function isPersonalRoomId(roomId: string): boolean {
  const n = Number(roomId);
  return Number.isInteger(n) && n > 0;
}

/**
 * A personal-room deep link is `p<userId>_<sig>`. Without the signature anyone
 * who knew a user id could open their room, so the bot truncates an HMAC over
 * it into the start param and we verify before trusting the id.
 */
export function resolveStartParam(
  startParam: string | null | undefined,
): { ok: true; groupId: string } | { ok: false; reason: "missing" | "bad_signature" } {
  const raw = startParam?.trim();
  if (!raw) return { ok: false, reason: "missing" };

  const personal = /^p(\d+)_([A-Za-z0-9_-]+)$/.exec(raw);
  if (!personal) {
    /*
      Anything that is not the signed personal form has to be a group id, and a
      group id is negative. This is the check that was missing: the signature
      below only ever ran on `p<id>_<sig>`, so a *bare* positive integer sailed
      past it, landed in the personal branch of `resolveRoomAccess` - which
      grants `join: true` on the grounds that the link was already verified -
      and opened that user's room to anyone who could guess their Telegram id.
      Unsigned is refused as a signature failure, because that is what it is.
    */
    if (/^\d+$/.test(raw)) return { ok: false, reason: "bad_signature" };
    // and a group id is the only other thing a real link carries
    if (!/^-\d+$/.test(raw)) return { ok: false, reason: "missing" };
    return { ok: true, groupId: raw };
  }

  const [, userId, provided] = personal as unknown as [string, string, string];
  if (!env.roomSecret) return { ok: false, reason: "bad_signature" };

  const expected = createHmac("sha256", env.roomSecret)
    .update(`room:personal:${userId}`)
    .digest("base64url")
    .slice(0, 16);

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true, groupId: userId };
}

type AccessDoc = {
  _id: string;
  joinPolicy?: JoinPolicy;
  controlPolicy?: ControlPolicy;
  mode?: string;
  style?: string;
};

export type RoomSettings = { mode: RoomMode; style: RoomStyleId };

/**
 * The room's mode and paint, as the bot last left them.
 *
 * Read straight from the same document the access policy lives in, because
 * that is where the bot writes it and a second hop through the room server
 * would only add a way for the two to disagree. Anything unset, unknown, or
 * unreadable is the default room - a room whose settings we cannot load is
 * still a room somebody is trying to walk into.
 */
export async function readRoomSettings(roomId: string): Promise<RoomSettings> {
  const doc = await readAccessDoc(roomId);
  return {
    mode: normalizeMode(doc?.mode),
    style: normalizeStyle(doc?.style),
  };
}

const DEFAULTS: Record<RoomVariant, { join: JoinPolicy; control: ControlPolicy }> = {
  // personal.join is unused (link-gated) and group.control is unused (admin
  // rights decide it); both are filled only so the shape stays total
  personal: { join: "anyone", control: "owner" },
  group: { join: "anyone", control: "owner" },
};

async function readAccessDoc(roomId: string): Promise<AccessDoc | null> {
  if (!mongoConfigured()) return null;
  try {
    const db = await getDb();
    return await db.collection<AccessDoc>("room_access").findOne({ _id: roomId });
  } catch {
    return null;
  }
}

async function isAuthorized(groupId: string, userId: string): Promise<boolean> {
  if (!mongoConfigured()) return false;
  try {
    const db = await getDb();
    const hit = await db
      .collection<{ _id: string }>("group_auth")
      .findOne({ _id: `${groupId}:${userId}` }, { projection: { _id: 1 } });
    return hit !== null;
  } catch {
    return false;
  }
}

type Membership = {
  /** `null` means we could not determine it - distinct from a definitive no. */
  isMember: boolean | null;
  /**
   * Telegram is certain there is no such chat - as opposed to it being unable
   * to answer. The two used to arrive here identically, and since `join` fails
   * open, a start param naming a group that does not exist read as "we could
   * not check" and was let through.
   */
  chatMissing: boolean;
  /** Creator, or an admin holding manage-video-chats. */
  isPrivilegedAdmin: boolean;
  canManageAccess: boolean;
};

const UNKNOWN_MEMBERSHIP: Membership = {
  isMember: null,
  chatMissing: false,
  isPrivilegedAdmin: false,
  canManageAccess: false,
};

/**
 * `getChatMember` is a round trip to Telegram, and group membership changes on
 * a human timescale. Caching it for a minute turns a per-request API call into
 * a per-minute one; an unknown result is never cached, so a transient failure
 * doesn't pin someone out of a room they belong to.
 */
const MEMBERSHIP_TTL_MS = 60_000;
const membershipCache = new Map<string, { value: Membership; at: number }>();
const membershipInFlight = new Map<string, Promise<Membership>>();

async function fetchMembership(
  groupId: string,
  userId: string,
): Promise<Membership> {
  if (!env.botToken) return UNKNOWN_MEMBERSHIP;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${env.botToken}/getChatMember` +
        `?chat_id=${encodeURIComponent(groupId)}&user_id=${encodeURIComponent(userId)}`,
      { signal: AbortSignal.timeout(4000), cache: "no-store" },
    );
    const body = await res.json();
    if (body?.ok === false) {
      /*
        Telegram answers 400 "chat not found" for an id it has never seen, and
        that is a fact, not an outage - worth separating from the timeouts and
        5xxs this function otherwise swallows. Narrow on purpose: "user not
        found" is a 400 too, and it means the chat is real and the *viewer* is
        not, which the membership answer below already handles correctly.
      */
      const description = String(body.description ?? "").toLowerCase();
      // `error_code` as well as the HTTP status: the two agree today, but the
      // body is the API's own answer and survives a proxy that flattens status
      const bad = res.status === 400 || body.error_code === 400;
      return {
        ...UNKNOWN_MEMBERSHIP,
        chatMissing: bad && description.includes("chat not found"),
      };
    }

    const member = body?.result;
    if (!member?.status) return UNKNOWN_MEMBERSHIP;

    const status: string = member.status;
    const isCreator = status === "creator";
    const isAdmin = status === "administrator";
    return {
      chatMissing: false,
      isMember:
        isCreator || isAdmin || status === "member" || status === "restricted",
      isPrivilegedAdmin:
        isCreator || (isAdmin && member.can_manage_video_chats === true),
      canManageAccess:
        isCreator ||
        (isAdmin &&
          (member.can_manage_video_chats === true ||
            member.can_promote_members === true)),
    };
  } catch {
    return UNKNOWN_MEMBERSHIP;
  }
}

function resolveMembership(groupId: string, userId: string): Promise<Membership> {
  const key = `${groupId}:${userId}`;
  const cached = membershipCache.get(key);
  if (cached && Date.now() - cached.at < MEMBERSHIP_TTL_MS) {
    return Promise.resolve(cached.value);
  }

  // collapse concurrent callers (join + preview fire together) into one call
  const existing = membershipInFlight.get(key);
  if (existing) return existing;

  const pending = fetchMembership(groupId, userId)
    .then((value) => {
      // a room that does not exist will not start existing, so that verdict is
      // worth caching too - it keeps a bad link off Telegram's API
      if (value.isMember !== null || value.chatMissing) {
        membershipCache.set(key, { value, at: Date.now() });
      }
      return value;
    })
    .finally(() => membershipInFlight.delete(key));

  membershipInFlight.set(key, pending);
  return pending;
}

export type RoomAccess = {
  join: boolean;
  control: boolean;
  /**
   * There is no such room, as opposed to there being one this viewer may not
   * enter. Kept apart from `join` because the two are different answers to the
   * user: "private" tells them a room is there and they are shut out of it,
   * which is both wrong here and a confirmation not worth handing out.
   */
  missing?: boolean;
};

export async function resolveRoomAccess(
  role: AppRole,
  roomId: string,
  userId: string,
): Promise<RoomAccess> {
  if (role === "superuser" || role === "developer") {
    return { join: true, control: true };
  }

  if (isPersonalRoomId(roomId)) {
    const doc = await readAccessDoc(roomId);
    const policy = doc?.controlPolicy ?? DEFAULTS.personal.control;
    // join is link-gated, and the signed start param was verified upstream
    return { join: true, control: userId === roomId || policy === "anyone" };
  }

  const [doc, membership, authorized] = await Promise.all([
    readAccessDoc(roomId),
    resolveMembership(roomId, userId),
    isAuthorized(roomId, userId),
  ]);

  // Before the policy, not after it: `join: "anyone"` is the default, and it is
  // a statement about *who* may enter a room, not about whether the room is
  // there. Left below, it granted entry to every group id ever typed.
  if (membership.chatMissing) return { join: false, control: false, missing: true };

  const joinPolicy = doc?.joinPolicy ?? DEFAULTS.group.join;
  return {
    // fail open on join so an API hiccup can't lock out a real member,
    // fail closed on control so only confirmed admins can drive playback
    join: joinPolicy === "anyone" || membership.isMember !== false,
    control: membership.isPrivilegedAdmin || authorized,
  };
}
