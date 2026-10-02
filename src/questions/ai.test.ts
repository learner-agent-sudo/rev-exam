import { describe, expect, it, vi } from 'vitest'
import type { BlockRow } from '../db/db'
import type { JsonCall } from '../gemini/generate'
import { applyCheck, chunkBook, generateForChunk, pendingChunks, questionsWanted, validateDrafts, type Chunk } from './ai'

const block = (index: number, chapter: string, chars = 1000, kind: BlockRow['kind'] = 'paragraph'): BlockRow => ({
  bookId: 'b',
  index,
  kind,
  path: [chapter],
  text: (`block ${index} ` + 'x'.repeat(chars)).slice(0, chars),
})

describe('chunkBook', () => {
  it('splits by chapter and size, skipping headings and back matter', () => {
    const blocks = [
      block(0, 'Chapter 1', 30, 'heading'),
      block(1, 'Chapter 1', 6000),
      block(2, 'Chapter 1', 6000),
      block(3, 'Chapter 1', 6000),
      block(4, 'Chapter 1', 6000),
      block(5, 'Chapter 1', 1000),
      block(6, 'Chapter 2', 3000),
      block(7, 'Index', 3000),
    ]
    const chunks = chunkBook(blocks, 12000, 1500)
    expect(chunks.map((c) => [c.key, c.chapter, c.chars])).toEqual([
      ['1-2', 'Chapter 1', 12000],
      // Block 5 does not fit in 3-4, but alone it is too small, so it joins that slice.
      ['3-5', 'Chapter 1', 13000],
      ['6-6', 'Chapter 2', 3000],
    ])
  })

  it('asks for more questions from longer slices', () => {
    const chunk = (chars: number) => ({ chars }) as Chunk
    expect([1000, 5000, 10000, 30000, 60000].map((c) => questionsWanted(chunk(c)))).toEqual([2, 2, 3, 10, 12])
  })
})

const chunk: Chunk = { key: '10-11', chapter: 'Chapter 2. Enforcement', chars: 400, blocks: [block(10, 'Chapter 2. Enforcement', 200), block(11, 'Chapter 2. Enforcement', 200)] }

const good = {
  stem: 'Which agency brings actions against deceptive practices?',
  options: ['A) FTC', 'HHS', 'FCC', 'SEC'],
  correctIndex: 0,
  explanations: ['Correct.', 'Health.', 'Communications.', 'Securities.'],
  sourcePassages: [10],
}

describe('pendingChunks', () => {
  const blocks = [1, 2, 3, 4, 5, 6].map((i) => block(i, 'Chapter 1', 10000))

  it('leaves out passages already covered, even by slices of an older size', () => {
    // Questions exist for 1-2 (an old, smaller slice) and 5-5.
    const chunks = pendingChunks(blocks, ['1-2', '5-5'])
    expect(chunks.flatMap((c) => c.blocks.map((b) => b.index))).toEqual([3, 4, 6])
  })

  it('makes large slices so each request covers more of the book', () => {
    expect(pendingChunks(blocks, []).map((c) => c.key)).toEqual(['1-3', '4-6'])
  })
})

describe('validateDrafts', () => {
  it('keeps well-formed questions and tidies option letters', () => {
    expect(validateDrafts({ questions: [good] }, chunk)).toEqual([{ ...good, options: ['FTC', 'HHS', 'FCC', 'SEC'] }])
  })

  it('accepts passage ids written as "P10"', () => {
    expect(validateDrafts({ questions: [{ ...good, sourcePassages: ['P11'] }] }, chunk)[0].sourcePassages).toEqual([11])
  })

  it.each([
    ['three options', { options: ['a', 'b', 'c'] }],
    ['duplicate options', { options: ['FTC', 'ftc', 'FCC', 'SEC'] }],
    ['"all of the above"', { options: ['FTC', 'HHS', 'FCC', 'All of the above'] }],
    ['bad answer index', { correctIndex: 4 }],
    ['passage from elsewhere', { sourcePassages: [99] }],
    ['no stem', { stem: ' ' }],
  ])('drops %s', (_, change) => {
    expect(validateDrafts({ questions: [{ ...good, ...change }] }, chunk)).toEqual([])
  })

  it('survives garbage', () => {
    expect(validateDrafts(null, chunk)).toEqual([])
    expect(validateDrafts({ questions: 'nope' }, chunk)).toEqual([])
  })
})

describe('applyCheck', () => {
  const drafts = validateDrafts({ questions: [good, { ...good, stem: 'Second?' }, { ...good, stem: 'Third?' }] }, chunk)

  it('keeps only questions answered the same way without doubts', () => {
    const { kept, dropped } = applyCheck(drafts, {
      checks: [
        { question: 1, answer: 0, ambiguous: false },
        { question: 2, answer: 2, ambiguous: false },
        { question: 3, answer: 0, ambiguous: true },
      ],
    })
    expect(kept.map((d) => d.stem)).toEqual([good.stem])
    expect(dropped).toBe(2)
  })

  it('drops questions the check skipped', () => {
    expect(applyCheck(drafts, { checks: [] }).kept).toEqual([])
  })
})

describe('generateForChunk', () => {
  it('writes, checks and stores questions that point at the book passages', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({ questions: [good, { ...good, stem: 'Bad one?', options: ['a', 'b', 'c'] }] })
      .mockResolvedValueOnce({ checks: [{ question: 1, answer: 0, ambiguous: false }] })
    const result = await generateForChunk({
      call: call as unknown as JsonCall,
      apiKey: 'k',
      model: 'm',
      bookId: 'b',
      bookTitle: 'Handbook',
      chunk,
      now: 5,
    })

    expect(result.dropped).toBe(1)
    expect(result.questions).toHaveLength(1)
    expect(result.questions[0]).toMatchObject({
      bookId: 'b',
      source: 'ai',
      answer: 0,
      options: ['FTC', 'HHS', 'FCC', 'SEC'],
      blockIndexes: [10],
      chapter: 'Chapter 2. Enforcement',
      chunk: '10-11',
      model: 'm',
      createdAt: 5,
    })
    const prompt = call.mock.calls[0][0].prompt as string
    expect(prompt).toContain('[P10]')
    expect(prompt).toContain('Write 2 multiple-choice questions')
    expect(call.mock.calls[1][0].prompt).toContain('0) FTC')
  })

  it('skips the check when nothing usable came back', async () => {
    const call = vi.fn().mockResolvedValueOnce({ questions: [] })
    const result = await generateForChunk({ call: call as unknown as JsonCall, apiKey: 'k', model: 'm', bookId: 'b', bookTitle: 't', chunk })
    expect(result).toEqual({ questions: [], dropped: 2 })
    expect(call).toHaveBeenCalledTimes(1)
  })
})
