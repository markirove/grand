import { defineCommand, Role } from '../../core/command.js'
import { aiKeyManager } from '../../services/ai/aiKeyManager.js'
import { md } from '@mtcute/markdown-parser'

export default defineCommand({
  name: 'aikeys',
  order: 43,
  description: 'View AI key rotation pool status or add new Mistral keys.',
  usage: '/aikeys [add <key>]',
  category: 'dev',
  contexts: 'any',
  reply: true,
  roles: [Role.DEV],
  hidden: true,

  handler: async (ctx) => {
    const rawArgs = ctx.args.join(' ').trim()

    if (rawArgs.toLowerCase().startsWith('add ')) {
      const newKey = rawArgs.slice(4).trim()
      if (newKey.length < 15) {
        await ctx.msg.replyText(md`⚠️ Key seems too short to be a valid Mistral API key.`)
        return
      }
      aiKeyManager.addKey(newKey)
      await ctx.msg.replyText(
        md`✅ Successfully added new API key to rotation pool. Total keys: **${aiKeyManager.getKeyCount()}**`,
      )
      return
    }

    const statuses = aiKeyManager.getStatus()
    if (statuses.length === 0) {
      await ctx.msg.replyText(md`⚠️ No Mistral API keys configured in the pool.`)
      return
    }

    const lines = statuses.map((s) => {
      const statusIcon = s.healthy ? '🟢' : `🔴 (${s.cooldownRemainingSec}s cooldown)`
      return `**#${s.index}** \`${s.key}\` - ${statusIcon}\n   RPM (last 60s): **${s.requestsLastMinute}** reqs | Total: **${s.totalRequests}** | Errors: **${s.consecutiveErrors}**`
    })

    const text = `🔑 **Mistral AI Key Rotation Pool (${statuses.length} keys)**\n\n${lines.join(
      '\n\n',
    )}\n\n💡 _Use \`/aikeys add <key>\` to dynamically add more keys to the pool on the fly._`

    await ctx.msg.replyText(md(text), { disableWebPreview: true })
  },
})
