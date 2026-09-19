
export type CancelEntry = {
  requesterId: number | string
  abort: () => void
}

const entries = new Map<string, CancelEntry>()

const key = (chatId: number | string, cardId: number): string => `${chatId}:${cardId}`

export function registerCancel(chatId: number | string, cardId: number, entry: CancelEntry): void {
  entries.set(key(chatId, cardId), entry)
}

export function clearCancel(chatId: number | string, cardId: number): void {
  entries.delete(key(chatId, cardId))
}

export function getCancel(chatId: number | string, cardId: number): CancelEntry | undefined {
  return entries.get(key(chatId, cardId))
}

export function sameUser(a: number | string, b: number | string): boolean {
  return String(a) === String(b)
}
