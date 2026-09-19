import type { UpdateFilter } from '@mtcute/dispatcher'
import type { MessageContext } from '@mtcute/dispatcher'
import { getPrefix } from './prefix.js'

export function prefixCommand(
  name: string,
  aliases: string[],
  selfUsername: () => string,
): UpdateFilter<MessageContext, { command: string[] }> {
  const allNames = new Set([name.toLowerCase(), ...aliases.map(a => a.toLowerCase())])

  return async (msg) => {
    const text = msg.text?.trim()
    if (!text) return false

    const botUsername = selfUsername().toLowerCase()

    function matchCommand(str: string): string[] | null {
      const parts = str.trim().split(/\s+/)
      if (!parts[0]) return null
      if (!allNames.has(parts[0].toLowerCase())) return null
      return parts
    }

    let parts: string[] | null = null

    const prefix = await getPrefix(msg.chat.id)
    if (text.startsWith(prefix)) {
      const afterPrefix = text.slice(prefix.length)
      const tokenised = afterPrefix.split(/\s+/)
      const firstToken = tokenised[0] ?? ''
      const atIdx = firstToken.indexOf('@')
      if (atIdx !== -1) {
        const target = firstToken.slice(atIdx + 1).toLowerCase()
        if (target !== botUsername) return false
        tokenised[0] = firstToken.slice(0, atIdx)
      }
      parts = matchCommand(tokenised.join(' '))
    }

    if (!parts) {
      const atTag = `@${botUsername}`
      if (text.toLowerCase().startsWith(atTag)) {
        const after = text.slice(atTag.length).trim()
        parts = matchCommand(after)
      }
    }

    if (!parts) {
      const atTag = `@${botUsername}`
      if (text.toLowerCase().endsWith(atTag)) {
        const before = text.slice(0, text.length - atTag.length).trim()
        parts = matchCommand(before)
      }
    }

    if (!parts && msg.replyToMessage) {
      const replyInfo = msg.replyToMessage
      let replySenderId: number | null = null

      if (replyInfo.origin === 'same_chat') {
        try {
          const replied = await msg.getReplyTo()
          replySenderId = replied?.sender?.id ?? null
        } catch {}
      } else {
        const s = replyInfo.sender
        replySenderId = (s && s.type !== 'anonymous') ? s.id : null
      }

      if (replySenderId !== null) {
        const me = await msg.client.getMe()
        if (replySenderId === me.id) parts = matchCommand(text)
      }
    }

    if (!parts) return false

    ;(msg as MessageContext & { command: string[] }).command = parts
    return true
  }
}
