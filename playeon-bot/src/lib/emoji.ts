import { md } from '@mtcute/markdown-parser'
import { config } from '../config.js'

/**
 * Every custom emoji in the bot, behind one switch.
 *
 * These are premium emoji: they travel as a `tg://emoji` entity wrapped around
 * a fallback glyph, and they only send at all while the account behind the bot
 * can use them. If that lapses, the choice is between messages that fail and
 * messages that quietly lose their icons, and the second is obviously better -
 * but it should be a decision somebody makes, not a surprise. `FEATURE_EMOJI`
 * is that decision, and it is off by default.
 *
 * Off means gone, not downgraded to the plain glyph. A message that has never
 * had an icon reads as a message; one whose icon degrades to a grey monochrome
 * ✅ reads as a message that went wrong.
 */
export function emojiEnabled(): boolean {
  return config.features.emoji
}

/**
 * A custom emoji as a fragment, or nothing.
 *
 * The space that usually follows one of these lives in the template that uses
 * it, because `md` trims whitespace at both edges of an interpolated fragment
 * and it could not be carried here even if it belonged here.
 */
export function customEmoji(char: string, id: string): ReturnType<typeof md> {
  return config.features.emoji ? md`[${char}](tg://emoji?id=${id})` : md``
}

/**
 * The same thing as raw markdown text, for the few callers that build their
 * line as a string before handing it to `md`.
 */
export function emojiTag(char: string, id: string): string {
  return config.features.emoji ? `[${char}](tg://emoji?id=${id})` : ''
}

export const WORD_JOINER = '\u2060'
export const PLAY_EMOJI_ID = '6102404441711846300' // ▶️ Play button
export const PAUSE_EMOJI_ID = '6100268816468550688' // ⏸️ Pause button
export const SKIP_EMOJI_ID = '6102411025896711978' // ⏭️ Skip button
export const JOIN_EMOJI_ID = '6102535751746987490' // 🚪 Join Room button
export const REMOVE_EMOJI_ID = '6102690190181016523' // 🗑️ Remove button
export const CANCEL_EMOJI_ID = '6102650478913396554' // ❌ Cancel button / status
export const TOGGLE_EMOJI_ID = SKIP_EMOJI_ID

// Inline text icons (smaller / padded for message body)
export const TEXT_PAUSE_EMOJI_ID = '6102427617355376015' // ⏸️ Text
export const TEXT_PLAY_EMOJI_ID = '6102860691792732091' // ▶️ Text
export const TEXT_SKIP_EMOJI_ID = '6102600519853810919' // ⏭️ Text
export const TEXT_END_EMOJI_ID = '6102688455014228420' // ⏹️ Text
export const PARTY_EMOJI_ID = '5863985154933919695' // 🎉 Text

// Progress bar premium emojis
export const PROGRESS_BAR_EMOJIS = {
  outlineLeft: '6105063657828262298',
  outlineCenter: '6105010335809281820',
  outlineEnd: '6102488640250717623',
  fillLeft: '6105053002014401160',
  fillCenter: '6102387519540699716',
  fillEnd: '6102753558128501546',
} as const
