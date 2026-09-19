export function isNotModified(err: unknown): boolean {
  return err instanceof Error && /MESSAGE_NOT_MODIFIED/i.test(err.message)
}

export function isEmojiInvalid(err: unknown): boolean {
  return err instanceof Error && /EMOJI_INVALID|DOCUMENT_INVALID|MEDIA_INVALID/i.test(err.message)
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The chat allows the bot to talk but not to post this kind of media.
 *
 * Telegram spells that refusal several ways depending on which right is
 * missing and how the group was configured, so the whole family is matched.
 * Worth catching rather than surfacing: every caller has plain text to fall
 * back to, and a message that arrives without its picture beats no message.
 */
export function isMediaForbidden(err: unknown): boolean {
  return /CHAT_SEND_(PHOTOS|MEDIA|VIDEOS|DOCS|GIFS|STICKERS|AUDIOS|VOICES|PLAIN)_FORBIDDEN|MEDIA_INVALID|CHAT_MEDIA_UNALLOWED/i.test(
    errorMessage(err),
  )
}
