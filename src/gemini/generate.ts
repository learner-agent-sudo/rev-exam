import { GEMINI_API_BASE, GeminiError, toGeminiError, versionOf } from './models'

/** Timing and token counts for one request, for the troubleshooting log. */
export interface CallStats {
  ms: number
  promptTokens?: number
  outputTokens?: number
  thinkingTokens?: number
  /** True when the request had to be resent without the schema and thinking settings. */
  simplified: boolean
}

export interface JsonRequest {
  apiKey: string
  model: string
  system: string
  prompt: string
  /** Gemini response schema (OpenAPI subset). */
  schema?: object
  temperature?: number
  /** Give up on a request that takes longer than this (default 150 s). */
  timeoutMs?: number
  onStats?: (stats: CallStats) => void
}

/**
 * Newer Gemini models "think" before answering, at a high level by default, which makes
 * each request slow. Writing exam questions from a passage needs little of that.
 * Gemini 3+ takes a thinking level; 2.5 takes a token budget; sending the wrong one fails.
 */
export function thinkingFor(model: string): object | undefined {
  const version = versionOf(model)
  if (version >= 3) return { thinkingLevel: 'low' }
  if (version >= 2.5) return { thinkingBudget: /flash/.test(model) ? 0 : 128 }
  return undefined
}

export type JsonCall = <T>(request: JsonRequest) => Promise<T>

interface Candidate {
  content?: { parts?: { text?: string; thought?: boolean }[] }
  finishReason?: string
}

const REFUSALS = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'LANGUAGE'])

/** Reads JSON from model text, tolerating ```json fences or text around it. */
export function parseJsonText<T>(text: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T
      } catch {
        // Fall through to the error below.
      }
    }
    throw new GeminiError('bad-output', 'Gemini returned an answer that could not be read.')
  }
}

/** Calls generateContent and returns the parsed JSON answer. */
export async function generateJson<T>(request: JsonRequest, fetchFn: typeof fetch = fetch): Promise<T> {
  const started = Date.now()
  const timeoutMs = request.timeoutMs ?? 150_000
  const thinking = thinkingFor(request.model)

  const send = async (simple: boolean) => {
    const body = {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        ...(!simple && request.schema ? { responseSchema: request.schema } : {}),
        ...(!simple && thinking ? { thinkingConfig: thinking } : {}),
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: 8192,
      },
    }
    // A request that never answers must not stall the whole job.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchFn(`${GEMINI_API_BASE}/models/${encodeURIComponent(request.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': request.apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      // Reading the body can stall too, so it stays inside the time limit.
      const text = await response.text()
      return { response, text }
    } catch {
      if (controller.signal.aborted) {
        throw new GeminiError('server', `Gemini did not answer within ${Math.round(timeoutMs / 1000)} seconds.`)
      }
      throw new GeminiError('network', 'Could not reach Google. Check your internet connection.')
    } finally {
      clearTimeout(timer)
    }
  }
  const errorOf = (r: { response: Response; text: string }) =>
    toGeminiError(new Response(r.text, { status: r.response.status, headers: r.response.headers }))

  let simplified = false
  let reply = await send(false)
  if (!reply.response.ok) {
    const error = await errorOf(reply)
    // Some models reject the schema or thinking settings; the prompt also describes the format.
    if (error.kind !== 'unknown' || error.status !== 400 || (!request.schema && !thinking)) throw error
    simplified = true
    reply = await send(true)
    if (!reply.response.ok) throw await errorOf(reply)
  }

  let data: {
    candidates?: Candidate[]
    promptFeedback?: { blockReason?: string }
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
  }
  try {
    data = JSON.parse(reply.text)
  } catch {
    throw new GeminiError('bad-output', 'Gemini returned an answer that could not be read.')
  }
  request.onStats?.({
    ms: Date.now() - started,
    promptTokens: data.usageMetadata?.promptTokenCount,
    outputTokens: data.usageMetadata?.candidatesTokenCount,
    thinkingTokens: data.usageMetadata?.thoughtsTokenCount,
    simplified,
  })
  if (data.promptFeedback?.blockReason) {
    throw new GeminiError('blocked', `Gemini declined this part of the book (${data.promptFeedback.blockReason}).`)
  }
  const candidate = data.candidates?.[0]
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
  if (!text.trim()) {
    const reason = candidate?.finishReason ?? 'no answer'
    if (REFUSALS.has(reason)) throw new GeminiError('blocked', `Gemini declined this part of the book (${reason}).`)
    throw new GeminiError('bad-output', `Gemini returned an empty answer (${reason}).`)
  }
  return parseJsonText<T>(text)
}
