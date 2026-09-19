export type CardTickerOpts = {
  tickMs?: number
  maxCards?: number
}

type Entry = { timer: ReturnType<typeof setInterval>; ids: Set<number> }

export class CardTicker {
  private readonly byChat = new Map<number, Entry>()
  private readonly tickMs: number
  private readonly maxCards: number

  constructor(private readonly onTick: (chatId: number) => void, opts: CardTickerOpts = {}) {
    this.tickMs = opts.tickMs ?? 7000
    this.maxCards = opts.maxCards ?? 10
  }

  private ensure(chatId: number): Entry {
    const existing = this.byChat.get(chatId)
    if (existing) return existing
    const timer = setInterval(() => this.onTick(chatId), this.tickMs)
    timer.unref?.()
    const entry: Entry = { timer, ids: new Set() }
    this.byChat.set(chatId, entry)
    return entry
  }

  begin(chatId: number, cardId: number): void {
    this.stop(chatId)
    this.ensure(chatId).ids.add(cardId)
  }

  add(chatId: number, cardId: number): void {
    const entry = this.ensure(chatId)
    entry.ids.add(cardId)
    while (entry.ids.size > this.maxCards) entry.ids.delete(entry.ids.values().next().value as number)
  }

  remove(chatId: number, cardId: number): void {
    this.byChat.get(chatId)?.ids.delete(cardId)
  }

  idsOf(chatId: number): number[] {
    const entry = this.byChat.get(chatId)
    return entry ? [...entry.ids] : []
  }

  has(chatId: number, cardId: number): boolean {
    return this.byChat.get(chatId)?.ids.has(cardId) ?? false
  }

  take(chatId: number): number[] {
    const ids = this.idsOf(chatId)
    this.stop(chatId)
    return ids
  }

  stop(chatId: number): void {
    const entry = this.byChat.get(chatId)
    if (!entry) return
    clearInterval(entry.timer)
    this.byChat.delete(chatId)
  }
}
