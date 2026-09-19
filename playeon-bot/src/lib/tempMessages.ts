import type { TelegramClient } from '@mtcute/core/client.js'
import type { CallbackQueryContext } from '@mtcute/dispatcher'

type SendTextArgs = Parameters<TelegramClient['sendText']>

export async function sendTemporaryText(
  client: TelegramClient,
  chatId: SendTextArgs[0],
  text: SendTextArgs[1],
  ttlSeconds: number,
  params?: SendTextArgs[2],
) {
  const sent = await client.sendText(chatId, text, params)
  const ttlMs = Math.max(0, Math.floor(ttlSeconds * 1000))

  setTimeout(() => {
    void client.deleteMessagesById(chatId, [sent.id]).catch(() => {})
  }, ttlMs)

  return sent
}

/**
 * Deletes a stale card message, and also tries to find and delete the message
 * that the card had originally replied to (e.g. user command/prompt).
 * Fire and forget.
 */
export function deleteStaleCard(cq: CallbackQueryContext, knownReplyToId?: number | null): void {
  const chatId = cq.chat.id
  const cardId = cq.messageId

  void (async () => {
    try {
      let replyToId = knownReplyToId
      if (!replyToId) {
        const msg = await cq.getMessage().catch(() => null)
        replyToId = msg?.replyToMessage?.id ?? null
      }
      if (replyToId) {
        cq.client.deleteMessagesById(chatId, [replyToId]).catch(() => {})
      }
    } catch {
      // ignore
    } finally {
      cq.client.deleteMessagesById(chatId, [cardId]).catch(() => {})
    }
  })()
}
