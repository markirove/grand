import { config } from '../../config.js'
import { withRotatedKey, aiKeyManager } from './aiKeyManager.js'

export { aiKeyManager }

export interface MistralToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface MistralMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  name?: string
  tool_call_id?: string
  tool_calls?: MistralToolCall[] | null
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

export interface MistralChatResponse {
  id: string
  choices: {
    index: number
    finish_reason: 'stop' | 'tool_calls' | 'length'
    message: {
      role: 'assistant'
      content: string | null
      tool_calls: MistralToolCall[] | null
    }
  }[]
}

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions'

export interface CallMistralOpts {
  signal?: AbortSignal
  model?: string
  tool_choice?: 'auto' | 'any' | 'none' | { type: 'function'; function: { name: string } }
  timeoutMs?: number
  /** Sampling temperature. Lower = more deterministic / less hallucination. */
  temperature?: number
}

export async function callMistral(
  messages: MistralMessage[],
  tools?: ToolDefinition[],
  opts: CallMistralOpts = {},
): Promise<MistralChatResponse> {
  const model = opts.model ?? config.ai.model
  const timeoutMs = opts.timeoutMs ?? 25000

  const body: Record<string, unknown> = {
    model,
    messages,
  }

  if (opts.temperature != null) {
    body.temperature = opts.temperature
  }

  if (tools && tools.length > 0) {
    body.tools = tools
    if (opts.tool_choice) {
      body.tool_choice = opts.tool_choice
    }
  }

  const maxRetries = 2
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutTimer = setTimeout(() => controller.abort(new Error('Mistral request timed out')), timeoutMs)

      if (opts.signal) {
        opts.signal.addEventListener('abort', () => controller.abort(opts.signal?.reason))
      }

      const result = await withRotatedKey(async (apiKey) => {
        try {
          const res = await fetch(MISTRAL_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          })

          if (!res.ok) {
            const errText = await res.text().catch(() => '')
            const errorObj: any = new Error(`Mistral API returned ${res.status}: ${errText}`)
            errorObj.status = res.status
            const retryAfterHeader = res.headers.get('retry-after')
            if (retryAfterHeader) {
              errorObj.retryAfter = parseInt(retryAfterHeader, 10)
            }
            throw errorObj
          }

          return (await res.json()) as MistralChatResponse
        } finally {
          clearTimeout(timeoutTimer)
        }
      })

      return result
    } catch (err: unknown) {
      lastError = err
      const status = (err as any)?.status
      const isRetryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || (err instanceof Error && err.name === 'AbortError')

      if (attempt < maxRetries && isRetryable) {
        const backoff = Math.min(1000 * Math.pow(2, attempt), 3000)
        await new Promise((r) => setTimeout(r, backoff))
        continue
      }
      break
    }
  }

  throw lastError
}

export async function streamMistral(
  messages: MistralMessage[],
  onChunk: (delta: string) => void,
  opts: { signal?: AbortSignal; model?: string; temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const model = opts.model ?? config.ai.model

  return withRotatedKey(async (apiKey) => {
    const res = await fetch(MISTRAL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens != null ? { max_tokens: opts.maxTokens } : {}),
      }),
      signal: opts.signal,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      const errorObj: any = new Error(`Mistral streaming API returned ${res.status}: ${errText}`)
      errorObj.status = res.status
      const retryAfterHeader = res.headers.get('retry-after')
      if (retryAfterHeader) {
        errorObj.retryAfter = parseInt(retryAfterHeader, 10)
      }
      throw errorObj
    }

    const reader = res.body?.getReader()
    if (!reader) {
      throw new Error('Failed to open response stream from Mistral API')
    }

    const decoder = new TextDecoder('utf-8')
    let accumulated = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const dataStr = trimmed.slice(5).trim()
        if (dataStr === '[DONE]') continue

        try {
          const json = JSON.parse(dataStr)
          const delta = json.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta) {
            accumulated += delta
            onChunk(delta)
          }
        } catch {
          // partial chunk or keep-alive comment
        }
      }
    }

    return accumulated
  })
}
