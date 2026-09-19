import type { User } from '@mtcute/node'
import type { CommandContext } from '../core/command.js'

function looksLikeUserRef(s: string): boolean {
  return s.startsWith('@') || /^\d+$/.test(s)
}

export async function resolveTarget(ctx: CommandContext): Promise<User | null> {
  const { msg, tg, args, reply } = ctx

  const raw = args[0]
  if (raw && looksLikeUserRef(raw)) {
    try {
      const peer = await tg.getPeer(raw.startsWith('@') ? raw : Number(raw))
      if (peer.type === 'user') return peer
    } catch {}
  }

  const mention = msg.entities.find(e => e.kind === 'text_mention')
  if (mention?.is('text_mention')) {
    try {
      const peer = await tg.getPeer(mention.params.userId)
      if (peer.type === 'user') return peer
    } catch {}
  }

  if (reply) {
    const sender = reply.sender
    if (sender.type === 'user') return sender as User
  }

  return null
}

export function argIsTarget(args: string[]): boolean {
  return !!(args[0] && looksLikeUserRef(args[0]))
}
