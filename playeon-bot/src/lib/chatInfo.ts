import { tg } from '../client.js'

export async function memberCountOf(chatId: number): Promise<number | null> {
  try {
    const full = await tg.getFullChat(chatId)
    return full.membersCount ?? null
  } catch {
    return null
  }
}
