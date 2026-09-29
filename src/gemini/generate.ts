import { GEMINI_API_BASE, GeminiError, toGeminiError } from './models'

export interface JsonRequest {
  apiKey: string
  model: string
  system: string
  prompt: string
  /** Gemini response schema (OpenAPI subset). */
  schema?: object
  temperature?: number
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
  const send = async (withSchema: boolean) => {
    const body = {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        ...(withSchema && request.schema ? { responseSchema: request.schema } : {}),
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: 8192,
      },
    }
    try {
      return await fetchFn(`${GEMINI_API_BASE}/models/${encodeURIComponent(request.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': request.apiKey },
        body: JSON.stringify(body),
      })
    } catch {
      throw new GeminiError('network', 'Could not reach Google. Check your internet connection.')
    }
  }

  let response = await send(true)
  if (!response.ok) {
    const error = await toGeminiError(response)
    // Some models reject the response schema; the prompt also describes the format, so try without it.
    if (error.kind !== 'unknown' || error.status !== 400 || !request.schema) throw error
    response = await send(false)
    if (!response.ok) throw await toGeminiError(response)
  }

  const data = (await response.json()) as { candidates?: Candidate[]; promptFeedback?: { blockReason?: string } }
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
