const isDev = process.env.NODE_ENV === "development" || (process.env.DEV_MODE ?? "") === "1";
import "server-only";

/**
 * Server-side configuration, read once at module load.
 *
 * Everything here is shared with the bot, and a mismatch is silent and fatal:
 * the wrong signing secret mints tokens the socket rejects, the wrong bot id
 * rejects every initData signature. Reading them in one place makes the
 * coupling visible instead of scattering `process.env` across the codebase.
 */

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Ids the bot treats as developers - same `DEV_IDS` var the bot parses. */
function idSet(value: string | undefined): ReadonlySet<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

/**
 * Signs the room JWT. Must equal the bot's `config.room.jwtSecret`, which is
 * `ROOM_JWT_SECRET || BOT_TOKEN` - so the fallback order here mirrors it.
 */
const roomSecret =
  optional("ROOM_JWT_SECRET") ??
  optional("BOT_TOKEN") ??
  optional("TELEGRAM_BOT_TOKEN");

export const env = {
  isDev,
  /** Verifies the Ed25519 initData signature; null disables auth entirely. */
  botId: optional("TELEGRAM_BOT_ID") ?? null,
  /** HMAC fallback for older clients whose initData carries no `signature`. */
  botToken: optional("TELEGRAM_BOT_TOKEN") ?? optional("BOT_TOKEN") ?? null,
  roomSecret: roomSecret ?? null,
  developerIds: idSet(optional("DEV_IDS") ?? optional("DEVELOPER_TELEGRAM_IDS")),
  mongoUri: optional("MONGO_URI") ?? null,
  mongoDb: optional("MONGO_DB") ?? null,
  /**
   * Where the bot's room server lives. The browser opens `${base}/room` over
   * WS and the join screen reads `${base}/preview` over HTTP, so this is
   * stored as an origin and the scheme is swapped per use.
   */
  roomBase: (
    process.env.NEXT_PUBLIC_ROOM_WS_URL ?? (isDev ? "http://localhost:3067" : "https://socket-playeon-bot.xysushi.in")
  ).replace(/\/+$/, ""),
} as const;

export type AppRole = "user" | "superuser" | "developer";
