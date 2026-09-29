// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { deleteBook } from '../book/store'
import { RevExamDB, type QuestionRow } from '../db/db'
import { seededRandom } from './random'
import { bankStats, flagQuestion, pickSession, recordAttempt, replaceClozeQuestions, saveQuestions } from './store'

let database: RevExamDB
afterEach(async () => {
  await database.delete()
})

const q = (id: string, extra: Partial<QuestionRow> = {}): QuestionRow => ({
  id,
  bookId: 'b',
  source: 'ai',
  stem: `${id}?`,
  options: ['w', 'x', 'y', 'z'],
  answer: 1,
  blockIndexes: [Number(id.replace(/\D/g, '')) || 0],
  chapter: 'Ch 1',
  createdAt: 0,
  ...extra,
})

describe('question store', () => {
  it('counts questions by kind and chapter, in book order', async () => {
    database = new RevExamDB('q-stats')
    await saveQuestions(
      [
        q('q1', { chapter: 'Ch 2', blockIndexes: [50], chunk: '40-60' }),
        q('q2', { chapter: 'Ch 1', blockIndexes: [5], source: 'cloze' }),
        q('q3', { chapter: 'Ch 1', blockIndexes: [6], flagged: true }),
      ],
      database,
    )
    const stats = await bankStats('b', database)
    expect(stats).toMatchObject({ ai: 1, cloze: 1, flagged: 1 })
    expect(stats.chapters).toEqual([
      { chapter: 'Ch 1', ai: 0, cloze: 1 },
      { chapter: 'Ch 2', ai: 1, cloze: 0 },
    ])
    expect([...stats.doneChunks]).toEqual(['40-60'])
  })

  it('replaces fill-in-the-blank questions but keeps flags on the ones that remain', async () => {
    database = new RevExamDB('q-replace')
    await saveQuestions([q('c1', { source: 'cloze' }), q('c2', { source: 'cloze' }), q('a1')], database)
    await flagQuestion('c1', true, database)
    await replaceClozeQuestions('b', [q('c1', { source: 'cloze' }), q('c3', { source: 'cloze' })], database)
    const all = await database.questions.toArray()
    expect(all.map((x) => [x.id, !!x.flagged]).sort()).toEqual([
      ['a1', false],
      ['c1', true],
      ['c3', false],
    ])
  })

  it('practises new questions first, then mistakes, then the rest', async () => {
    database = new RevExamDB('q-session')
    const rows = [q('q1'), q('q2'), q('q3'), q('q4', { source: 'cloze' }), q('q5', { chapter: 'Ch 2' }), q('q6', { flagged: true })]
    await saveQuestions(rows, database)
    await recordAttempt(rows[0], 1, database) // right
    await recordAttempt(rows[1], 0, database) // wrong

    const session = await pickSession({ bookId: 'b', source: 'all', size: 10 }, database, seededRandom(1))
    const ids = session.map((s) => s.id)
    expect(ids.slice(0, 3).sort()).toEqual(['q3', 'q4', 'q5'])
    expect(ids.slice(3)).toEqual(['q2', 'q1'])

    expect((await pickSession({ bookId: 'b', source: 'cloze', size: 10 }, database)).map((s) => s.id)).toEqual(['q4'])
    expect((await pickSession({ bookId: 'b', source: 'all', chapter: 'Ch 2', size: 10 }, database)).map((s) => s.id)).toEqual(['q5'])
    expect(await pickSession({ bookId: 'b', source: 'all', size: 2 }, database)).toHaveLength(2)
  })

  it('records answers as separate entries', async () => {
    database = new RevExamDB('q-attempts')
    const row = q('q1')
    const first = await recordAttempt(row, 1, database)
    const second = await recordAttempt(row, 2, database)
    expect([first.correct, second.correct]).toEqual([true, false])
    expect(await database.attempts.count()).toBe(2)
  })

  it('deleting a book removes its questions and answers', async () => {
    database = new RevExamDB('q-delete')
    await database.books.add({ id: 'b', title: 't', fileName: 'f', importedAt: 0, blockCount: 0, passageCount: 0, hasPageNumbers: false, toc: [] })
    await saveQuestions([q('q1')], database)
    await recordAttempt(q('q1'), 1, database)
    await deleteBook('b', database)
    expect(await database.questions.count()).toBe(0)
    expect(await database.attempts.count()).toBe(0)
  })
})
