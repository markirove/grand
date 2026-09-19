import { filters } from '@mtcute/dispatcher'
import { dp } from '../../client.js'
import type { CommandContext } from '../../core/command.js'
import { queueCard, queueKeyboard, type QueueView } from './playcard.js'
import { deleteStaleCard } from '../../lib/tempMessages.js'

type Tg = CommandContext['tg']

type Entry = { commandId: number; refetch: () => QueueView | null }
const MAX_CARDS = 200
const byCard = new Map<number, Entry>()

function register(cardId: number, entry: Entry): void {
  byCard.set(cardId, entry)
  while (byCard.size > MAX_CARDS) byCard.delete(byCard.keys().next().value as number)
}

export async function openQueueCard(
  tg: Tg,
  chatId: number,
  commandId: number,
  refetch: () => QueueView | null,
): Promise<boolean> {
  const view = refetch()
  if (!view) return false
  const { text, page, pages } = queueCard(view, 0)
  const sent = await tg
    .sendText(chatId, text, { replyTo: commandId, replyMarkup: queueKeyboard(page, pages), disableWebPreview: true })
    .catch(() => null)
  if (sent) register(sent.id, { commandId, refetch })
  return true
}

/**
 * The empty-queue reply, which is still a queue card.
 *
 * It gets Close and nothing else. A Join Room button here was answering a
 * question nobody asked: `/queue` is about what is lined up, and when the
 * answer is "nothing" the only useful thing to offer is a way to put the
 * message away. Registered like a real card so Close takes the command message
 * with it, the same as every other queue card.
 */
export async function openEmptyQueueCard(
  tg: Tg,
  chatId: number,
  commandId: number,
  text: Parameters<Tg['sendText']>[1],
): Promise<void> {
  const sent = await tg
    .sendText(chatId, text, {
      replyTo: commandId,
      replyMarkup: queueKeyboard(0, 1),
      disableWebPreview: true,
    })
    .catch(() => null)
  if (sent) register(sent.id, { commandId, refetch: () => null })
}

export function registerQueueCallbacks(): void {
  dp.onCallbackQuery(filters.regex(/^q:page:(\d+)$/), async (cq) => {
    const entry = byCard.get(cq.messageId)
    if (!entry) {
      await cq.answer({ text: 'This interaction is no longer valid', alert: true })
      deleteStaleCard(cq)
      return
    }
    const view = entry.refetch()
    if (!view) {
      await cq.answer({ text: 'This interaction is no longer valid', alert: true })
      byCard.delete(cq.messageId)
      deleteStaleCard(cq, entry.commandId)
      return
    }
    const { text, page, pages } = queueCard(view, Number(cq.match![1]))
    await cq.client
      .editMessage({ chatId: cq.chat.id, message: cq.messageId, text, replyMarkup: queueKeyboard(page, pages), disableWebPreview: true })
      .catch(() => {})
    await cq.answer({})
  })

  dp.onCallbackQuery(filters.regex(/^q:close$/), async (cq) => {
    const entry = byCard.get(cq.messageId)
    byCard.delete(cq.messageId)
    deleteStaleCard(cq, entry?.commandId)
    await cq.answer({})
  })

  dp.onCallbackQuery(filters.regex(/^q:noop$/), (cq) => cq.answer({}))
}
