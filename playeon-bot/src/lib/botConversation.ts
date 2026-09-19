import type { MessageContext } from '@mtcute/dispatcher'
import { PropagationAction } from '@mtcute/dispatcher'
import { dp } from '../client.js'

export class ConversationTimeoutError extends Error {
  constructor() {
    super('conversation_timeout')
    this.name = 'ConversationTimeoutError'
  }
}

type Pending = {
  resolve: (msg: MessageContext) => void
  reject: (err: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

const waiters = new Map<string, Pending>()
const key = (chatId: number, userId: number): string => `${chatId}:${userId}`

export function waitForMessage(
  chatId: number,
  userId: number,
  timeoutMs: number,
): Promise<MessageContext> {
  const k = key(chatId, userId)

  const existing = waiters.get(k)
  if (existing) {
    clearTimeout(existing.timer)
    waiters.delete(k)
    existing.reject(new Error('superseded'))
  }

  return new Promise<MessageContext>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(k)
      reject(new ConversationTimeoutError())
    }, timeoutMs)
    timer.unref?.()
    waiters.set(k, { resolve, reject, timer })
  })
}

export function cancelWait(chatId: number, userId: number): void {
  const k = key(chatId, userId)
  const pending = waiters.get(k)
  if (!pending) return
  clearTimeout(pending.timer)
  waiters.delete(k)
  pending.reject(new Error('cancelled'))
}

export function registerBotConversations(): void {
  dp.onNewMessage(async (msg) => {
    const sender = msg.sender
    if (sender.type !== 'user') return

    const pending = waiters.get(key(msg.chat.id, sender.id))
    if (!pending) return

    waiters.delete(key(msg.chat.id, sender.id))
    clearTimeout(pending.timer)
    pending.resolve(msg)
    return PropagationAction.StopChildren
  }, -10)
}
