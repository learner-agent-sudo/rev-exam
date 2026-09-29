import { describe, expect, it, vi } from 'vitest'
import type { QuestionRow } from '../db/db'
import { GeminiError } from '../gemini/models'
import type { Chunk } from './ai'
import { runGeneration, type JobProgress, type RunDeps } from './job'

const chunks = ['a', 'b', 'c'].map((key) => ({ key, chapter: `Chapter ${key}`, blocks: [], chars: 0 }) as Chunk)
const question = (id: string) => ({ id }) as QuestionRow

function deps(generate: RunDeps['generate'], stopAfter = Infinity) {
  const updates: Partial<JobProgress>[] = []
  const saved: QuestionRow[] = []
  const sleeps: number[] = []
  let calls = 0
  const d: RunDeps = {
    generate: (c) => {
      calls++
      return generate(c)
    },
    save: async (rows) => void saved.push(...rows),
    sleep: async (ms) => void sleeps.push(ms),
    stopped: () => calls >= stopAfter,
    update: (p) => void updates.push(p),
  }
  return { d, updates, saved, sleeps, last: () => Object.assign({}, ...updates) as JobProgress }
}

describe('runGeneration', () => {
  it('saves questions chunk by chunk and reports totals', async () => {
    const { d, saved, last } = deps(async (c) => ({ questions: [question(c.key)], dropped: 1 }))
    expect(await runGeneration(chunks, d)).toBe('done')
    expect(saved.map((q) => q.id)).toEqual(['a', 'b', 'c'])
    expect(last()).toMatchObject({ status: 'done', chunksDone: 3, kept: 3, dropped: 3, skipped: 0 })
  })

  it('waits out short rate limits, then carries on', async () => {
    const generate = vi
      .fn<RunDeps['generate']>()
      .mockRejectedValueOnce(new GeminiError('rate-limit', 'slow down', { retryAfterMs: 31000 }))
      .mockResolvedValue({ questions: [question('x')], dropped: 0 })
    const { d, sleeps, updates } = deps(generate)
    expect(await runGeneration(chunks.slice(0, 1), d)).toBe('done')
    expect(sleeps).toEqual([31000])
    expect(updates.some((u) => u.status === 'waiting' && u.message?.includes('31 seconds'))).toBe(true)
  })

  it('stops at the daily limit, keeping what was made', async () => {
    const generate = vi
      .fn<RunDeps['generate']>()
      .mockResolvedValueOnce({ questions: [question('a')], dropped: 0 })
      .mockRejectedValueOnce(new GeminiError('rate-limit', "Today's free Gemini limit is used up.", { daily: true }))
    const { d, saved, last } = deps(generate)
    expect(await runGeneration(chunks, d)).toBe('error')
    expect(saved).toHaveLength(1)
    expect(last()).toMatchObject({ status: 'error', kept: 1, chunksDone: 1 })
    expect(last().message).toContain('limit is used up')
  })

  it('skips parts Gemini declines and retries server errors', async () => {
    const generate = vi
      .fn<RunDeps['generate']>()
      .mockRejectedValueOnce(new GeminiError('blocked', 'declined'))
      .mockRejectedValueOnce(new GeminiError('server', 'oops'))
      .mockResolvedValue({ questions: [question('ok')], dropped: 0 })
    const { d, sleeps, last } = deps(generate)
    expect(await runGeneration(chunks.slice(0, 2), d)).toBe('done')
    expect(sleeps).toEqual([5000])
    expect(last()).toMatchObject({ kept: 1, skipped: 1, chunksDone: 2 })
  })

  it('stops for problems retrying cannot fix', async () => {
    const { d, last } = deps(async () => {
      throw new GeminiError('invalid-key', 'Google rejected this API key.')
    })
    expect(await runGeneration(chunks, d)).toBe('error')
    expect(last().message).toBe('Google rejected this API key.')
  })

  it('stops when asked', async () => {
    const { d, saved } = deps(async (c) => ({ questions: [question(c.key)], dropped: 0 }), 1)
    expect(await runGeneration(chunks, d)).toBe('stopped')
    expect(saved.map((q) => q.id)).toEqual(['a'])
  })
})
