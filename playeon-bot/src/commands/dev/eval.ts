import { md } from '@mtcute/markdown-parser'
import { defineCommand, Role } from '../../core/command.js'

export default defineCommand({
  name: 'eval',
  order: 20,
  emoji: '🔨',
  emojiId: '5940433880585605708',
  description: 'Evaluate TypeScript in bot context.',
  usage: '/eval <code>',
  category: 'dev',
  contexts: 'any',

  reply: true,
  roles: [Role.DEV],

  handler: async (ctx) => {
    const { msg, rawArgs } = ctx
    if (!rawArgs.trim()) {
      await msg.answerText('Usage: /eval <code>')
      return
    }

    let result: unknown
    try {
      const fn = new Function('ctx', `return (async () => { ${rawArgs} })()`)
      result = await (fn as (c: unknown) => Promise<unknown>)(ctx)
    } catch (err) {
      result = err
    }

    let output: string
    if (result === undefined)       output = 'undefined'
    else if (result === null)       output = 'null'
    else if (result instanceof Error) output = `${result.name}: ${result.message}`
    else {
      try { output = JSON.stringify(result, null, 2) }
      catch { output = String(result) }
    }

    if (output.length > 3500) output = output.slice(0, 3500) + '\n…(truncated)'

    await msg.replyText(md`\`\`\`\n${output}\n\`\`\``)
  },
})
