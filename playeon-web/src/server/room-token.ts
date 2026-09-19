import "server-only";

import { env, type AppRole } from "./env";

/**
 * Mints the short-lived JWT the browser hands to the bot's room socket.
 *
 * The bot verifies this in `services/room/roomToken.ts`: HS256 over
 * `<header>.<payload>`, `iss`/`aud` exact-matched, `exp` in seconds, and
 * `user.id` + `room.groupId` required. Those constants are duplicated here
 * deliberately - they are a wire contract, and importing across repos would be
 * worse than a comment pointing at the other side.
 */

const ISSUER = "playeon";
const AUDIENCE = "playeon-room-ws";

/**
 * Long enough to outlast a listening session without a refresh dance, short
 * enough that a leaked token dies on its own. The socket re-checks `exp` on
 * every reconnect, so this also bounds a revoked user's access.
 */
const TTL_SECONDS = 3 * 60 * 60;

export type RoomTokenUser = {
  id: string;
  name: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
  role: AppRole;
};

function base64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

let signingKey: Promise<CryptoKey> | null = null;

function key(): Promise<CryptoKey> {
  signingKey ??= crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.roomSecret!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return signingKey;
}

export async function signRoomToken(input: {
  user: RoomTokenUser;
  groupId: string;
  /**
   * Baked in at mint time so the socket can authorize each control action from
   * the token alone - no Telegram or Mongo lookup on the hot path.
   */
  canControl: boolean;
}): Promise<string | null> {
  if (!env.roomSecret) return null;

  const issuedAt = Math.floor(Date.now() / 1000);
  const signingInput = `${base64Url(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  )}.${base64Url(
    JSON.stringify({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: input.user.id,
      iat: issuedAt,
      exp: issuedAt + TTL_SECONDS,
      canControl: input.canControl,
      user: input.user,
      room: { groupId: input.groupId },
    }),
  )}`;

  const signature = await crypto.subtle.sign(
    "HMAC",
    await key(),
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
}

/** Seconds until a minted token expires - the client refreshes ahead of this. */
export const ROOM_TOKEN_TTL_SECONDS = TTL_SECONDS;
