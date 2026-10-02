import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { RevExamDB, type AttemptRow, type BlockRow, type BookRow, type QuestionRow } from '../db/db'
import { flagQuestion } from '../questions/store'
import { exportData, mergeData, readTransferFile, transferBlob, transferFileName, TRANSFER_FORMAT, type TransferData } from './transfer'

const open: RevExamDB[] = []
const device = (name: string) => {
  const database = new RevExamDB(`transfer-${name}-${open.length}`)
  open.push(database)
  return database
}
afterEach(async () => {
  await Promise.all(open.splice(0).map((d) => d.delete()))
})

const book = (id = 'book1', blockCount = 3): BookRow => ({
  id,
  title: `Handbook ${id}`,
  fileName: 'handbook.epub',
  importedAt: 1,
  blockCount,
  passageCount: blockCount - 1,
  hasPageNumbers: false,
  toc: [],
})

const blocks = (bookId = 'book1', count = 3): BlockRow[] =>
  Array.from({ length: count }, (_, index) => ({
    bookId,
    index,
    kind: index ? 'paragraph' : 'heading',
    path: ['Chapter 1'],
    text: `Passage ${index}`,
  }))

const question = (id: string, extra: Partial<QuestionRow> = {}): QuestionRow => ({
  id,
  bookId: 'book1',
  source: 'ai',
  stem: `${id}?`,
  options: ['a', 'b', 'c', 'd'],
  answer: 0,
  blockIndexes: [1],
  chapter: 'Chapter 1',
  createdAt: 10,
  ...extra,
})

const attempt = (id: string, questionId: string, at: number): AttemptRow => ({
  id,
  questionId,
  bookId: 'book1',
  chosen: 0,
  correct: true,
  at,
})

async function setUpLaptop() {
  const laptop = device('laptop')
  await laptop.books.add(book())
  await laptop.blocks.bulkAdd(blocks())
  await laptop.questions.bulkAdd([question('ai1'), question('ai2'), question('c1', { source: 'cloze', style: 'define' })])
  await laptop.attempts.add(attempt('t1', 'ai1', 50))
  await laptop.settings.put({ key: 'geminiApiKey', value: 'secret-key' })
  return laptop
}

/** Saves a file on one device and loads it on another, as a person would. */
async function move(from: RevExamDB, to: RevExamDB) {
  const file = await transferBlob(await exportData(from))
  return mergeData(await readTransferFile(file), to)
}

describe('moving to another device', () => {
  it('copies the book, questions and answers, but not the API key', async () => {
    const laptop = await setUpLaptop()
    const file = await transferBlob(await exportData(laptop))
    expect(file.type).toBe('application/gzip')
    expect(await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text()).not.toContain('secret-key')

    const phone = device('phone')
    expect(await mergeData(await readTransferFile(file), phone)).toEqual({
      booksAdded: ['Handbook book1'],
      booksIncomplete: [],
      questionsAdded: 3,
      questionsUpdated: 0,
      questionsRemoved: 0,
      attemptsAdded: 1,
    })
    expect(await phone.books.toArray()).toEqual(await laptop.books.toArray())
    expect(await phone.blocks.toArray()).toEqual(await laptop.blocks.toArray())
    expect(await phone.questions.toArray()).toEqual(await laptop.questions.toArray())
    expect(await phone.attempts.toArray()).toEqual(await laptop.attempts.toArray())
    expect(await phone.settings.count()).toBe(0)
  })

  it('finds nothing new when the same file is loaded twice', async () => {
    const laptop = await setUpLaptop()
    const phone = device('phone')
    await move(laptop, phone)
    expect(await move(laptop, phone)).toMatchObject({ booksAdded: [], questionsAdded: 0, questionsUpdated: 0, attemptsAdded: 0 })
  })

  it('brings answers and flags back the other way, newest flag winning', async () => {
    const laptop = await setUpLaptop()
    const phone = device('phone')
    await move(laptop, phone)

    // Practice on the phone; meanwhile the laptop makes more questions and flags one.
    await phone.attempts.bulkAdd([attempt('t2', 'ai2', 60), attempt('t3', 'c1', 70)])
    await flagQuestion('ai1', true, phone, 100)
    await flagQuestion('ai2', true, phone, 100)
    await flagQuestion('ai2', true, laptop, 90)
    await flagQuestion('ai2', false, laptop, 120)
    await laptop.questions.add(question('ai3', { createdAt: 80 }))

    expect(await move(phone, laptop)).toMatchObject({ questionsAdded: 0, questionsUpdated: 1, attemptsAdded: 2 })
    expect((await laptop.attempts.toArray()).map((a) => a.id).sort()).toEqual(['t1', 't2', 't3'])
    expect(await laptop.questions.get('ai1')).toMatchObject({ flagged: true, flaggedAt: 100 })
    // Unflagged on the laptop after the phone flagged it.
    expect(await laptop.questions.get('ai2')).toMatchObject({ flagged: false, flaggedAt: 120 })

    expect(await move(laptop, phone)).toMatchObject({ questionsAdded: 1, questionsUpdated: 1, attemptsAdded: 0 })
    expect(await phone.questions.toArray()).toEqual(await laptop.questions.toArray())
  })

  it('replaces an older concept-check set and never brings removed ones back', async () => {
    const laptop = await setUpLaptop()
    const phone = device('phone')
    await move(laptop, phone)

    // The laptop refreshes its concept checks: c1 gets a new wording, c2 is new; the phone flags c1.
    await laptop.questions.bulkPut([
      question('c1', { source: 'cloze', style: 'define', stem: 'Better?', createdAt: 200 }),
      question('c2', { source: 'cloze', style: 'term', createdAt: 200 }),
    ])
    await phone.questions.add(question('old', { source: 'cloze', createdAt: 5 }))
    await flagQuestion('c1', true, phone, 150)

    expect(await move(laptop, phone)).toMatchObject({ questionsAdded: 1, questionsUpdated: 1, questionsRemoved: 1 })
    expect(await phone.questions.get('c1')).toMatchObject({ stem: 'Better?', createdAt: 200, flagged: true, flaggedAt: 150 })
    expect(await phone.questions.get('old')).toBeUndefined()

    // Loading an old file from before the refresh: its concept set is older, so nothing is restored.
    const before = device('before')
    await before.books.add(book())
    await before.blocks.bulkAdd(blocks())
    await before.questions.bulkAdd([question('c1', { source: 'cloze' }), question('gone', { source: 'cloze' })])
    expect(await move(before, phone)).toMatchObject({ questionsAdded: 0, questionsRemoved: 0 })
    expect(await phone.questions.get('gone')).toBeUndefined()
    expect(await phone.questions.get('c1')).toMatchObject({ stem: 'Better?' })
  })

  it('leaves out a book whose passages are missing, with its questions', async () => {
    const data: TransferData = {
      app: 'rev-exam',
      format: TRANSFER_FORMAT,
      exportedAt: 0,
      books: [book('book1', 3)],
      blocks: blocks('book1', 2),
      questions: [question('q1')],
      attempts: [attempt('t1', 'q1', 1)],
    }
    const phone = device('phone')
    expect(await mergeData(data, phone)).toMatchObject({ booksAdded: [], booksIncomplete: ['Handbook book1'], questionsAdded: 0, attemptsAdded: 0 })
    expect(await phone.questions.count()).toBe(0)
    expect(await phone.blocks.count()).toBe(0)
  })
})

describe('reading a transfer file', () => {
  const valid = (): TransferData => ({
    app: 'rev-exam',
    format: TRANSFER_FORMAT,
    exportedAt: 0,
    books: [book()],
    blocks: blocks(),
    questions: [question('q1')],
    attempts: [],
  })
  const fileOf = (value: unknown) => new Blob([typeof value === 'string' ? value : JSON.stringify(value)])

  it('opens uncompressed files too', async () => {
    expect(await readTransferFile(fileOf(valid()))).toEqual(valid())
  })

  it.each([
    ['not JSON', 'PK\u0003\u0004 an EPUB perhaps', /not a Rev Exam transfer file/],
    ['other JSON', { hello: 'world' }, /not a Rev Exam transfer file/],
    ['a newer format', { ...valid(), format: TRANSFER_FORMAT + 1 }, /newer version of Rev Exam/],
    ['a missing table', { ...valid(), attempts: undefined }, /incomplete or damaged/],
    ['a broken row', { ...valid(), questions: [{ id: 'q1' }] }, /incomplete or damaged/],
  ])('refuses %s', async (_, content, message) => {
    await expect(readTransferFile(fileOf(content))).rejects.toThrow(message)
  })

  it('refuses a damaged compressed file', async () => {
    const packed = new Uint8Array(await (await transferBlob(valid())).arrayBuffer())
    await expect(readTransferFile(new Blob([packed.slice(0, packed.length / 2)]))).rejects.toThrow(/incomplete or damaged/)
  })

  it('names files by local date and time', () => {
    const when = new Date(2026, 9, 2, 15, 7)
    expect(transferFileName(new Blob([], { type: 'application/gzip' }), when)).toBe('rev-exam-2026-10-02-1507.json.gz')
    expect(transferFileName(new Blob([], { type: 'application/json' }), when)).toBe('rev-exam-2026-10-02-1507.json')
  })
})
