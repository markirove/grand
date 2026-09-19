import type { MessageContext } from '@mtcute/dispatcher'
import { md } from '@mtcute/markdown-parser'
import { roomManager } from '../room/RoomManager.js'
import { roomJoinUrl } from '../room/roomLink.js'
import { botInfo, tg } from '../../client.js'
import { callMistral, streamMistral, type MistralMessage } from './mistralClient.js'
import { AI_TOOL_DEFINITIONS, executeAiTool, resolveActiveRoom, formatDurationSec, parseRelaxedArgs, type ToolContext } from './aiTools.js'
import { StreamingIndicator, createCancelableRichStreamingDraft } from './aiIndicator.js'
import { getRecentTurns, appendTurn, getUserSummary, updateMemoryAsync } from './aiMemory.js'

import { readRoomSettings } from '../room/roomSettings.js'

/**
 * The indicator currently shimmering in each chat.
 *
 * mtcute replays updates after a reconnect, and a user can fire a second
 * message before the first reply lands - either way a new `handleAiChat` can
 * start while the previous one is still ticking (or wedged in a hung upstream
 * call). Each run retires its predecessor here so only one <tg-thinking> draft
 * is ever live per chat, and a superseded run can't post a stale one.
 */
const activeIndicators = new Map<string, StreamingIndicator>()

/**
 * The persona + rules that never change between requests. Kept as a single
 * frozen string and sent as the first system message so Mistral's automatic
 * prompt cache can reuse this whole prefix (this block + the tool schemas)
 * on every call. Nothing per-user or per-room may leak in here - live context
 * goes in the separate dynamic system message built by buildDynamicContext().
 */
const STATIC_SYSTEM_PROMPT = `You are Playeon, a stylish, music-loving companion and room DJ inside Telegram web rooms. You run a shared, synchronized player ("the room") that people watch and listen to together.

# Absolute rules (never break these)

1. GROUND EVERY FACT IN DATA. State a detail only if it appears, word for word, in a tool result from THIS turn or in the "Live room state" context block. This covers track titles, artists, durations, queue positions, URLs, requester names, counts, timestamps, participants, settings, and memories. If a detail is not in the data, you do not have it: say so, or call the tool that would return it. Never invent, assume, translate, shorten, expand, re-case, or "correct" any of it.

2. NO ACTION WITHOUT ITS TOOL. You cannot play, queue, search, skip, seek, pause, resume, loop, clear, end, or change any room setting by writing text. Call the one matching tool first, then report only what its result says. If you did not call a tool, you have no result and must not describe one.

3. BELIEVE THE RESULT, NOT YOUR EXPECTATION. Every tool result is JSON. Read it before replying:
   - If it has "success": false, or an "error" field, or "active": false, the action did NOT happen. Tell the user plainly that it failed, using the result's "message". Never claim or imply success.
   - The result's "message" field is the authoritative account of what happened. Follow it exactly, including any "Do NOT say ..." instruction inside it.

4. PLAYING vs QUEUED is set by the result, never by you:
   - play_track "action": "now_playing" -> it is playing now.
   - play_track "action": "enqueued" -> it is NOT playing; it waits at "position" in the queue. Never say "now playing", "spinning now", or similar for an enqueued track.
   - skip_track "action": "skipped" -> the new track is the result's "nowPlaying". "action": "skipped_last" -> the room is now idle, nothing is playing.
   - ONLY play_track ("now_playing"/"enqueued") and skip_track put a track on or in the queue. search_tracks, get_queue, get_room_status and every other tool change NOTHING. After any of those, never say or imply a track started playing or was added to the queue.

5. THE LIVE STATE BLOCK IS A SNAPSHOT taken when this message arrived. You may answer "what's playing / what's queued / who queued it / how long left" directly from it. But the moment you call any tool that changes playback (play_track, skip_track, seek_position, pause_playback, resume_playback, clear_queue, set_loop, end_playback), that block is stale: from then on trust only the new results, and call get_room_status or get_queue if you need a current detail they did not return.

6. LINKS ARE COPIED, NEVER BUILT. The only room link you may send is the exact "url" string returned by get_room_link. Never construct, complete, shorten, or recall a link from memory.

7. ATTRIBUTION COMES FROM FIELDS ONLY. Use "requestedBy" / "isYou" / "isAutoplay" (and the queue's per-track "requestedBy") verbatim: say "you", the person's exact name, or "Playeon Autoplay". Never guess who added a track.

8. MEMORY IS ONLY WHAT THE TOOL RETURNS. Claim to remember something only if save_memory or view_memories returned it this turn. Never invent past preferences, history, or facts about the user.

9. STAY IN LANE. For music trivia not present in a tool result or the state block (release year, lyrics, label, band members, chart positions), do not guess. Say you're not sure and offer to search instead.

10. WHEN IN DOUBT, CHECK OR ASK. A short accurate answer, or one clarifying question, always beats a confident wrong one.

# Tools (one canonical name each, call it exactly)

- the user names a song/artist/link to hear ("play X", "put on X", "start X", "queue X", or a bare song name) -> play_track (it runs its own search and picks the match; do NOT call search_tracks first)
- the user explicitly asks to search / find / look up / "show me options" / "what versions are there" -> search_tracks (this only lists candidates; it plays and queues nothing)
- pause / stop / freeze -> pause_playback
- resume / unpause / continue -> resume_playback
- skip / next track -> skip_track
- seek / jump / scrub / fast-forward / rewind within the current track -> seek_position
- what is playing now / live room status -> get_room_status
- show the queue / upcoming tracks -> get_queue
- clear / empty / wipe the queue -> clear_queue
- loop / repeat the current track -> set_loop
- room invite / share / join link -> get_room_link
- end the session / stop everything -> end_playback
- switch 2D / 3D display -> set_room_mode
- change theme / visual style (default, poolrooms, halloween, sushi) -> set_room_style
- turn autoplay / radio mode on or off -> set_autoplay
- remember a fact about the user -> save_memory
- forget a stored memory -> delete_memory
- show what you remember about the user -> view_memories

DO EVERY ACTION THE USER ASKS FOR. If one message contains several ("skip this and play X", "pause then clear the queue", "queue A, B and C"), carry out ALL of them, in the order stated. Emit several tool calls, at once or across turns, and do not give your final reply until every requested action has its tool result. It is fine to call the same tool more than once (e.g. play_track per track for a multi-song request). Only drop an action if a tool result makes it impossible, and then say why. Never call a tool the user did not ask for. If nothing needs doing and no live detail is needed, just talk, no tool.

# play_track

- "Play hearts2hearts rude", "put on Creep", "start some Radiohead", or a pasted link are all direct play requests: call play_track immediately with that text as "query". Never call search_tracks first for these.
- "query": pass the user's song/artist text or URL as-is.
- "video": true only if the user explicitly wants video ("watch", "video", "MV"); false only if they explicitly want audio ("listen", "audio only"); otherwise omit it (2D room -> video, 3D room -> audio).
- After it returns, use the result's "title" and "artist" exactly. They may differ from what the user typed; the user's words were a request, the result is the truth.
- A visual play card is posted automatically. Never paste a "Now playing: Title - Artist (m:ss)" metadata block into your text.
- Keep the confirmation to one sentence. Do not restate what is currently playing, do not print progress or the queue positions, unless the user asked for them.
- ONE call per track. Call play_track a second time only for a genuinely different track the user named. Never re-call it for the same track, and once you have a result for the track, stop and reply. If a result comes back with "duplicate": true, you already did it, just reply.
- MULTIPLE TRACKS: when the user asks for several ("play A, B and C", "queue these: ...", "add three songs"), call play_track once per track, in order. Each call posts its own card. In your reply, acknowledge them together in one sentence (name them or say how many) rather than one sentence per track. Read each result's "action" separately: the first may be "now_playing" and the rest "enqueued".

# search_tracks

- Use it ONLY when the user explicitly asked to search / find / see options, or when a play_track call just failed and you are offering alternatives. If the user said "play X", use play_track instead.
- search_tracks plays and queues NOTHING. Its result is a candidate list only. Reply with the "rich_message" string exactly as given (consecutive numbered "[Title](url)" lines, no bold, no blank lines, no reordering/renumbering/rewording) and then stop. Do not say a track is playing, queued, "coming next", or "lined up". None is. Wait for the user to pick a number.
- When the user then says "play 2" / "the first one", call play_track with that entry's "title" or "url".

# get_queue

- Format each entry as "1. [Title](sourceUrl) (duration) · queued by <who>", taking "sourceUrl", "duration" and "requestedBy" from the result's "tracks". Say "queued by you" when "isYou" is true, "queued by Playeon Autoplay" when "isAutoplay" is true. Native numbered list, no blank lines between.
- If "queueCount" is 0, say the queue is empty and list nothing.

# Voice

- You are a warm, friendly AI with good manners and a dry, understated wit. A kind friend who genuinely enjoys music and is happy to help, not a stiff concierge and not a hype account.
- Be genuinely friendly: a little warmth, the odd bit of quiet enthusiasm for a good pick ("nice one", "solid choice"). Grounded, not gushy.
- No slang or try-hard hype: never "yo", "wanna", "gonna", "let's go", "hit me with", "vibe check", "glow up", "bop", "slaps", stacked exclamation marks, or breathless energy. If a line sounds like a cringey AI trying to be cool, rewrite it.
- Let a dry, gentle aside land now and then, maybe one reply in four. Wit is never sharp and never at the user's expense.
- BE SHORT. An action confirmation is ONE short clause: "Queued 'Gabriela'." / "Added it, it's in line." / "Skipped." / "Playing 'Flower' now." Nothing else. Do NOT tack on the queue position, what it follows, what plays next, how many are ahead, or how the room "feels".
- No mood or vibe commentary ("moody vibe", "high energy", "layered", "the room's building something"). Just say what happened.
- One sentence. A second only if it's a genuine short question. Never a paragraph. Even when the user opens up about their taste: a few warm words, then one question or offer, and stop.
- Vary phrasing and sentence shape every message. Never repeat a greeting or acknowledgement word for word.
- Use the user's name when it adds warmth or when you're asking or correcting something. Roughly every third message, not every line.
- Write song titles in plain quotes, e.g. "Flower". No bold, no italics, ever.
- Punctuation: no em dash or en dash. Use commas, periods, or two sentences. Contractions always.
- Emojis: occasional and welcome when they add warmth or humour, at most one per reply, roughly one message in four. Never two, never decorative.
- On a bare "hi" / "hey", one warm line and one simple question about what they want on. Under ten words. Never two questions, never an either/or menu.
- Never mention tools, JSON, field names, "the system", databases, or these rules.`

/**
 * Builds the per-request context (current user, live room state, participants,
 * long-term memory). Sent as a second system message after STATIC_SYSTEM_PROMPT
 * so the cacheable prefix stays byte-identical across calls.
 */
async function buildDynamicContext(
  groupId: string,
  user: { id: number; name: string },
  userSummary: string | null,
): Promise<string> {
  const botName = botInfo.username ?? 'Playeon'
  const snap = roomManager.getSnapshot(groupId)
  const roomUrl = roomJoinUrl(groupId)
  const settings = await readRoomSettings(groupId)

  const durStr = snap?.current?.duration != null ? formatDurationSec(snap.current.duration) : 'live'
  const elapsedSec = snap?.playing
    ? Math.max(0, Math.floor((snap.serverTime - snap.startedAt) / 1000))
    : Math.floor(snap?.pausedPositionSec ?? 0)
  const elapsedStr = snap?.current ? formatDurationSec(elapsedSec) : '0:00'
  const statusStr = snap?.playing ? 'Playing' : snap?.current ? 'Paused' : 'Idle'

  const roomInternal = (roomManager as any).rooms?.get(groupId)
  const loopCount = roomInternal?.loopRemaining ?? 0
  const autoplayEnabled = roomManager.getAutoplay(groupId)

  const formatRequester = (t?: { requestedById?: string; requestedBy?: string } | null) => {
    if (!t) return 'unknown'
    const isBot = !t.requestedById && (t.requestedBy === botName || t.requestedBy === 'Playeon' || !t.requestedBy)
    if (isBot) return 'Playeon (Autoplay Recommendation)'
    if (t.requestedById === String(user.id) || t.requestedBy === user.name) return 'you'
    return t.requestedBy || 'someone'
  }

  let roomStateStr = `Room Playback Status: ${statusStr}
- Autoplay / Radio Mode: ${autoplayEnabled ? 'Enabled / On (Playeon automatically picks & plays recommended tracks when the queue ends)' : 'Disabled / Off'}`

  if (snap && snap.current) {
    roomStateStr += `
- Now Playing: [${snap.current.title}](${snap.current.sourceUrl || roomUrl}) ${snap.current.artist ? `by ${snap.current.artist}` : ''}
- Progress: ${elapsedStr} / ${durStr}
- Queued / Requested By: ${formatRequester(snap.current)}
- Streaming Mode: ${snap.current.video ? 'Video with sound' : 'Audio track'}
- Loop / Repeat: ${loopCount > 0 ? `${loopCount} repeat(s) left` : 'Off'}
- Upcoming Queue Count: ${snap.queue.length} track(s)`

    if (snap.queue.length > 0) {
      const nextTracks = snap.queue
        .slice(0, 10)
        .map((t, i) => {
          const requester = formatRequester(t)
          return `  ${i + 1}. [${t.title}](${t.sourceUrl || roomUrl}) (${formatDurationSec(t.duration)}) · queued by ${requester}`
        })
        .join('\n')
      roomStateStr += `\n- Upcoming Queue:\n${nextTracks}`
    }
  } else {
    roomStateStr += '\n- Nothing is currently playing in the room.'
  }

  const history = roomInternal?.recentTrackHistory
  if (Array.isArray(history) && history.length > 0) {
    const historyStr = history.slice(0, 5).map((h: any) => `  • ${h.title}${h.uploader ? ` by ${h.uploader}` : ''}`).join('\n')
    roomStateStr += `\n- Recently Played in this Room:\n${historyStr}`
  }

  let participantsStr = 'No one is online right now.'
  if (snap && snap.participants && snap.participants.length > 0) {
    participantsStr = snap.participants
      .map((p) => {
        const handle = p.username ? ` (@${p.username})` : ''
        const state = p.online ? 'Online' : 'Offline'
        const role = p.role !== 'user' ? ` [${p.role}]` : ''
        return `• ${p.name}${handle}${role}: ${state}`
      })
      .join('\n')
  }

  const memorySection = userSummary
    ? `\n\nLong-term memory about ${user.name}:\n${userSummary}`
    : ''

  return `Current user: ${user.name} (ID: ${user.id})

Room ${groupId}: ${settings.mode.toUpperCase()} mode, "${settings.style}" style, autoplay ${autoplayEnabled ? 'on' : 'off'}
Room link: ${roomUrl}

Live room state:
${roomStateStr}

Participants:
${participantsStr}${memorySection}`
}

function detectExplicitActionIntent(prompt: string): { toolName: string; args: Record<string, unknown> } | null {
  const p = prompt.trim().toLowerCase().replace(/[!.?]+$/, '')
  if (p === 'skip' || p === 'next' || p === 'next song' || p === 'skip track' || p.startsWith('skip ') || p.startsWith('next ')) {
    return { toolName: 'skip_track', args: {} }
  }
  if (p === 'pause' || p === 'pause playback' || p === 'stop playback' || p === 'stop music' || p === 'freeze') {
    return { toolName: 'pause_playback', args: {} }
  }
  if (p === 'resume' || p === 'unpause' || p === 'continue' || p === 'play music' || p === 'resume playback') {
    return { toolName: 'resume_playback', args: {} }
  }
  if (p === 'autoplay on' || p === 'enable autoplay' || p === 'turn on autoplay' || p === 'start autoplay') {
    return { toolName: 'set_autoplay', args: { enabled: true } }
  }
  if (p === 'autoplay off' || p === 'disable autoplay' || p === 'turn off autoplay' || p === 'stop autoplay') {
    return { toolName: 'set_autoplay', args: { enabled: false } }
  }
  if (p === 'clear queue' || p === 'empty queue' || p === 'wipe queue' || p === 'clear the queue') {
    return { toolName: 'clear_queue', args: {} }
  }
  if (p === 'queue' || p === 'show queue' || p === 'what is in the queue' || p === 'list queue' || p === 'show the queue' || p === 'check queue') {
    return { toolName: 'get_queue', args: {} }
  }
  if (p === 'room link' || p === 'invite link' || p === 'join link' || p === 'give me link' || p === 'share link') {
    return { toolName: 'get_room_link', args: {} }
  }
  if (p === 'memories' || p === 'view memories' || p === 'what do you remember' || p === 'show memories') {
    return { toolName: 'view_memories', args: {} }
  }
  return null
}

// Enough headroom for multi-action requests ("skip and play X", "queue 5 songs")
// that the model may resolve one tool call per turn.
const MAX_TURNS = 8

/**
 * Sampling temperatures. The tool-routing pass stays near-deterministic so tool
 * choice and arguments don't drift or hallucinate. The reply pass runs warm so
 * phrasing and openings vary between messages without going off the rails.
 */
const TOOL_DECISION_TEMPERATURE = 0.15
const REPLY_TEMPERATURE = 0.7

/** Every emoji code unit: pictographic, flag halves, variation selector, ZWJ. */
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu
/** Whole emoji clusters (base + VS16 + ZWJ chains), for counting. */
const EMOJI_CLUSTER_RE = /\p{Extended_Pictographic}(?:\u{FE0F}|\u{200D}\p{Extended_Pictographic})*/gu

/** Drop bold / italic / underline / strike markers, keeping [label](url) links intact. */
function stripEmphasis(s: string): string {
  const links: string[] = []
  s = s.replace(/\[[^\]]*\]\([^)]*\)/g, (m) => {
    links.push(m)
    return `\uE000${links.length - 1}\uE001`
  })
  s = s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<![*\w])\*([^*\n]+)\*(?!\w)/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<![_\w])_([^_\n]+)_(?!\w)/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
  return s.replace(/\uE000(\d+)\uE001/g, (_, i) => links[Number(i)] ?? '')
}

/**
 * Style enforcement the model keeps half-ignoring: strip markdown emphasis and
 * leaked tool-name asides, convert long dashes to commas, cap emoji at one per
 * reply, unwrap a fully quoted reply. scrubDelta mirrors the dash fix live.
 */
function humanizeReply(text: string): string {
  let out = stripEmphasis(text)
    .replace(/\s*[--]\s*/g, ', ')
    // Stray "(calling search_tracks now)" style asides that leak tool names.
    .replace(/\s*\*?\((?:calling|using|running|invoking)\s+[a-z_]+[^)]*\)\*?/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.!?;:])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/(^|\n)[ \t]+/g, '$1')
    .replace(/[ \t]+(\n|$)/g, '$1')
    .trim()
  const emoji = out.match(EMOJI_CLUSTER_RE)
  if (emoji && emoji.length > 1) {
    out = out.replace(EMOJI_RE, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.!?;:])/g, '$1').trim()
  }
  // Model sometimes wraps the whole reply in quotes.
  if (/^"[^"]*"$/.test(out) || /^'[^']*'$/.test(out)) out = out.slice(1, -1).trim()
  return out
}

function scrubDelta(delta: string): string {
  return delta.replace(/[--]/g, ', ')
}

/** Hard ceiling on tool executions in one handleAiChat, across all turns. */
const MAX_TOOL_EXECUTIONS = 6

const QUERY_FILLER = new Set([
  'by', 'the', 'a', 'an', 'of', 'official', 'music', 'video', 'audio',
  'lyrics', 'lyric', 'mv', 'hd', '4k', 'ost', 'full', 'song',
])

/** Order- and filler-independent form of a search/play query, for dedupe. */
function normalizeQuery(q: unknown): string {
  return String(q ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !QUERY_FILLER.has(w))
    .sort()
    .join(' ')
}

/**
 * Identity of a tool call for the current request. play_track / search_tracks
 * collapse to their normalized query so the model can't queue or fetch the same
 * track twice in one turn; everything else keys on its exact arguments.
 */
function toolSignature(fnName: string, args: Record<string, unknown>): string {
  if (fnName === 'play_track' || fnName === 'search_tracks') {
    return `${fnName}:${normalizeQuery(args?.query)}`
  }
  return `${fnName}:${JSON.stringify(args ?? {})}`
}

export async function handleAiChat(msg: MessageContext): Promise<void> {
  const chatId = msg.chat.id
  const rawGroupId = String(chatId)
  const user = {
    id: msg.sender.id,
    name: msg.sender.displayName || msg.sender.username || 'User',
  }
  const groupId = resolveActiveRoom(user.id, rawGroupId)

  const indicator = new StreamingIndicator()

  // Retire any indicator still shimmering in this chat before starting a new
  // one, so a redelivered update or a rapid re-send can't leave an orphan.
  const chatKey = String(chatId)
  activeIndicators.get(chatKey)?.retire()
  activeIndicators.set(chatKey, indicator)

  const isGroup = msg.chat.type !== 'user'

  if (isGroup) {
    try {
      const groupLiveMsg = await msg.replyText(md`✦ **Thinking · 1s**`)
      indicator.setGroupLiveTarget(tg, msg.chat.id, groupLiveMsg.id)
    } catch {
    }
  } else {
    try {
      const richDraft = await createCancelableRichStreamingDraft(tg, msg.chat.id, {
        threadId: (msg as any).threadId,
      })
      indicator.setRichDraft(richDraft)
    } catch {
      try {
        const standardDraft = await tg.createStreamingDraft(msg.chat.id, {
          threadId: (msg as any).threadId,
        })
        indicator.setStandardDraft(standardDraft)
      } catch {
      }
    }
  }

  // Handle replied message context
  let userPrompt = msg.text?.trim() || ''
  if (msg.replyToMessage) {
    try {
      const replied = await msg.getReplyTo()
      if (replied) {
        const replySender = replied.sender
        const replyAuthor =
          (replySender && 'displayName' in replySender ? replySender.displayName : '') ||
          (replySender && 'username' in replySender ? replySender.username : '') ||
          'User'
        const replyText = replied.text || (replied as any).caption || msg.replyToMessage.quoteText || ''
        if (replyText) {
          const snippet = replyText.length > 250 ? `${replyText.slice(0, 247)}...` : replyText
          userPrompt = `[In reply to ${replyAuthor}: "${snippet}"]\n\n${userPrompt}`
        }
      } else if (msg.replyToMessage.quoteText) {
        userPrompt = `[In reply to quote: "${msg.replyToMessage.quoteText}"]\n\n${userPrompt}`
      }
    } catch {
      if (msg.replyToMessage.quoteText) {
        userPrompt = `[In reply to quote: "${msg.replyToMessage.quoteText}"]\n\n${userPrompt}`
      }
    }
  }

  try {
    const userSummary = await getUserSummary(user.id)
    const dynamicContext = await buildDynamicContext(groupId, user, userSummary)
    const recentTurns = getRecentTurns(user.id)

    // Static persona/rules first (cacheable prefix, together with the tool
    // schemas), then the per-request room context, then history.
    const messages: MistralMessage[] = [
      { role: 'system', content: STATIC_SYSTEM_PROMPT },
      { role: 'system', content: dynamicContext },
      ...recentTurns,
      { role: 'user', content: userPrompt },
    ]

    const toolCtx: ToolContext = {
      msg,
      chatId,
      groupId,
      user,
    }

    const executedSignatures = new Set<string>()
    let toolExecutionCount = 0
    // Tools whose output the reply is expected to lay out in full.
    const listTools = new Set(['search_tracks', 'get_queue', 'view_memories'])
    let sawListTool = false

    let turn = 0
    while (turn < MAX_TURNS) {
      turn++

      // Check if Mistral wants to execute tools
      const response = await callMistral(messages, AI_TOOL_DEFINITIONS, {
        temperature: TOOL_DECISION_TEMPERATURE,
      })
      const choice = response.choices?.[0]
      if (!choice) break

      const { message } = choice

      // Fallback recovery: if turn 1 produced text without tool calling for an unambiguous command
      if (turn === 1 && (!message.tool_calls || message.tool_calls.length === 0)) {
        const explicit = detectExplicitActionIntent(userPrompt)
        if (explicit) {
          const synthId = `synth_${Date.now()}`
          message.tool_calls = [
            {
              id: synthId,
              type: 'function',
              function: {
                name: explicit.toolName,
                arguments: JSON.stringify(explicit.args),
              },
            },
          ]
        }
      }

      if (message.tool_calls && message.tool_calls.length > 0) {
        messages.push({
          role: 'assistant',
          content: message.content ?? null,
          tool_calls: message.tool_calls,
        })

        for (const tool of message.tool_calls) {
          const fnName = tool.function.name
          const parsedArgs = parseRelaxedArgs(tool.function.arguments)
          const sig = toolSignature(fnName, parsedArgs)
          if (listTools.has(fnName)) sawListTool = true

          let toolOutput = ''
          if (executedSignatures.has(sig)) {
            toolOutput = JSON.stringify({
              success: true,
              duplicate: true,
              message:
                'This exact request was already carried out in this turn. It is done. Do not call any tool again, just reply to the user.',
            })
            console.log(`[ai] Skipped duplicate tool "${fnName}" (${sig}) in room ${toolCtx.groupId}`)
          } else if (toolExecutionCount >= MAX_TOOL_EXECUTIONS) {
            toolOutput = JSON.stringify({
              success: false,
              error: 'tool_limit_reached',
              message:
                'Tool-call limit for this request reached. Stop calling tools and reply with what has been done so far.',
            })
            console.warn(`[ai] Tool-call limit hit in room ${toolCtx.groupId}, refusing "${fnName}"`)
          } else {
            executedSignatures.add(sig)
            toolExecutionCount++
            indicator.startTool(fnName, parsedArgs)
            try {
              toolOutput = await executeAiTool(fnName, tool.function.arguments, toolCtx)
              console.log(`[ai] Executed tool "${fnName}" in room ${toolCtx.groupId}:`, toolOutput)
            } catch (err: unknown) {
              console.error(`[ai] Error executing tool "${fnName}":`, err)
              toolOutput = JSON.stringify({
                success: false,
                error: 'execution_exception',
                message: err instanceof Error ? err.message : String(err),
              })
            }
            indicator.finishTool()
          }

          // Feedback loop: inject tool output back into conversation history
          messages.push({
            role: 'tool',
            tool_call_id: tool.id,
            name: fnName,
            content: toolOutput,
          })
        }

        indicator.setThinking()
        continue
      }

      // No tool calls requested: stream final response
      let streamedResponse = ''
      try {
        streamedResponse = await streamMistral(
          messages,
          (delta) => {
            indicator.appendMarkdown(scrubDelta(delta))
          },
          // Hard brevity cap for chat replies; only lifted when the reply has to
          // lay out a search list or the queue.
          { temperature: REPLY_TEMPERATURE, maxTokens: sawListTool ? 400 : 90 },
        )
      } catch (streamErr) {
        console.warn('[ai] Streaming failed, falling back to message content', streamErr)
        streamedResponse = message.content ?? ''
      }

      const finalReply = humanizeReply(streamedResponse || message.content || 'Done!')
      appendTurn(user.id, 'user', userPrompt)
      appendTurn(user.id, 'assistant', finalReply)
      void updateMemoryAsync(user.id, userPrompt, finalReply)

      await indicator.finalize(finalReply, msg)
      return
    }

    // If max turns reached, finish with fallback
    const fallbackText = "I've processed your request."
    appendTurn(user.id, 'user', userPrompt)
    appendTurn(user.id, 'assistant', fallbackText)
    await indicator.finalize(fallbackText, msg)
  } catch (err: unknown) {
    console.error('[ai] Error in handleAiChat', err)
    const errText = err instanceof Error ? err.message : String(err)
    if (errText.includes('503') || errText.includes('high load') || errText.includes('Service temporarily unavailable')) {
      await indicator.finalize("The AI service is experiencing high load right now. Please try again in a few seconds.", msg)
    } else if (errText.includes('429')) {
      await indicator.finalize("Rate limit reached. Please wait a brief moment and try again.", msg)
    } else {
      await indicator.finalize("Sorry, I ran into a temporary issue processing your request. Please try again.", msg)
    }
  } finally {
    // Whatever path we leave by - normal finish, caught error, a throw in the
    // prelude, or a hung call that never returned - the shimmering draft must
    // not outlive this call.
    indicator.stop()
    if (activeIndicators.get(chatKey) === indicator) activeIndicators.delete(chatKey)
  }
}
