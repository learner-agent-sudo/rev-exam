import { describe, expect, it, vi } from 'vitest'
import { GeminiError, listModels, pickDefaultModel, type GeminiModel } from './models'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const model = (id: string): GeminiModel => ({ id, displayName: id })

describe('pickDefaultModel', () => {
  it('prefers the newest general-purpose flash model', () => {
    const models = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-flash', 'gemini-3.1-flash-lite', 'gemini-3-flash-image'].map(model)
    expect(pickDefaultModel(models)).toBe('gemini-3-flash')
  })

  it('prefers a stable model over a preview of the same version', () => {
    const models = ['gemini-3-flash-preview-09-2026', 'gemini-3-flash'].map(model)
    expect(pickDefaultModel(models)).toBe('gemini-3-flash')
  })

  it('falls back when there is no suitable flash model', () => {
    expect(pickDefaultModel(['gemini-3.1-flash-lite'].map(model))).toBe('gemini-3.1-flash-lite')
    expect(pickDefaultModel(['gemini-2.5-pro'].map(model))).toBe('gemini-2.5-pro')
    expect(pickDefaultModel([])).toBeUndefined()
  })
})

describe('listModels', () => {
  it('sends the key in a header, follows pages and keeps only text models', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          models: [
            { name: 'models/gemini-3-flash', displayName: 'Gemini 3 Flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          ],
          nextPageToken: 'page2',
        }),
      )
      .mockResolvedValueOnce(
        json({ models: [{ name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent', 'countTokens'] }] }),
      )

    const models = await listModels('my-key', fetchFn)

    expect(models.map((m) => m.id)).toEqual(['gemini-3-flash', 'gemini-2.5-pro'])
    expect(models[0].displayName).toBe('Gemini 3 Flash')
    const [firstUrl, firstInit] = fetchFn.mock.calls[0]
    expect(String(firstUrl)).not.toContain('my-key')
    expect(firstInit?.headers).toEqual({ 'x-goog-api-key': 'my-key' })
    expect(String(fetchFn.mock.calls[1][0])).toContain('pageToken=page2')
  })

  it.each([
    [400, { error: { code: 400, message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } }, 'invalid-key'],
    [403, { error: { code: 403, message: 'Permission denied' } }, 'forbidden'],
    [429, { error: { code: 429, message: 'Quota exceeded' } }, 'rate-limit'],
    [503, { error: { code: 503, message: 'Unavailable' } }, 'server'],
    [404, { error: { code: 404, message: 'Not found' } }, 'unknown'],
  ])('maps HTTP %i to %s', async (status, body, kind) => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(body, status))
    await expect(listModels('k', fetchFn)).rejects.toMatchObject({ kind })
  })

  it('reports network failures', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))
    const error = await listModels('k', fetchFn).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GeminiError)
    expect(error).toMatchObject({ kind: 'network' })
  })
})
