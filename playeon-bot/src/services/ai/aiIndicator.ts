import { md } from '@mtcute/markdown-parser'
import type { MessageContext } from '@mtcute/dispatcher'
import type { Message } from '@mtcute/node'
import { Long } from '@mtcute/node'
import { resolvePeer, sendRichMessage } from '@mtcute/core/methods.js'
import { randomLong } from '@mtcute/core/utils.js'
import { tg } from '../../client.js'

export interface StreamingDraftLike {
  send(text: unknown): Promise<void>
}

export interface RichStreamingDraft {
  randomId: Long
  send(content: { type: 'html' | 'markdown'; content: string } | Record<string, unknown>): Promise<void>
  uploadCache: Map<string, unknown>
}

/**
 * Creates a native Telegram rich streaming draft with canStop: true
 * displaying Telegram's native shimmering <tg-thinking> effect.
 */
export async function createCancelableRichStreamingDraft(
  client: any,
  chatId: any,
  params?: {
    threadId?: number
    businessConnectionId?: string
    canStop?: boolean
    keepOnStop?: boolean
  },
): Promise<RichStreamingDraft> {
  const randomId = Long.fromBits(
    Math.floor(Math.random() * 0xffffffff),
    Math.floor(Math.random() * 0xffffffff),
  )
  const peer = await resolvePeer(client, chatId)
  const uploadCache = new Map<string, unknown>()

  const sendDraft = async (content: any) => {
    let richMessage: any
    if (content && content._) {
      richMessage = content
    } else if (content && content.type === 'markdown') {
      richMessage = {
        _: 'inputRichMessageMarkdown',
        markdown: content.content,
      }
    } else {
      richMessage = {
        _: 'inputRichMessageHTML',
        html: content?.content ?? '',
      }
    }

    await client.call(
      {
        _: 'messages.setTyping',
        peer,
        action: {
          _: 'inputSendMessageRichMessageDraftAction',
          canStop: params?.canStop ?? true,
          // Discard the shimmer if the stream ends without a matching final
          // message. Left as `true` a late/raced draft update outlives finalize()
          // and Telegram keeps it as a frozen "Vibing · 2s" ghost message.
          keepOnStop: params?.keepOnStop ?? false,
          randomId,
          richMessage,
        },
        topMsgId: params?.threadId,
      },
      {
        businessConnectionId: params?.businessConnectionId,
      },
    )
  }

  return {
    randomId,
    send: sendDraft,
    uploadCache,
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function cleanTruncate(text: unknown, maxLen = 24): string {
  if (typeof text !== 'string') return ''
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (!trimmed) return ''
  if (trimmed.length <= maxLen) return trimmed
  return trimmed.slice(0, maxLen - 1) + '…'
}

function capitalizeFirst(text: string): string {
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function formatToolDetails(toolName: string, input?: any): { action: string; completion: string } {
  const raw = (toolName || 'tool').toLowerCase()

  if (raw === 'play_track') {
    const isVideo = input?.video === true
    const verb = isVideo ? 'Streaming' : 'Playing'
    const compVerb = isVideo ? 'Streamed' : 'Played'
    const q = cleanTruncate(input?.query, 24)
    return q
      ? { action: `${verb} "${q}"`, completion: `${compVerb} "${q}" ✓` }
      : { action: verb, completion: `${compVerb} ✓` }
  }

  if (raw === 'search_tracks') {
    const q = cleanTruncate(input?.query, 24)
    return q
      ? { action: `Searching "${q}"`, completion: `Searched "${q}" ✓` }
      : { action: 'Searching', completion: 'Searched ✓' }
  }

  if (raw === 'pause_playback') {
    return { action: 'Pausing', completion: 'Paused ✓' }
  }

  if (raw === 'resume_playback') {
    return { action: 'Resuming', completion: 'Resumed ✓' }
  }

  if (raw === 'skip_track') {
    const t = cleanTruncate(input?.track || input?.title, 24)
    return t
      ? { action: `Skipping "${t}"`, completion: `Skipped "${t}" ✓` }
      : { action: 'Skipping', completion: 'Skipped ✓' }
  }

  if (raw === 'seek_position') {
    const s = cleanTruncate(String(input?.target ?? input?.seconds ?? ''), 16)
    return s
      ? { action: `Seeking "${s}"`, completion: `Seeked "${s}" ✓` }
      : { action: 'Seeking', completion: 'Seeked ✓' }
  }

  if (raw === 'get_room_status') {
    return { action: 'Inspecting', completion: 'Inspected ✓' }
  }

  if (raw === 'get_queue') {
    return { action: 'Listing', completion: 'Listed ✓' }
  }

  if (raw === 'clear_queue') {
    return { action: 'Clearing', completion: 'Cleared ✓' }
  }

  if (raw === 'set_loop') {
    const c = typeof input?.count === 'number'
      ? (input.count <= 0 ? 'off' : input.count > 10 ? 'on' : `${input.count}x`)
      : ''
    return c
      ? { action: `Looping "${c}"`, completion: `Looped "${c}" ✓` }
      : { action: 'Looping', completion: 'Looped ✓' }
  }

  if (raw === 'get_room_link') {
    return { action: 'Linking', completion: 'Linked ✓' }
  }

  if (raw === 'end_playback') {
    return { action: 'Stopping', completion: 'Stopped ✓' }
  }

  if (raw === 'set_room_mode') {
    const m = cleanTruncate(String(input?.mode ?? '').toUpperCase(), 8)
    return m
      ? { action: `Switching "${m}"`, completion: `Switched "${m}" ✓` }
      : { action: 'Switching', completion: 'Switched ✓' }
  }

  if (raw === 'set_room_style') {
    const s = capitalizeFirst(cleanTruncate(String(input?.style ?? ''), 16))
    return s
      ? { action: `Styling "${s}"`, completion: `Styled "${s}" ✓` }
      : { action: 'Styling', completion: 'Styled ✓' }
  }

  if (raw === 'save_memory') {
    const f = cleanTruncate(String(input?.fact ?? ''), 20)
    return f
      ? { action: `Remembering "${f}"`, completion: `Remembered "${f}" ✓` }
      : { action: 'Remembering', completion: 'Remembered ✓' }
  }

  if (raw === 'delete_memory') {
    const t = cleanTruncate(String(input?.target ?? ''), 20)
    return t
      ? { action: `Forgetting "${t}"`, completion: `Forgot "${t}" ✓` }
      : { action: 'Forgetting', completion: 'Forgot ✓' }
  }

  if (raw === 'view_memories') {
    return { action: 'Recalling', completion: 'Recalled ✓' }
  }

  const firstWord = toolName.split(/[_\s-]/)[0] || 'Working'
  const cap = capitalizeFirst(firstWord.toLowerCase())
  return { action: cap, completion: `${cap} ✓` }
}

export const THINKING_VERBS = [
  'Thinking',
  'Vibing',
  'Syncing',
  'Tuning',
  'Spinning',
  'Mixing',
  'Streaming',
  'Grooving',
  'Amplifying',
  'Modulating',
  'Searching',
  'Queuing',
  'Harmonizing',
  'Reasoning',
  'DJing',
  'Beating',
  'Synthesizing',
  'Composing',
  'Buffering',
  'Styling',
  'Echoing',
  'Filtering',
  'Matching',
  'Sequencing',
]

/**
 * Ceiling on how long an indicator may shimmer. Well past any legitimate run
 * (tool loop + a video download is a minute or two); this only ever fires when
 * the flow threw before it reached `finalize()`/`stop()`, or an upstream call
 * hung with neither a result nor an error.
 */
const INDICATOR_MAX_LIFETIME_MS = 180_000

/**
 * Manages Telegram's native rich streaming draft with shimmering <tg-thinking> glow styling,
 * dynamic rotating action verbs, live elapsed timer, and checkmarked task completion history.
 */
export class StreamingIndicator {
  private richDraft: RichStreamingDraft | null = null
  private standardDraft: StreamingDraftLike | null = null
  private startTime: number = Date.now()
  private elapsedSeconds: number = 1
  private tickerInterval: NodeJS.Timeout | null = null
  private lifetimeTimeout: NodeJS.Timeout | null = null
  private retired = false
  private currentVerb = 'Thinking'
  private lastVerbIndex = 0

  private activeAction: string | null = 'Thinking'
  private currentToolCompletion: string | null = null
  private completedTasks: string[] = []
  private accumulatedMarkdown = ''

  private lastPushedText = ''
  private lastPushedAt = 0
  private isStopped = false
  // Set the instant finalize() begins so no further draft update can be issued,
  // and a handle on the update currently in flight so finalize() can wait it out
  // before it commits the real message.
  private finalizing = false
  private inFlightPush: Promise<void> | null = null

  private groupLiveTarget: {
    client: any
    chatId: number
    messageId: number
  } | null = null
  private lastGroupEditAt = 0
  private isGroupEditing = false

  private startTicker() {
    if (this.tickerInterval) return
    const ticker = setInterval(() => {
      if (this.isStopped) return
      this.elapsedSeconds++
      // Dynamic thinking verb updates every 2 seconds, while duration updates every 1 second
      if (this.elapsedSeconds % 2 === 0) {
        this.lastVerbIndex = (this.lastVerbIndex + 1) % THINKING_VERBS.length
        this.currentVerb = THINKING_VERBS[this.lastVerbIndex] ?? 'Thinking'
      }
      this.pushDraft(true).catch(() => { })
    }, 1000)
    ticker.unref?.()
    this.tickerInterval = ticker

    // Backstop: never let the draft tick forever if the flow that owns this
    // indicator dies without calling stop()/finalize().
    const life = setTimeout(() => this.stop(), INDICATOR_MAX_LIFETIME_MS)
    life.unref?.()
    this.lifetimeTimeout = life
  }

  /**
   * Sets a live group message target that will be edited in real-time.
   */
  public setGroupLiveTarget(client: any, chatId: number, messageId: number) {
    this.groupLiveTarget = { client, chatId, messageId }
    this.startTime = Date.now()
    this.elapsedSeconds = 1
    this.lastVerbIndex = 0
    this.currentVerb = THINKING_VERBS[0] ?? 'Thinking'
    this.isStopped = false

    this.startTicker()
    this.pushDraft(true).catch(() => { })
  }

  /**
   * Attach Telegram native rich streaming draft with <tg-thinking> shimmer effect.
   */
  public setRichDraft(draft: RichStreamingDraft) {
    this.richDraft = draft
    this.startTime = Date.now()
    this.elapsedSeconds = 1
    this.lastVerbIndex = 0
    this.currentVerb = THINKING_VERBS[0] ?? 'Thinking'
    this.isStopped = false

    this.startTicker()
    this.pushDraft(true).catch(() => { })
  }

  public setStandardDraft(draft: StreamingDraftLike) {
    this.standardDraft = draft
    this.startTime = Date.now()
    this.elapsedSeconds = 1
    this.lastVerbIndex = 0
    this.currentVerb = THINKING_VERBS[0] ?? 'Thinking'
    this.isStopped = false

    this.startTicker()
    this.pushDraft(true).catch(() => { })
  }

  public setThinking() {
    this.activeAction = 'Thinking'
    this.pushDraft().catch(() => { })
  }

  public startTool(toolName: string, input?: any) {
    const details = formatToolDetails(toolName, input)
    this.activeAction = details.action
    this.currentToolCompletion = details.completion
    this.pushDraft().catch(() => { })
  }

  public finishTool(overrideSummary?: string) {
    const completionTag = overrideSummary
      ? (overrideSummary.endsWith('✓') ? overrideSummary : `${overrideSummary} ✓`)
      : this.currentToolCompletion

    if (completionTag && !this.completedTasks.includes(completionTag)) {
      this.completedTasks.push(completionTag)
    }

    this.currentToolCompletion = null
    this.activeAction = 'Thinking'
    this.pushDraft().catch(() => { })
  }

  public appendMarkdown(chunk: string) {
    this.accumulatedMarkdown += chunk
    this.pushDraft().catch(() => { })
  }

  public setMarkdown(text: string) {
    this.accumulatedMarkdown = text
    this.pushDraft().catch(() => { })
  }

  public buildDraftText(): string {
    const thinkingLine = `✦ **${this.currentVerb} · ${this.elapsedSeconds}s**`

    const toolLines: string[] = []
    if (this.completedTasks.length > 0) {
      for (const task of this.completedTasks.slice(-6)) {
        toolLines.push(task)
      }
    }

    if (this.activeAction && this.activeAction !== 'Thinking') {
      toolLines.push(`✦ ${this.activeAction}`)
    }

    let draft = thinkingLine
    if (toolLines.length > 0) {
      draft = `${thinkingLine}\n\n${toolLines.join('\n')}`
    }

    if (this.accumulatedMarkdown.trim()) {
      draft = `${draft}\n\n${this.accumulatedMarkdown.trim()}`
    }

    return draft
  }

  public buildRichHtml(): string {
    const thinkingHtml = `<tg-thinking>✦ <b>${escapeHtml(this.currentVerb)} · ${this.elapsedSeconds}s</b></tg-thinking>`

    const toolHtmlLines: string[] = []
    if (this.completedTasks.length > 0) {
      for (const task of this.completedTasks.slice(-6)) {
        toolHtmlLines.push(`<tg-thinking>${escapeHtml(task)}</tg-thinking>`)
      }
    }

    if (this.activeAction && this.activeAction !== 'Thinking') {
      toolHtmlLines.push(`<tg-thinking>✦ ${escapeHtml(this.activeAction)}</tg-thinking>`)
    }

    let draftHtml = thinkingHtml
    if (toolHtmlLines.length > 0) {
      draftHtml = `${thinkingHtml}\n\n${toolHtmlLines.join('\n')}`
    }

    if (this.accumulatedMarkdown.trim()) {
      draftHtml = `${draftHtml}\n\n${escapeHtml(this.accumulatedMarkdown.trim())}`
    }

    return draftHtml
  }

  public async pushDraft(force = false): Promise<void> {
    if ((!this.richDraft && !this.standardDraft && !this.groupLiveTarget) || this.isStopped || this.finalizing) {
      return
    }

    const now = Date.now()
    if (!force && now - this.lastPushedAt < 300) return

    const text = this.buildDraftText()
    if (text === this.lastPushedText) return

    this.lastPushedText = text
    this.lastPushedAt = now

    const work = (async () => {
      try {
        // Re-check: finalize()/stop() may have fired between the sync section above
        // and this microtask. A draft update that lands after finalize resurrects
        // the shimmer as a stale ghost message.
        if (this.isStopped || this.finalizing) return

        if (this.richDraft) {
          await this.richDraft.send({ type: 'html', content: this.buildRichHtml() }).catch(() => { })
        } else if (this.standardDraft) {
          await this.standardDraft.send(md(text)).catch(() => { })
        }

        if (
          this.groupLiveTarget &&
          !this.isStopped &&
          !this.finalizing &&
          !this.isGroupEditing &&
          now - this.lastGroupEditAt >= 1200
        ) {
          this.isGroupEditing = true
          this.lastGroupEditAt = now
          try {
            await this.groupLiveTarget.client.editMessage({
              chatId: this.groupLiveTarget.chatId,
              message: this.groupLiveTarget.messageId,
              text: md(text),
            })
          } catch {
          } finally {
            this.isGroupEditing = false
          }
        }
      } catch {
      }
    })()

    this.inFlightPush = work
    await work
  }

  public stop() {
    this.isStopped = true
    if (this.tickerInterval) {
      clearInterval(this.tickerInterval)
      this.tickerInterval = null
    }
    if (this.lifetimeTimeout) {
      clearTimeout(this.lifetimeTimeout)
      this.lifetimeTimeout = null
    }
  }

  /**
   * Abandon this indicator because a newer run has taken over the chat: stop
   * ticking now and suppress the final message, so the superseded run cannot
   * leave a shimmer behind or post a duplicate reply.
   */
  public retire() {
    this.retired = true
    this.stop()
  }

  public async finalize(finalText: string, msg: MessageContext): Promise<void> {
    // Block any new draft update, then let the one in flight settle so it can't
    // land after we commit the real message and leave a frozen shimmer behind.
    this.finalizing = true
    await this.inFlightPush?.catch(() => { })
    this.stop()
    if (this.retired) return
    const output = finalText.trim() ? finalText : 'Done!'

    if (this.groupLiveTarget) {
      try {
        await this.groupLiveTarget.client.editMessage({
          chatId: this.groupLiveTarget.chatId,
          message: this.groupLiveTarget.messageId,
          text: md(output),
          disableWebPreview: true,
        })
        return
      } catch {
      }
    }

    try {
      const peer = await resolvePeer(tg, msg.chat.id)
      const randomId = this.richDraft?.randomId ?? randomLong()
      await tg.call({
        _: 'messages.sendMessage',
        peer,
        noWebpage: true,
        replyTo: {
          _: 'inputReplyToMessage',
          replyToMsgId: msg.id,
        },
        randomId,
        message: '',
        richMessage: {
          _: 'inputRichMessageMarkdown',
          markdown: output,
        },
      })
      return
    } catch (sendErr) {
      console.warn('[ai] MTProto rich message with noWebpage failed, trying fallback:', sendErr)
    }

    try {
      if (this.richDraft) {
        await sendRichMessage(tg, msg.chat.id, {
          replyTo: msg.id,
          randomId: this.richDraft.randomId,
          uploadCache: this.richDraft.uploadCache as any,
          threadId: (msg as any).threadId,
          content: {
            type: 'markdown',
            content: output,
          },
        })
        return
      }
    } catch (sendErr) {
      console.warn('[ai] sendRichMessage with draft randomId failed, trying fallback:', sendErr)
      try {
        await sendRichMessage(tg, msg.chat.id, {
          replyTo: msg.id,
          threadId: (msg as any).threadId,
          content: {
            type: 'markdown',
            content: output,
          },
        })
        return
      } catch {
      }
    }

    await msg.replyText(md(output), { disableWebPreview: true }).catch(() => { })
  }
}
