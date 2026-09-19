import { getDb, mongoConfigured } from "@/server/mongo";
import {
  guessTrackMeta,
  parseLrc,
  type LyricLine,
  type LyricsPayload,
} from "@/lib/lyrics";

/**
 * Timed-lyrics lookup, done once per track for the whole room.
 *
 * The client never talks to the provider directly. One viewer's lookup warms
 * the cache for everyone else in the room, misses are remembered so a track
 * without lyrics is asked about once rather than on every play, and concurrent
 * openers of the same track collapse into a single upstream request.
 *
 * LRCLIB is community-contributed and grants no redistribution licence, which
 * is fine for a private room and a decision to revisit before this is a
 * product.
 */

const UPSTREAM = "https://lrclib.net/api";

/** LRCLIB asks callers to identify themselves. */
const USER_AGENT = "playeon-web/0.1 (Telegram mini app)";

/** Give up rather than hold the response open - a miss is a fine answer. */
const UPSTREAM_TIMEOUT_MS = 4000;

/** A track that had no lyrics today probably still won't tomorrow. */
const MISS_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** Search hits this far from the room's duration are a different recording. */
const DURATION_SLACK_SEC = 4;

const MEMORY_LIMIT = 300;

type CacheEntry = { payload: LyricsPayload; at: number };

const CACHE = Symbol.for("playeon.lyrics");

type Cache = {
  memory: Map<string, CacheEntry>;
  inflight: Map<string, Promise<LyricsPayload>>;
};

const globalCache = globalThis as typeof globalThis & { [CACHE]?: Cache };
const cache: Cache = (globalCache[CACHE] ??= {
  memory: new Map(),
  inflight: new Map(),
});

const MISSING: LyricsPayload = { found: false, lines: [], matched: null };

function remember(key: string, payload: LyricsPayload): void {
  // insertion-ordered, so the oldest key is the first one out
  if (cache.memory.size >= MEMORY_LIMIT) {
    const oldest = cache.memory.keys().next().value;
    if (oldest !== undefined) cache.memory.delete(oldest);
  }
  cache.memory.set(key, { payload, at: Date.now() });
}

function fresh(entry: CacheEntry | undefined): LyricsPayload | null {
  if (!entry) return null;
  if (entry.payload.found) return entry.payload;
  return Date.now() - entry.at < MISS_TTL_MS ? entry.payload : null;
}

type LrcRecord = {
  id?: number;
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  syncedLyrics?: string | null;
};

async function upstream(path: string): Promise<unknown | null> {
  try {
    const response = await fetch(`${UPSTREAM}${path}`, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      // this route owns its own cache; Next's would key on the URL forever
      cache: "no-store",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`lrclib ${response.status}`);
    return await response.json();
  } catch {
    // network, timeout, or garbage body - treated as "ask again later"
    throw new Error("lyrics lookup failed");
  }
}

function toPayload(record: LrcRecord | null): LyricsPayload {
  const synced = record?.syncedLyrics?.trim();
  if (!record || record.instrumental || !synced) return MISSING;
  const lines: LyricLine[] = parseLrc(synced);
  if (lines.length === 0) return MISSING;
  return {
    found: true,
    lines,
    matched: {
      artist: record.artistName ?? "",
      track: record.trackName ?? "",
    },
  };
}

async function lookup(
  artist: string,
  track: string,
  durationSec: number,
): Promise<LyricsPayload> {
  const query = new URLSearchParams({
    artist_name: artist,
    track_name: track,
  });
  if (durationSec > 0) query.set("duration", String(Math.round(durationSec)));

  // the exact-match endpoint first: it is the one that respects duration, so a
  // hit here is the same recording rather than merely the same song
  const exact = (await upstream(`/get?${query}`)) as LrcRecord | null;
  const direct = toPayload(exact);
  if (direct.found) return direct;

  const search = new URLSearchParams({ track_name: track });
  if (artist) search.set("artist_name", artist);
  const results = (await upstream(`/search?${search}`)) as LrcRecord[] | null;
  if (!Array.isArray(results)) return MISSING;

  const candidates = results.filter(
    (record) => !record.instrumental && record.syncedLyrics?.trim(),
  );
  if (candidates.length === 0) return MISSING;

  if (durationSec > 0) {
    const near = candidates
      .filter(
        (record) =>
          typeof record.duration === "number" &&
          Math.abs(record.duration - durationSec) <= DURATION_SLACK_SEC,
      )
      .sort(
        (a, b) =>
          Math.abs((a.duration ?? 0) - durationSec) -
          Math.abs((b.duration ?? 0) - durationSec),
      );
    // no duration match means every hit is a different cut of the song, and
    // lyrics timed to a different cut are worse than none at all
    return near.length > 0 ? toPayload(near[0]) : MISSING;
  }

  return toPayload(candidates[0]);
}

type CacheDoc = { _id: string; payload: LyricsPayload; at: Date };

async function fromMongo(key: string): Promise<LyricsPayload | null> {
  if (!mongoConfigured()) return null;
  try {
    const db = await getDb();
    const doc = await db
      .collection<CacheDoc>("lyrics_cache")
      .findOne({ _id: key });
    if (!doc) return null;
    return fresh({ payload: doc.payload, at: doc.at.getTime() });
  } catch {
    // the cache is an optimisation; a Mongo blip just costs one lookup
    return null;
  }
}

async function toMongo(key: string, payload: LyricsPayload): Promise<void> {
  if (!mongoConfigured()) return;
  try {
    const db = await getDb();
    await db
      .collection<CacheDoc>("lyrics_cache")
      .updateOne(
        { _id: key },
        { $set: { payload, at: new Date() } },
        { upsert: true },
      );
  } catch {
    // as above - nothing here is worth failing the request over
  }
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const title = params.get("title")?.trim() ?? "";
  const channel = params.get("artist")?.trim() ?? "";
  const durationSec = Number(params.get("duration") ?? 0) || 0;
  const id = params.get("id")?.trim() ?? "";

  if (!title) {
    return Response.json(MISSING, { status: 400 });
  }

  const { artist, track } = guessTrackMeta(title, channel);
  if (!track) return Response.json(MISSING);

  // keyed on the video, not the guess: the same upload always resolves the
  // same way, and the guess is derived from it anyway
  const key = id || `${artist}::${track}::${Math.round(durationSec)}`;

  const hit = fresh(cache.memory.get(key));
  if (hit) return Response.json(hit);

  const stored = await fromMongo(key);
  if (stored) {
    remember(key, stored);
    return Response.json(stored);
  }

  let pending = cache.inflight.get(key);
  if (!pending) {
    pending = lookup(artist, track, durationSec)
      .then(async (payload) => {
        remember(key, payload);
        await toMongo(key, payload);
        return payload;
      })
      .finally(() => {
        cache.inflight.delete(key);
      });
    cache.inflight.set(key, pending);
  }

  try {
    return Response.json(await pending);
  } catch {
    // upstream was unreachable: answer "none" without caching it, so the next
    // play tries again
    return Response.json(MISSING);
  }
}
