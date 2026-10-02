export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export interface GeminiModel {
  id: string
  displayName: string
  description?: string
}

export type GeminiErrorKind =
  | 'invalid-key'
  | 'forbidden'
  | 'rate-limit'
  | 'network'
  | 'server'
  /** Gemini declined to answer (safety or recitation filters). */
  | 'blocked'
  /** Gemini answered, but not in the expected format. */
  | 'bad-output'
  | 'unknown'

export class GeminiError extends Error {
  readonly kind: GeminiErrorKind
  readonly status?: number
  /** For rate limits: how long Google asked us to wait. */
  readonly retryAfterMs?: number
  /** For rate limits: the daily quota is used up, so waiting minutes will not help. */
  readonly daily?: boolean

  constructor(kind: GeminiErrorKind, message: string, extra: { status?: number; retryAfterMs?: number; daily?: boolean } = {}) {
    super(message)
    this.name = 'GeminiError'
    this.kind = kind
    this.status = extra.status
    this.retryAfterMs = extra.retryAfterMs
    this.daily = extra.daily
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
    details?: { reason?: string; retryDelay?: string; violations?: { quotaId?: string }[] }[]
  }
}

export async function toGeminiError(response: Response): Promise<GeminiError> {
  let body: ApiErrorBody = {}
  try {
    body = await response.json()
  } catch {
    // Non-JSON error body: fall back to the HTTP status alone.
  }
  const status = response.status
  const message = body.error?.message ?? `HTTP ${status}`
  const details = body.error?.details ?? []
  const reasons = details.map((d) => d.reason)

  if (reasons.includes('API_KEY_INVALID') || (status === 400 && /api key/i.test(message))) {
    return new GeminiError('invalid-key', 'Google rejected this API key. Check that you copied the whole key.', { status })
  }
  if (status === 401 || status === 403) {
    return new GeminiError('forbidden', `This key is not allowed to use the Gemini API: ${message}`, { status })
  }
  if (status === 429) {
    const delay = details.find((d) => d.retryDelay)?.retryDelay
    const seconds = delay ? Number.parseFloat(delay) : NaN
    const quotaIds = details.flatMap((d) => d.violations ?? []).map((v) => v.quotaId ?? '')
    const retryAfterMs = Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : undefined
    // A per-day quota, or a wait so long that only tomorrow will help.
    const daily =
      quotaIds.some((id) => /per ?day/i.test(id)) ||
      /per[ _-]?day|daily/i.test(message) ||
      (retryAfterMs !== undefined && retryAfterMs > 10 * 60_000)
    return new GeminiError(
      'rate-limit',
      daily
        ? "Today's free Gemini limit is used up. Finished parts are saved; continue tomorrow."
        : 'Too many requests for now (free-tier limit).',
      { status, daily, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) },
    )
  }
  if (status >= 500) {
    return new GeminiError('server', `Gemini is having problems right now: ${message}`, { status })
  }
  return new GeminiError('unknown', message, { status })
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

/** The Gemini version in a model id: "gemini-2.5-flash" → 2.5; 0 when there is none. */
export function versionOf(id: string): number {
  const match = /gemini-(\d+(?:\.\d+)?)/.exec(id)
  return match ? Number(match[1]) : 0
}

function isPreview(id: string): boolean {
  return /preview|exp/.test(id)
}

const NOT_FOR_TEXT = /image|tts|audio|live|embed|robotics|computer-use|gemma|-latest|exp|pro/

/**
 * Models to use, in order: the preferred one, then the other free text models, newest
 * Flash-Lite first. Each model has its own free daily allowance (Flash-Lite's is much
 * larger), so when one runs out the next can carry on.
 */
export function fallbackModels(models: GeminiModel[], preferred: string): string[] {
  const usable = models
    .map((m) => m.id)
    .filter((id) => id.includes('flash') && !NOT_FOR_TEXT.test(id) && id !== preferred)
  const lite = usable.filter((id) => id.includes('lite'))
  const flash = usable.filter((id) => !id.includes('lite'))
  const newestFirst = (a: string, b: string) =>
    versionOf(b) - versionOf(a) || Number(isPreview(a)) - Number(isPreview(b)) || a.length - b.length
  return [preferred, ...lite.sort(newestFirst), ...flash.sort(newestFirst)]
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
