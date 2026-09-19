/**
 * YouTube thumbnail variants, and which of them are actually widescreen.
 *
 *   default        120×90    4:3
 *   mqdefault      320×180   16:9   always present
 *   hqdefault      480×360   4:3
 *   sddefault      640×480   4:3
 *   hq720          1280×720  16:9   same asset as maxresdefault
 *   maxresdefault  1280×720  16:9   only when the uploader supplied one
 *
 * `hqdefault` - the one most APIs hand you - bakes black bars into the pixels
 * for 16:9 content, so dropping it into a 16:9 stage letterboxes an already
 * letterboxed image. And `maxresdefault` simply is not there for a lot of
 * videos: asking for it blind is what produced the grey 120×90 placeholder
 * YouTube serves with its 404.
 *
 * So the choosing now happens where the answer is known. The bot reads the
 * thumbnail list off the same innertube response it already has and sends the
 * best frame that genuinely exists - `maxresdefault` where there is one, and
 * YouTube's own signed 16:9 crop where there is not. This file's job shrank to
 * not breaking that.
 */

const VARIANT = /\/vi\/([A-Za-z0-9_-]{11})\/[a-z0-9]+\.jpg/i;

/**
 * The frame to show.
 *
 * A URL carrying a query is one of YouTube's signed crops (`?sqp=…&rs=…`) and
 * is passed through untouched: the signature covers the exact path, so the
 * variant swap below would turn a working image into a rejected one - failing
 * harder than the problem it was there to fix.
 *
 * The swap survives for bare URLs because rooms outlive deploys: a track queued
 * by an older bot still carries a plain `hqdefault`, and upgrading it is the
 * old behaviour, 404 and all, with {@link wideFallback} to catch it.
 */
export function wideThumbnail(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.includes("?")) return url;
  return VARIANT.test(url)
    ? url.replace(VARIANT, "/vi/$1/maxresdefault.jpg")
    : url;
}

/**
 * Low-resolution but unconditionally present, for an `onError`.
 *
 * The query goes first: a signed crop that failed cannot be repaired by
 * swapping its variant, and `mqdefault` needs no signature - it is the one
 * 16:9 frame YouTube has for every video ever uploaded.
 */
export function wideFallback(url: string | null | undefined): string | null {
  if (!url) return null;
  const bare = url.split("?")[0]!;
  return VARIANT.test(bare)
    ? bare.replace(VARIANT, "/vi/$1/mqdefault.jpg")
    : url;
}
