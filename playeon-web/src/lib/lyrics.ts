/**
 * Timed lyrics: parsing, track matching, and the per-frame lookup.
 *
 * Everything here is pure and allocation-free at playback time. The parse and
 * the title guessing run once per track on the server; the only thing the
 * player calls in a rAF is `lineAt`, which is a couple of comparisons.
 */

export type LyricLine = {
  /** Seconds into the track. */
  t: number;
  /** Empty for the gaps between verses - the player draws those as a rest. */
  text: string;
};

export type LyricsPayload = {
  found: boolean;
  lines: LyricLine[];
  /** What the lookup actually matched, for debugging a wrong hit. */
  matched?: { artist: string; track: string } | null;
};

/** `[mm:ss.xx]`, `[mm:ss:xx]`, or `[hmm:ss]` - every dialect in the wild. */
const TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** `[offset:+250]`, in milliseconds, positive meaning "show earlier". */
const OFFSET_TAG = /^\[offset:\s*([+-]?\d+)\s*\]/i;

/**
 * Words that mark a bracketed group as packaging rather than part of the
 * title. "(Official Video)" is noise; "(Acoustic)" is a different recording
 * and is deliberately left in, because it usually has different timings.
 */
const PACKAGING =
  /\b(official|video|audio|lyrics?|lyric|visuali[sz]er|m\/?v|hd|hq|4k|full|stream|out now|explicit|clean|color[e]?d?\s*coded|eng(lish)?\s*sub\w*|sub(title)?s?|mp3|free download)\b/i;

const FEATURING = /\s*[([]?\s*(feat|ft|featuring)\.?\s+[^)\]]*[)\]]?\s*$/i;

/** Separators a "Artist - Title" upload might use. */
const SEPARATOR = /\s+[---|]\s+/;

const CHANNEL_SUFFIX = /\s*[---]\s*Topic\s*$/i;
const CHANNEL_NOISE = /\b(vevo|official|music|records|channel|tv)\b/gi;

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Drop the bracketed groups that are packaging, keep the ones that aren't. */
function stripPackaging(text: string): string {
  return collapse(
    text.replace(/[([{]([^)\]}]*)[)\]}]/g, (group, inner: string) =>
      PACKAGING.test(inner) ? " " : group,
    ),
  );
}

/**
 * Turn a YouTube title and channel into an artist/track pair worth searching.
 *
 * A `- Topic` channel is YouTube Music's own auto-generated artist channel, so
 * its name is the artist and the title needs no splitting - that path is by far
 * the most reliable, which is also why those tracks are the ones that tend to
 * come back with lyrics.
 */
export function guessTrackMeta(
  title: string,
  channel?: string | null,
): { artist: string; track: string } {
  const cleanTitle = stripPackaging(title ?? "");
  const rawChannel = collapse(channel ?? "");

  if (CHANNEL_SUFFIX.test(rawChannel)) {
    return {
      artist: collapse(rawChannel.replace(CHANNEL_SUFFIX, "")),
      track: collapse(cleanTitle.replace(FEATURING, "")),
    };
  }

  const parts = cleanTitle.split(SEPARATOR);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return {
      artist: collapse(parts[0]),
      // rejoin the tail: "Artist - Song - Live" keeps its own dashes
      track: collapse(parts.slice(1).join(" - ").replace(FEATURING, "")),
    };
  }

  return {
    artist: collapse(rawChannel.replace(CHANNEL_NOISE, "")),
    track: collapse(cleanTitle.replace(FEATURING, "")),
  };
}

/**
 * LRC to lines, sorted and de-duplicated.
 *
 * One source line can carry several timestamps (a chorus repeated four times
 * is written once), so this expands rather than maps.
 */
export function parseLrc(raw: string): LyricLine[] {
  const lines: LyricLine[] = [];
  let offsetSec = 0;

  for (const source of raw.split(/\r?\n/)) {
    const offset = OFFSET_TAG.exec(source);
    if (offset) {
      // positive offset means the lyrics run early, so it comes *off* the time
      offsetSec = Number(offset[1]) / 1000;
      continue;
    }

    TIMESTAMP.lastIndex = 0;
    let match: RegExpExecArray | null;
    let end = 0;
    const times: number[] = [];
    while ((match = TIMESTAMP.exec(source))) {
      // only the run of timestamps at the head of the line counts; a bracket
      // later in the line is part of the words
      if (match.index !== end) break;
      end = TIMESTAMP.lastIndex;
      const fraction = match[3] ?? "0";
      times.push(
        Number(match[1]) * 60 +
          Number(match[2]) +
          Number(fraction) / 10 ** fraction.length,
      );
    }
    if (times.length === 0) continue;

    const text = collapse(source.slice(end));
    for (const time of times) lines.push({ t: time, text });
  }

  lines.sort((a, b) => a.t - b.t);

  const out: LyricLine[] = [];
  for (const line of lines) {
    const previous = out[out.length - 1];
    // two blank rests in a row are one rest
    if (previous && !previous.text && !line.text) continue;
    if (previous && previous.t === line.t && previous.text === line.text) continue;
    out.push({ t: Math.max(0, line.t - offsetSec), text: line.text });
  }
  return out;
}

/** How far the forward scan will walk before a binary search is cheaper. */
const SCAN_LIMIT = 8;

/**
 * Which line is live at `position`, given where we were last frame.
 *
 * Playing forward this is one comparison - the common case by a mile. A seek
 * (or a rewind) falls back to a binary search, so a jump costs log₂(n) rather
 * than a walk. Returns -1 before the first line.
 */
export function lineAt(
  times: Float64Array,
  position: number,
  hint: number,
): number {
  const count = times.length;
  if (count === 0) return -1;

  if (hint >= 0 && hint < count && times[hint] <= position) {
    if (hint === count - 1 || times[hint + 1] > position) return hint;
    let index = hint;
    for (let step = 0; step < SCAN_LIMIT; step += 1) {
      index += 1;
      if (index === count - 1 || times[index + 1] > position) return index;
    }
  } else if (hint >= 0 && hint < count && times[hint] > position) {
    // stepped back a line - a nudge, not a jump
    if (hint === 0) {
      if (times[0] > position) return -1;
    } else if (times[hint - 1] <= position) {
      return hint - 1;
    }
  }

  if (times[0] > position) return -1;

  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (times[mid] <= position) low = mid;
    else high = mid - 1;
  }
  return low;
}
