import { db, type AttemptRow, type BlockRow, type QuestionRow, type QuestionSource, type RevExamDB } from '../db/db'
import { shuffle } from './random'

export async function saveQuestions(rows: QuestionRow[], database: RevExamDB = db): Promise<void> {
  await database.questions.bulkPut(rows)
}

/**
 * Stores a fresh set of no-AI concept questions for a book. Their ids are stable,
 * so answer history survives; questions no longer produced are removed.
 */
export async function replaceClozeQuestions(bookId: string, rows: QuestionRow[], database: RevExamDB = db) {
  const keep = new Set(rows.map((r) => r.id))
  await database.transaction('rw', database.questions, async () => {
    const existing = await database.questions.where('[bookId+source]').equals([bookId, 'cloze']).toArray()
    const flagged = new Set(existing.filter((q) => q.flagged).map((q) => q.id))
    await database.questions.bulkDelete(existing.filter((q) => !keep.has(q.id)).map((q) => q.id))
    await database.questions.bulkPut(rows.map((r) => (flagged.has(r.id) ? { ...r, flagged: true } : r)))
  })
}

export interface BankStats {
  ai: number
  cloze: number
  flagged: number
  /** No-AI questions from the old fill-in-the-blank generator, replaced on the next refresh. */
  legacy: number
  /** Chapters in book order with how many usable questions of each kind they have. */
  chapters: { chapter: string; ai: number; cloze: number }[]
  /** Chunk keys that already have AI questions, so generation can skip them. */
  doneChunks: Set<string>
}

export async function bankStats(bookId: string, database: RevExamDB = db): Promise<BankStats> {
  const questions = await database.questions.where('bookId').equals(bookId).toArray()
  const stats: BankStats = { ai: 0, cloze: 0, flagged: 0, legacy: 0, chapters: [], doneChunks: new Set() }
  const byChapter = new Map<string, { chapter: string; ai: number; cloze: number; first: number }>()
  for (const q of questions) {
    if (q.chunk) stats.doneChunks.add(q.chunk)
    if (q.source === 'cloze' && !q.style) stats.legacy++
    if (q.flagged) {
      stats.flagged++
      continue
    }
    stats[q.source]++
    const entry = byChapter.get(q.chapter) ?? { chapter: q.chapter, ai: 0, cloze: 0, first: Infinity }
    entry[q.source]++
    entry.first = Math.min(entry.first, ...q.blockIndexes)
    byChapter.set(q.chapter, entry)
  }
  stats.chapters = [...byChapter.values()].sort((a, b) => a.first - b.first).map(({ chapter, ai, cloze }) => ({ chapter, ai, cloze }))
  return stats
}

export async function flagQuestion(id: string, flagged = true, database: RevExamDB = db): Promise<void> {
  await database.questions.update(id, { flagged })
}

export async function recordAttempt(question: QuestionRow, chosen: number, database: RevExamDB = db): Promise<AttemptRow> {
  const attempt: AttemptRow = {
    id: crypto.randomUUID(),
    questionId: question.id,
    bookId: question.bookId,
    chosen,
    correct: chosen === question.answer,
    at: Date.now(),
  }
  await database.attempts.add(attempt)
  return attempt
}

export type SourceFilter = QuestionSource | 'all'

export interface SessionOptions {
  bookId: string
  source: SourceFilter
  /** Only this chapter; empty for the whole book. */
  chapter?: string
  size: number
}

/**
 * Picks questions for a practice session: ones never answered first, then ones
 * last answered wrongly, then the rest, longest-ago first.
 */
export async function pickSession(options: SessionOptions, database: RevExamDB = db, random = Math.random): Promise<QuestionRow[]> {
  const { bookId, source, chapter, size } = options
  const pool = (await database.questions.where('bookId').equals(bookId).toArray()).filter(
    (q) => !q.flagged && (source === 'all' || q.source === source) && (!chapter || q.chapter === chapter),
  )
  const attempts = await database.attempts.where('bookId').equals(bookId).toArray()
  const last = new Map<string, AttemptRow>()
  for (const a of attempts) {
    const prev = last.get(a.questionId)
    if (!prev || a.at > prev.at) last.set(a.questionId, a)
  }
  const unseen = shuffle(pool.filter((q) => !last.has(q.id)), random)
  const wrong = shuffle(pool.filter((q) => last.get(q.id)?.correct === false), random)
  const rest = pool
    .filter((q) => last.get(q.id)?.correct === true)
    .sort((a, b) => last.get(a.id)!.at - last.get(b.id)!.at)
  return [...unseen, ...wrong, ...rest].slice(0, size)
}

export async function loadPassages(bookId: string, indexes: number[], database: RevExamDB = db): Promise<BlockRow[]> {
  const rows = await database.blocks.bulkGet(indexes.map((i) => [bookId, i] as [string, number]))
  return rows.filter((r): r is BlockRow => !!r)
}
