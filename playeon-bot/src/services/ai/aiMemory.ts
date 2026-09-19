import { callMistral } from './mistralClient.js'
import { collections } from '../mongo.js'

export interface ChatMessageTurn {
  role: 'user' | 'assistant'
  content: string
}

// In-memory turns buffer per userId (up to 8 messages / 4 turns)
const recentTurns = new Map<number, ChatMessageTurn[]>()
const MAX_TURNS = 8

export function getRecentTurns(userId: number): ChatMessageTurn[] {
  return recentTurns.get(userId) ?? []
}

export function appendTurn(userId: number, role: 'user' | 'assistant', content: string): void {
  const turns = recentTurns.get(userId) ?? []
  turns.push({ role, content })
  while (turns.length > MAX_TURNS) {
    turns.shift()
  }
  recentTurns.set(userId, turns)
}

// In-memory cache for user memory data
export interface CachedMemory {
  summary: string
  memories: string[]
}

const memoryCache = new Map<number, CachedMemory>()
const MAX_MEMORIES_PER_USER = 15
/** Two facts overlapping at or above this share of the smaller one's words are "the same fact". */
const MERGE_SIMILARITY = 0.6

export async function getUserMemoryData(userId: number): Promise<CachedMemory> {
  if (memoryCache.has(userId)) {
    return memoryCache.get(userId)!
  }

  try {
    if (collections.userMemories) {
      const doc = await collections.userMemories.findOne({ userId })
      if (doc) {
        const data: CachedMemory = {
          summary: doc.summary || '',
          memories: sanitizeList(
            Array.isArray(doc.memories) ? doc.memories : doc.summary ? [doc.summary] : [],
          ),
        }
        memoryCache.set(userId, data)
        return data
      }
    }
  } catch {
    // Non-critical fallback
  }

  const initial: CachedMemory = { summary: '', memories: [] }
  memoryCache.set(userId, initial)
  return initial
}

export async function saveUserMemoryData(userId: number, data: CachedMemory): Promise<void> {
  const clean: CachedMemory = {
    memories: sanitizeList(data.memories),
    summary: '',
  }
  clean.summary = clean.memories.join('; ')
  memoryCache.set(userId, clean)

  try {
    if (collections.userMemories) {
      await collections.userMemories.updateOne(
        { userId },
        { $set: { summary: clean.summary, memories: clean.memories, updatedAt: new Date() } },
        { upsert: true },
      )
    }
  } catch {
    // Non-critical
  }
}

// ---------------------------------------------------------------------------
// Similarity + normalisation helpers (deterministic, no model call)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'likes', 'like', 'loves', 'love', 'enjoys', 'enjoy',
  'prefers', 'prefer', 'user', 'they', 'their', 'them', 'some', 'song', 'songs',
  'music', 'track', 'tracks', 'listening', 'listen', 'into', 'a', 'an', 'of', 'to',
])

function tokenSet(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  )
}

/** Overlap coefficient: shared words / words in the shorter fact. 1 = one contains the other. */
function similarity(a: string, b: string): number {
  const A = tokenSet(a)
  const B = tokenSet(b)
  if (A.size === 0 || B.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / Math.min(A.size, B.size)
}

function cleanFact(raw: string): string {
  return raw
    .trim()
    .replace(/^[-•*\d.)\s]+/, '')
    .replace(/\s+/g, ' ')
    .replace(/^["']|["']$/g, '')
    .trim()
}

function sanitizeList(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const item of list) {
    const f = cleanFact(String(item ?? ''))
    if (f.length < 3 || f.length > 160) continue
    if (out.some((m) => similarity(m, f) >= MERGE_SIMILARITY)) continue
    out.push(f)
  }
  return out.slice(-MAX_MEMORIES_PER_USER)
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Add a fact, merging instead of piling up: if it strongly overlaps an existing
 * memory, the newer wording replaces the old one; otherwise it is appended and
 * the oldest is evicted once the cap is hit.
 */
export async function addUserMemory(userId: number, rawFact: string): Promise<string[]> {
  const fact = cleanFact(rawFact)
  const current = await getUserMemoryData(userId)
  if (fact.length < 3 || fact.length > 160) return current.memories

  const memories = [...current.memories]
  const dupIdx = memories.findIndex((m) => similarity(m, fact) >= MERGE_SIMILARITY)
  if (dupIdx >= 0) {
    if (memories[dupIdx] === fact) return memories
    memories[dupIdx] = fact
  } else {
    memories.push(fact)
  }
  while (memories.length > MAX_MEMORIES_PER_USER) memories.shift()

  await saveUserMemoryData(userId, { summary: '', memories })
  return memories
}

async function updateMemoryAt(userId: number, index1: number, rawFact: string): Promise<string[]> {
  const fact = cleanFact(rawFact)
  const current = await getUserMemoryData(userId)
  const memories = [...current.memories]
  if (index1 < 1 || index1 > memories.length || fact.length < 3) return memories
  memories[index1 - 1] = fact
  await saveUserMemoryData(userId, { summary: '', memories })
  return memories
}

async function removeMemoryAt(userId: number, index1: number): Promise<string[]> {
  const current = await getUserMemoryData(userId)
  const memories = [...current.memories]
  if (index1 < 1 || index1 > memories.length) return memories
  memories.splice(index1 - 1, 1)
  await saveUserMemoryData(userId, { summary: '', memories })
  return memories
}

/**
 * Delete a memory by 1-based index or by keyword. Keyword deletion only fires on
 * a whole-word match (or a near-identical phrase) so "jazz" cannot wipe an
 * unrelated entry that merely contains the substring.
 */
export async function deleteUserMemory(
  userId: number,
  target: string,
): Promise<{ deleted: boolean; remaining: string[] }> {
  const current = await getUserMemoryData(userId)
  const query = target.trim()
  if (!query) return { deleted: false, remaining: current.memories }

  if (/^\d+[.)]?$/.test(query)) {
    const num = parseInt(query, 10)
    if (num >= 1 && num <= current.memories.length) {
      const remaining = current.memories.filter((_, i) => i + 1 !== num)
      await saveUserMemoryData(userId, { summary: '', memories: remaining })
      return { deleted: true, remaining }
    }
  }

  const q = query.toLowerCase()
  const qWords = new Set(q.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean))
  let removed = false
  const remaining = current.memories.filter((m) => {
    const ml = m.toLowerCase()
    const mWords = ml.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
    const wordHit = [...qWords].every((w) => mWords.includes(w)) && qWords.size > 0
    const phraseHit = similarity(m, query) >= 0.7
    if (wordHit || phraseHit) {
      removed = true
      return false
    }
    return true
  })
  if (removed) await saveUserMemoryData(userId, { summary: '', memories: remaining })
  return { deleted: removed, remaining }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getUserSummary(userId: number): Promise<string | null> {
  const data = await getUserMemoryData(userId)
  if (!data.memories || data.memories.length === 0) return null
  return data.memories.map((m) => `• ${m}`).join('\n')
}

// ---------------------------------------------------------------------------
// Background maintenance
// ---------------------------------------------------------------------------

/** Cheap gate: a bare command reveals nothing durable, so don't spend a call on it. */
function worthAnalysing(userMessage: string): boolean {
  const t = userMessage.trim()
  if (t.length < 4) return false
  if (/(i['’ ]?m |i am |my |i |we |favou?rite|prefer|always|never|hate|can['’]?t stand|love|really into|remember|forget)/i.test(t)) {
    return true
  }
  // Short pure-command messages ("play x", "skip", "pause", "queue y") carry no taste signal.
  const words = t.split(/\s+/)
  if (words.length <= 4 && /^(play|skip|next|pause|resume|stop|queue|seek|jump|loop|repeat|clear|end|link|room|status|mode|theme|hi|hey|yo|hello|thanks|thx|ok|okay|k|cool|nice)\b/i.test(t)) {
    return false
  }
  return words.length >= 5
}

const OP_RE = /\{[\s\S]*\}/

/**
 * After each exchange, let the model decide whether the user's durable music
 * taste / habits / identity changed, and apply exactly one edit. Op-based so it
 * can refine or retract an existing memory, not only pile on new ones.
 */
export async function updateMemoryAsync(
  userId: number,
  userMessage: string,
  assistantResponse: string,
): Promise<void> {
  try {
    if (!worthAnalysing(userMessage)) return

    const current = await getUserMemoryData(userId)
    const numbered = current.memories.length
      ? current.memories.map((m, i) => `${i + 1}. ${m}`).join('\n')
      : '(none yet)'

    const prompt = `You keep a small long-term memory of a music-app user's durable tastes, habits, and personal facts. Decide if this exchange changes it, then output ONE edit.

Current memory:
${numbered}

User said: "${userMessage}"
Assistant replied: "${assistantResponse}"

Reply with ONE JSON object and nothing else:
{"op":"none"} - nothing durable revealed, or already covered.
{"op":"add","fact":"..."} - a genuinely new durable fact (<= 12 words, e.g. "Loves 2000s R&B", "Studies to lofi", "Dislikes country").
{"op":"update","target":<number>,"fact":"..."} - correct or refine that numbered memory.
{"op":"remove","target":<number>} - the user retracted that numbered memory.

Rules: only durable preferences/habits/identity. Never store a one-off song request, the current track, or mood-of-the-moment. Prefer "update" over "add" when it's the same topic as an existing memory.`

    const res = await callMistral([{ role: 'user', content: prompt }], undefined, { temperature: 0.1 })
    const raw = res.choices?.[0]?.message?.content?.trim() ?? ''
    const match = raw.match(OP_RE)
    if (!match) return

    let op: { op?: string; fact?: string; target?: number }
    try {
      op = JSON.parse(match[0])
    } catch {
      return
    }

    if (op.op === 'add' && op.fact) {
      await addUserMemory(userId, op.fact)
    } else if (op.op === 'update' && typeof op.target === 'number' && op.fact) {
      await updateMemoryAt(userId, op.target, op.fact)
    } else if (op.op === 'remove' && typeof op.target === 'number') {
      await removeMemoryAt(userId, op.target)
    }
  } catch (err) {
    console.warn('[ai] Memory auto-update skipped:', err instanceof Error ? err.message : err)
  }
}
