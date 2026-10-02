import { db, type AttemptRow, type BlockRow, type BookRow, type QuestionRow, type RevExamDB } from '../db/db'

// Moving study data between devices with a file: save it on one, load it on the other.
// Loading merges, so nothing on the receiving device is lost and answers from both are kept.

/** Raised when the file layout changes; an app refuses files newer than it understands. */
export const TRANSFER_FORMAT = 1

export interface TransferData {
  app: 'rev-exam'
  format: number
  exportedAt: number
  books: BookRow[]
  blocks: BlockRow[]
  questions: QuestionRow[]
  attempts: AttemptRow[]
}

export class TransferError extends Error {}

const NOT_OURS = 'This is not a Rev Exam transfer file. Choose the file made with “Save transfer file”.'
const DAMAGED = 'The file is incomplete or damaged. Save it again on the other device and move it across once more.'
const TOO_NEW =
  'This file was saved by a newer version of Rev Exam. Update the app on this device first (close and reopen it, then press “Update” if asked).'

/** Everything needed to study on another device. The Gemini key and other settings stay on this one. */
export async function exportData(database: RevExamDB = db, now = Date.now()): Promise<TransferData> {
  const tables = [database.books, database.blocks, database.questions, database.attempts]
  return database.transaction('r', tables, async () => ({
    app: 'rev-exam' as const,
    format: TRANSFER_FORMAT,
    exportedAt: now,
    books: await database.books.toArray(),
    blocks: await database.blocks.toArray(),
    questions: await database.questions.toArray(),
    attempts: await database.attempts.toArray(),
  }))
}

/** The file to save: gzip-compressed JSON where the browser can compress (about a fifth of the size). */
export async function transferBlob(data: TransferData): Promise<Blob> {
  const json = new Blob([JSON.stringify(data)], { type: 'application/json' })
  if (typeof CompressionStream === 'undefined') return json
  const packed = await new Response(json.stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
  return new Blob([packed], { type: 'application/gzip' })
}

/** "rev-exam-2026-10-02-1530.json.gz", in local time so the newest file is easy to spot. */
export function transferFileName(blob: Blob, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `rev-exam-${stamp}.json${blob.type === 'application/gzip' ? '.gz' : ''}`
}

/** Reads a saved file, compressed or not, and checks it before anything is stored. */
export async function readTransferFile(file: Blob): Promise<TransferData> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  let text: string
  if (head[0] === 0x1f && head[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') {
      throw new TransferError('This browser cannot open compressed files. Update Chrome and try again.')
    }
    try {
      text = await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text()
    } catch {
      throw new TransferError(DAMAGED)
    }
  } else {
    text = await file.text()
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new TransferError(NOT_OURS)
  }
  return checkTransfer(data)
}

type Shape = Record<string, 'string' | 'number' | 'array'>

const SHAPES: Record<'books' | 'blocks' | 'questions' | 'attempts', Shape> = {
  books: { id: 'string', title: 'string', blockCount: 'number', toc: 'array' },
  blocks: { bookId: 'string', index: 'number', text: 'string', path: 'array' },
  questions: { id: 'string', bookId: 'string', source: 'string', stem: 'string', options: 'array', answer: 'number', blockIndexes: 'array', createdAt: 'number' },
  attempts: { id: 'string', questionId: 'string', bookId: 'string', at: 'number' },
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function fits(row: unknown, shape: Shape): boolean {
  if (!isRecord(row)) return false
  return Object.entries(shape).every(([key, type]) => (type === 'array' ? Array.isArray(row[key]) : typeof row[key] === type))
}

export function checkTransfer(data: unknown): TransferData {
  if (!isRecord(data) || data.app !== 'rev-exam' || typeof data.format !== 'number') throw new TransferError(NOT_OURS)
  if (data.format > TRANSFER_FORMAT) throw new TransferError(TOO_NEW)
  for (const [table, shape] of Object.entries(SHAPES)) {
    const rows = data[table]
    if (!Array.isArray(rows) || !rows.every((row) => fits(row, shape))) throw new TransferError(DAMAGED)
  }
  return data as unknown as TransferData
}

export interface MergeSummary {
  /** Titles of books this device did not have. */
  booksAdded: string[]
  /** Books left out because the file did not hold all their passages. */
  booksIncomplete: string[]
  questionsAdded: number
  /** Questions changed by the file: a newer flag, or a newer concept-check version. */
  questionsUpdated: number
  /** Concept-check questions replaced by the newer set in the file. */
  questionsRemoved: number
  attemptsAdded: number
}

/** When a question's flag was last changed; flags set before this was recorded count as very old. */
const flagStamp = (q: QuestionRow) => q.flaggedAt ?? (q.flagged ? 1 : 0)

/** When the book's concept-check questions were made; they are made all at once. */
const conceptSetTime = (rows: QuestionRow[]) =>
  rows.reduce((newest, q) => (q.source === 'cloze' ? Math.max(newest, q.createdAt) : newest), -Infinity)

function mergeQuestion(here: QuestionRow, there: QuestionRow): QuestionRow {
  const content = there.createdAt > here.createdAt ? there : here
  const flag = flagStamp(there) > flagStamp(here) ? there : here
  const merged: QuestionRow = { ...content }
  delete merged.flagged
  delete merged.flaggedAt
  if (flag.flagged !== undefined) merged.flagged = flag.flagged
  if (flag.flaggedAt !== undefined) merged.flaggedAt = flag.flaggedAt
  return merged
}

/**
 * Adds what the file has and this device lacks. Books and their passages are added whole;
 * answers are added (they never change); for a question on both devices the newest flag wins.
 * Concept-check questions are rebuilt from the book as a set, so the newer set replaces the older.
 */
export async function mergeData(data: TransferData, database: RevExamDB = db): Promise<MergeSummary> {
  const summary: MergeSummary = {
    booksAdded: [],
    booksIncomplete: [],
    questionsAdded: 0,
    questionsUpdated: 0,
    questionsRemoved: 0,
    attemptsAdded: 0,
  }
  const tables = [database.books, database.blocks, database.questions, database.attempts]
  await database.transaction('rw', tables, async () => {
    const known = new Set(await database.books.toCollection().primaryKeys())

    const blocksByBook = groupBy(data.blocks, (b) => b.bookId)
    for (const book of data.books) {
      if (known.has(book.id)) continue
      const blocks = blocksByBook.get(book.id) ?? []
      // Missing passages would make the references point at the wrong text, so such a book is left out.
      if (blocks.length !== book.blockCount || new Set(blocks.map((b) => b.index)).size !== blocks.length) {
        summary.booksIncomplete.push(book.title)
        continue
      }
      await database.books.add(book)
      await database.blocks.bulkAdd(blocks)
      known.add(book.id)
      summary.booksAdded.push(book.title)
    }

    for (const [bookId, incoming] of groupBy(data.questions, (q) => q.bookId)) {
      if (!known.has(bookId)) continue
      const local = await database.questions.where('bookId').equals(bookId).toArray()
      const localById = new Map(local.map((q) => [q.id, q]))
      const newerConcepts = conceptSetTime(incoming) > conceptSetTime(local)
      const put: QuestionRow[] = []
      for (const there of incoming) {
        const here = localById.get(there.id)
        if (!here) {
          // A concept-check question from an older set was dropped here on purpose.
          if (there.source === 'cloze' && !newerConcepts) continue
          put.push(there)
          summary.questionsAdded++
        } else if (there.createdAt > here.createdAt || flagStamp(there) > flagStamp(here)) {
          put.push(mergeQuestion(here, there))
          summary.questionsUpdated++
        }
      }
      if (newerConcepts) {
        const keep = new Set(incoming.map((q) => q.id))
        const stale = local.filter((q) => q.source === 'cloze' && !keep.has(q.id)).map((q) => q.id)
        await database.questions.bulkDelete(stale)
        summary.questionsRemoved += stale.length
      }
      await database.questions.bulkPut(put)
    }

    const attempts = [...new Map(data.attempts.filter((a) => known.has(a.bookId)).map((a) => [a.id, a])).values()]
    const existing = await database.attempts.bulkGet(attempts.map((a) => a.id))
    const fresh = attempts.filter((_, i) => !existing[i])
    await database.attempts.bulkAdd(fresh)
    summary.attemptsAdded = fresh.length
  })
  return summary
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    const group = groups.get(k)
    if (group) group.push(row)
    else groups.set(k, [row])
  }
  return groups
}
