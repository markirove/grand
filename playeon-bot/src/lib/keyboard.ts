import { BotKeyboard, tl } from '@mtcute/node'
import Long from 'long'

export function buttonStyle(
  emojiId?: string,
  color?: 'blue' | 'green' | 'red',
): tl.RawKeyboardButtonStyle | undefined {
  if (!emojiId && !color) return undefined
  return {
    _: 'keyboardButtonStyle',
    ...(emojiId ? { icon: Long.fromString(emojiId) } : {}),
    ...(color === 'blue'  ? { bgPrimary: true } : {}),
    ...(color === 'green' ? { bgSuccess: true } : {}),
    ...(color === 'red'   ? { bgDanger:  true } : {}),
  }
}

export function emojiUrlButton(
  text: string,
  url: string,
  emojiId?: string,
  color?: 'blue' | 'green' | 'red',
) {
  return BotKeyboard.url(text, url, { style: buttonStyle(emojiId, color) })
}

export function emojiCallbackButton(
  text: string,
  data: string,
  emojiId?: string,
  color?: 'blue' | 'green' | 'red',
) {
  return BotKeyboard.callback(text, data, { style: buttonStyle(emojiId, color) })
}
