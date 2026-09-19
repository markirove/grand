import type { User } from '@mtcute/node'
import { dp } from '../client.js'
import { getPrefix } from '../core/prefix.js'
import { handleAiChat } from '../services/ai/aiChatFlow.js'
import { config } from '../config.js'

export function registerAiMessageHandler(): void {
  dp.onNewMessage(async (msg) => {
    // Requires Mistral API key configured
    if (!config.ai.mistralApiKey && config.ai.mistralApiKeys.length === 0) return

    // Ignore service messages or non-user senders
    if (msg.isService) return
    const sender = msg.sender
    if (sender.type !== 'user' || (sender as User).isBot) return

    const text = msg.text?.trim()
    if (!text) return

    // Ignore slash commands
    const prefix = await getPrefix(msg.chat.id)
    if (text.startsWith(prefix)) return

    // Currently limited to DMs only
    if (msg.chat.type !== 'user') return

    await handleAiChat(msg)
  })
}
