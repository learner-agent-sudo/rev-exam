export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export interface GeminiModel {
  id: string
  displayName: string
  description?: string
}

export type GeminiErrorKind = 'invalid-key' | 'forbidden' | 'rate-limit' | 'network' | 'server' | 'unknown'

export class GeminiError extends Error {
  readonly kind: GeminiErrorKind

  constructor(kind: GeminiErrorKind, message: string) {
    super(message)
    this.name = 'GeminiError'
    this.kind = kind
  }
}

interface ApiModel {
  name: string
  displayName?: string
  description?: string
  supportedGenerationMethods?: string[]
}

interface ApiErrorBody {
  error?: {
    code?: number
    message?: string
    status?: string
    details?: { reason?: string }[]
  }
}

export async function toGeminiError(response: Response): Promise<GeminiError> {
  let body: ApiErrorBody = {}
  try {
    body = await response.json()
  } catch {
    // Non-JSON error body: fall back to the HTTP status alone.
  }
  const message = body.error?.message ?? `HTTP ${response.status}`
  const reasons = body.error?.details?.map((d) => d.reason) ?? []

  if (reasons.includes('API_KEY_INVALID') || (response.status === 400 && /api key/i.test(message))) {
    return new GeminiError('invalid-key', 'Google rejected this API key. Check that you copied the whole key.')
  }
  if (response.status === 401 || response.status === 403) {
    return new GeminiError('forbidden', `This key is not allowed to use the Gemini API: ${message}`)
  }
  if (response.status === 429) {
    return new GeminiError('rate-limit', 'Too many requests for now (free-tier limit). Try again later.')
  }
  if (response.status >= 500) {
    return new GeminiError('server', `Gemini is having problems right now: ${message}`)
  }
  return new GeminiError('unknown', message)
}

/** Lists the models this key can use for text generation. */
export async function listModels(apiKey: string, fetchFn: typeof fetch = fetch): Promise<GeminiModel[]> {
  const models: GeminiModel[] = []
  let pageToken: string | undefined

  do {
    const url = new URL(`${GEMINI_API_BASE}/models`)
    url.searchParams.set('pageSize', '1000')
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    let response: Response
    try {
      response = await fetchFn(url, { headers: { 'x-goog-api-key': apiKey } })
    } catch {
      throw new GeminiError('network', 'Could not reach Google. Check your internet connection.')
    }
    if (!response.ok) throw await toGeminiError(response)

    const data = (await response.json()) as { models?: ApiModel[]; nextPageToken?: string }
    for (const m of data.models ?? []) {
      if (!m.supportedGenerationMethods?.includes('generateContent')) continue
      const id = m.name.replace(/^models\//, '')
      models.push({ id, displayName: m.displayName ?? id, description: m.description })
    }
    pageToken = data.nextPageToken || undefined
  } while (pageToken)

  return models
}

// Model names change often, so rather than hard-coding one we pick the newest
// general-purpose "Flash" model the key can actually use.
const SPECIALISED = /lite|image|tts|audio|live|embed|robotics|computer-use/

function versionOf(id: string): number {
  const match = /gemini-(\d+(?:\.\d+)?)/.exec(id)
  return match ? Number(match[1]) : 0
}

function isPreview(id: string): boolean {
  return /preview|exp/.test(id)
}

export function pickDefaultModel(models: GeminiModel[]): string | undefined {
  const flash = models.filter((m) => m.id.includes('flash') && !SPECIALISED.test(m.id))
  const ranked = [...flash].sort(
    (a, b) =>
      versionOf(b.id) - versionOf(a.id) ||
      Number(isPreview(a.id)) - Number(isPreview(b.id)) ||
      a.id.length - b.id.length,
  )
  return ranked[0]?.id ?? models.find((m) => m.id.includes('flash'))?.id ?? models[0]?.id
}
