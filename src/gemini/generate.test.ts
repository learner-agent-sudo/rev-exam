import { describe, expect, it, vi } from 'vitest'
import { generateJson, parseJsonText } from './generate'
import { GeminiError, toGeminiError } from './models'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const answer = (text: string, finishReason = 'STOP') => json({ candidates: [{ content: { parts: [{ text }] }, finishReason }] })
const request = { apiKey: 'k', model: 'gemini-x-flash', system: 'sys', prompt: 'hello', schema: { type: 'OBJECT' } }

describe('generateJson', () => {
  it('posts the prompt with the key in a header and parses the JSON answer', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(answer('{"ok": true}'))
    await expect(generateJson(request, fetchFn)).resolves.toEqual({ ok: true })

    const [url, init] = fetchFn.mock.calls[0]
    expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x-flash:generateContent')
    expect(init?.headers).toMatchObject({ 'x-goog-api-key': 'k' })
    const body = JSON.parse(String(init?.body))
    expect(body.systemInstruction.parts[0].text).toBe('sys')
    expect(body.contents[0].parts[0].text).toBe('hello')
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' } })
  })

  it('ignores thought parts and tolerates fenced JSON', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      json({ candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: '```json\n{"a":1}\n```' }] } }] }),
    )
    await expect(generateJson(request, fetchFn)).resolves.toEqual({ a: 1 })
  })

  it('retries once without the schema when the model rejects it', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ error: { code: 400, message: 'Invalid JSON payload: unknown field responseSchema' } }, 400))
      .mockResolvedValueOnce(answer('{"a":2}'))
    await expect(generateJson(request, fetchFn)).resolves.toEqual({ a: 2 })
    expect(JSON.parse(String(fetchFn.mock.calls[1][1]?.body)).generationConfig.responseSchema).toBeUndefined()
  })

  it('reports refusals, empty answers and unreadable output', async () => {
    const refuse = vi.fn<typeof fetch>().mockResolvedValue(json({ candidates: [{ finishReason: 'RECITATION' }] }))
    await expect(generateJson(request, refuse)).rejects.toMatchObject({ kind: 'blocked' })

    const blocked = vi.fn<typeof fetch>().mockResolvedValue(json({ promptFeedback: { blockReason: 'SAFETY' } }))
    await expect(generateJson(request, blocked)).rejects.toMatchObject({ kind: 'blocked' })

    const cut = vi.fn<typeof fetch>().mockResolvedValue(answer('{"questions": [{"stem": "unfinished', 'MAX_TOKENS'))
    await expect(generateJson(request, cut)).rejects.toMatchObject({ kind: 'bad-output' })
  })

  it('reports network failures', async () => {
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(generateJson(request, offline)).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('rate limit details', () => {
  it('reads the suggested wait and spots daily limits', async () => {
    const perMinute = await toGeminiError(
      json({ error: { code: 429, message: 'Quota', details: [{ '@type': 'RetryInfo', retryDelay: '31s' }] } }, 429),
    )
    expect(perMinute).toMatchObject({ kind: 'rate-limit', retryAfterMs: 31000, daily: false })

    const perDay = await toGeminiError(
      json(
        {
          error: {
            code: 429,
            message: 'Quota',
            details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }],
          },
        },
        429,
      ),
    )
    expect(perDay).toMatchObject({ kind: 'rate-limit', daily: true })
    expect(perDay.message).toContain('continue tomorrow')
  })
})

describe('parseJsonText', () => {
  it('throws a readable error for non-JSON', () => {
    expect(() => parseJsonText('no json here')).toThrow(GeminiError)
  })
})
