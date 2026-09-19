import "server-only";

import { env, type AppRole } from "./env";
import { getDb, mongoConfigured } from "./mongo";

/**
 * Verifies the signed `initData` Telegram hands a mini app, and resolves the
 * caller's role from the same sources the bot uses.
 *
 * Two signature schemes are in play. Modern clients send an Ed25519
 * `signature` over `<bot_id>:WebAppData\n<data_check_string>`, which anyone can
 * verify against Telegram's published key. Older ones send only `hash`, an
 * HMAC keyed by the bot token. We prefer Ed25519 and fall back.
 */

const TELEGRAM_PUBLIC_KEYS = [
  "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d",
  "40055058a4ee38156a06562e52eece92a771bcd8346a8c4615cb7376eddf72ec",
] as const;

/** Telegram's own recommendation; also bounds replay of a leaked initData. */
const MAX_AGE_SECONDS = 3600;

export type TelegramUser = {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
};

export type AuthFailure =
  | "not_configured"
  | "missing_init_data"
  | "malformed"
  | "expired"
  | "bad_signature"
  | "missing_user";

export type AuthResult =
  | { ok: true; user: TelegramUser; authDate: number }
  | { ok: false; reason: AuthFailure };

/**
 * Backed by an explicit `ArrayBuffer` rather than the `Uint8Array(n)` shorthand:
 * since TS 5.7 typed arrays are generic over their buffer, and the shorthand
 * widens to `ArrayBufferLike`, which `BufferSource` won't accept.
 */
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const buffer = Buffer.from(input, "base64url");
  const bytes = new Uint8Array(new ArrayBuffer(buffer.length));
  bytes.set(buffer);
  return bytes;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time compare over equal-length hex digests. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Telegram's public keys never change, and deriving the HMAC key from the bot
 * token is two `subtle` calls - both are cached for the life of the process so
 * verification costs one signature check instead of a key ceremony per request.
 */
const ed25519Keys = new Map<string, Promise<CryptoKey | null>>();

function ed25519Key(hex: string): Promise<CryptoKey | null> {
  let key = ed25519Keys.get(hex);
  if (!key) {
    key = crypto.subtle
      .importKey("raw", hexToBytes(hex), { name: "Ed25519" }, false, ["verify"])
      .catch(() => null);
    ed25519Keys.set(hex, key);
  }
  return key;
}

let hmacKey: Promise<CryptoKey | null> | null = null;

function botTokenHmacKey(): Promise<CryptoKey | null> {
  hmacKey ??= (async () => {
    if (!env.botToken) return null;
    const encoder = new TextEncoder();
    const seed = await crypto.subtle.importKey(
      "raw",
      encoder.encode("WebAppData"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const derived = await crypto.subtle.sign(
      "HMAC",
      seed,
      encoder.encode(env.botToken),
    );
    return crypto.subtle.importKey(
      "raw",
      derived,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  })().catch(() => null);
  return hmacKey;
}

async function verifyEd25519(
  message: string,
  signature: string,
): Promise<boolean> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64UrlToBytes(signature);
  } catch {
    return false;
  }
  const data = new TextEncoder().encode(message);
  for (const hex of TELEGRAM_PUBLIC_KEYS) {
    const key = await ed25519Key(hex);
    if (!key) continue;
    try {
      if (await crypto.subtle.verify({ name: "Ed25519" }, key, bytes, data)) {
        return true;
      }
    } catch {
      // unsupported curve on this runtime - fall through to the HMAC path
    }
  }
  return false;
}

async function verifyHmac(check: string, hash: string): Promise<boolean> {
  const key = await botTokenHmacKey();
  if (!key) return false;
  try {
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(check),
    );
    return safeEqual(bytesToHex(signature), hash);
  } catch {
    return false;
  }
}

function parseUser(raw: string): TelegramUser | null {
  try {
    const parsed = JSON.parse(raw) as {
      id?: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
    };
    if (!parsed?.id) return null;
    const name =
      [parsed.first_name, parsed.last_name].filter(Boolean).join(" ").trim() ||
      parsed.username ||
      "there";
    return {
      id: String(parsed.id),
      name,
      firstName: parsed.first_name,
      lastName: parsed.last_name,
      username: parsed.username,
      photoUrl: parsed.photo_url,
    };
  } catch {
    return null;
  }
}

export async function verifyInitData(
  initDataRaw: string | null | undefined,
): Promise<AuthResult> {
  if (!env.botId && !env.botToken) return { ok: false, reason: "not_configured" };
  if (!initDataRaw) return { ok: false, reason: "missing_init_data" };

  const params = new URLSearchParams(initDataRaw);
  const hash = params.get("hash");
  const signature = params.get("signature");
  const authDateRaw = params.get("auth_date");
  if (!hash || !authDateRaw) return { ok: false, reason: "malformed" };

  const authDate = Number.parseInt(authDateRaw, 10);
  if (Number.isNaN(authDate)) return { ok: false, reason: "malformed" };
  if (Math.floor(Date.now() / 1000) - authDate > MAX_AGE_SECONDS) {
    return { ok: false, reason: "expired" };
  }

  const check = [...params.entries()]
    .filter(([key]) => key !== "hash" && key !== "signature")
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");

  let verified = false;
  if (signature && env.botId) {
    verified = await verifyEd25519(`${env.botId}:WebAppData\n${check}`, signature);
  }
  if (!verified) verified = await verifyHmac(check, hash);
  if (!verified) return { ok: false, reason: "bad_signature" };

  const userRaw = params.get("user");
  if (!userRaw) return { ok: false, reason: "missing_user" };
  const user = parseUser(userRaw);
  if (!user) return { ok: false, reason: "missing_user" };

  return { ok: true, user, authDate };
}

/**
 * Superuser lookups are a Mongo round trip on a value that changes maybe once
 * a month, and every request needs one. A short TTL cache keeps a busy room
 * from turning each control action into a database query, while still picking
 * up an `/addsuperuser` within the minute.
 */
const ROLE_TTL_MS = 60_000;
const roleCache = new Map<string, { role: AppRole; at: number }>();

export async function resolveRole(userId: string): Promise<AppRole> {
  if (env.developerIds.has(userId)) return "developer";
  if (!mongoConfigured()) return "user";

  const cached = roleCache.get(userId);
  if (cached && Date.now() - cached.at < ROLE_TTL_MS) return cached.role;

  let role: AppRole = "user";
  try {
    const db = await getDb();
    const hit = await db
      .collection<{ _id: string }>("superusers")
      .findOne({ _id: userId }, { projection: { _id: 1 } });
    if (hit) role = "superuser";
  } catch {
    // Mongo down - degrade to a plain user rather than failing the request,
    // and don't cache it, so the next call retries instead of pinning "user"
    return cached?.role ?? "user";
  }

  roleCache.set(userId, { role, at: Date.now() });
  return role;
}
