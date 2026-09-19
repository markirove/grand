import { md } from '@mtcute/markdown-parser'
import { BotKeyboard } from '@mtcute/node'
import { filters } from '@mtcute/dispatcher'
import { dp } from '../client.js'
import { config } from '../config.js'
import { emojiCallbackButton } from './keyboard.js'
import { analytics, WINDOW_LABEL, type AnalyticsWindow } from '../services/stats.js'

const WINDOWS: AnalyticsWindow[] = ['today', 'week', 'month', 'overall']

function isWindow(v: string): v is AnalyticsWindow {
  return (WINDOWS as string[]).includes(v)
}

function analyticsKeyboard(active: AnalyticsWindow): ReturnType<typeof BotKeyboard.inline> {
  const btn = (w: AnalyticsWindow) =>
    w === active
      ? emojiCallbackButton(WINDOW_LABEL[w], `an:${w}`, undefined, 'blue')
      : BotKeyboard.callback(WINDOW_LABEL[w], `an:${w}`)
  return BotKeyboard.inline([
    [btn('today'), btn('week')],
    [btn('month'), btn('overall')],
  ])
}

export async function renderAnalytics(window: AnalyticsWindow): Promise<{
  text: ReturnType<typeof md>
  replyMarkup: ReturnType<typeof BotKeyboard.inline>
}> {
  const c = await analytics(window)
  const text = md`📈 **Analytics - ${WINDOW_LABEL[window]}**

🎵 **Tracks played:** \`${c.tracksPlayed.toLocaleString()}\`
🌟 **Users started:** \`${c.usersStarted.toLocaleString()}\`
➕ **Groups added:** \`${c.groupsAdded.toLocaleString()}\``
  return { text, replyMarkup: analyticsKeyboard(window) }
}

export function registerAnalyticsCallbacks(): void {
  dp.onCallbackQuery(filters.regex(/^an:(today|week|month|overall)$/), async (cq) => {
    if (!config.devIds.includes(cq.user.id)) {
      await cq.answer({ text: 'Not allowed.', alert: true })
      return
    }
    const window = cq.match![1]!
    if (!isWindow(window)) {
      await cq.answer({})
      return
    }
    try {
      const r = await renderAnalytics(window)
      await cq.editMessage({ text: r.text, replyMarkup: r.replyMarkup })
    } catch {
    }
    await cq.answer({})
  })
}
