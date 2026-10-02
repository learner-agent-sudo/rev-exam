import type { BlockRow, QuestionRow } from '../db/db'
import type { CallStats, JsonCall } from '../gemini/generate'
import { chapterOf, studyPassages } from './sections'

// Exam-style questions written by Gemini from one slice ("chunk") of the book.
// Gemini cites passages by number; the app shows the stored passage text itself,
// so references are always the book's exact words (and Gemini never has to quote).
// A second call answers each question independently; disagreements are dropped.

export interface Chunk {
  key: string
  chapter: string
  blocks: BlockRow[]
  chars: number
}

// Free Gemini allowances are counted in requests per day (as few as ~20 for Flash models),
// so each request covers a large slice of the book and asks for many questions at once.
export const CHUNK_CHARS = 36000

/** Groups study passages into chapter-bounded slices of roughly `maxChars`. */
export function chunkBook(blocks: BlockRow[], maxChars = CHUNK_CHARS, minChars = 4000): Chunk[] {
  const chunks: Chunk[] = []
  let current: Chunk | null = null
  const close = () => {
    if (!current) return
    const prev = chunks[chunks.length - 1]
    // Fold a small tail into the previous slice of the same chapter.
    if (current.chars < minChars && prev && prev.chapter === current.chapter && prev.chars + current.chars <= maxChars * 1.3) {
      prev.blocks.push(...current.blocks)
      prev.chars += current.chars
    } else {
      chunks.push(current)
    }
    current = null
  }

  for (const block of studyPassages(blocks)) {
    if (block.text.length < 20) continue
    const chapter = chapterOf(block)
    if (current && (current.chapter !== chapter || current.chars + block.text.length > maxChars)) close()
    current ??= { key: '', chapter, blocks: [], chars: 0 }
    current.blocks.push(block)
    current.chars += block.text.length
  }
  close()
  for (const chunk of chunks) chunk.key = `${chunk.blocks[0].index}-${chunk.blocks[chunk.blocks.length - 1].index}`
  return chunks
}

/** About one question per 3,000 characters of text, between 2 and 12. */
export function questionsWanted(chunk: Chunk): number {
  return Math.min(12, Math.max(2, Math.round(chunk.chars / 3000)))
}

/** "120-188" → [120, 188]. */
function rangeOf(key: string): [number, number] | undefined {
  const m = /^(\d+)-(\d+)$/.exec(key)
  return m ? [Number(m[1]), Number(m[2])] : undefined
}

/**
 * Slices of the book still without AI questions. Passages inside a slice that already has
 * questions are left out first, so changing the slice size never asks Gemini twice.
 */
export function pendingChunks(blocks: BlockRow[], doneKeys: Iterable<string>): Chunk[] {
  const done = [...doneKeys].map(rangeOf).filter((r): r is [number, number] => !!r)
  const remaining = blocks.filter((b) => !done.some(([from, to]) => b.index >= from && b.index <= to))
  return chunkBook(remaining)
}

const SYSTEM =
  'You are an expert writer of certification exam questions for the IAPP CIPP/US ' +
  '(Certified Information Privacy Professional / United States) exam. You write questions only ' +
  'from the textbook passages you are given, and you never rely on outside knowledge.'

function passageList(chunk: Chunk): string {
  return chunk.blocks.map((b) => `[P${b.index}] ${b.text}`).join('\n\n')
}

const QUESTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          stem: { type: 'STRING' },
          options: { type: 'ARRAY', items: { type: 'STRING' } },
          correctIndex: { type: 'INTEGER' },
          explanations: { type: 'ARRAY', items: { type: 'STRING' } },
          sourcePassages: { type: 'ARRAY', items: { type: 'INTEGER' } },
        },
        required: ['stem', 'options', 'correctIndex', 'explanations', 'sourcePassages'],
      },
    },
  },
  required: ['questions'],
}

const CHECK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    checks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          question: { type: 'INTEGER' },
          answer: { type: 'INTEGER' },
          ambiguous: { type: 'BOOLEAN' },
          reason: { type: 'STRING' },
        },
        required: ['question', 'answer', 'ambiguous'],
      },
    },
  },
  required: ['checks'],
}

export function questionPrompt(bookTitle: string, chunk: Chunk, count: number): string {
  return `Textbook: ${bookTitle}
Section: ${chunk.chapter}

Passages (each begins with its ID):

${passageList(chunk)}

Write ${count} multiple-choice questions that test understanding of these passages, in the style of the CIPP/US exam.

Rules:
1. Every question must be answerable from these passages alone. Do not ask about anything the passages do not state.
2. Prefer applied questions: short workplace or consumer scenarios, "Which of the following...", "What is the BEST...". Include some direct knowledge questions too.
3. Exactly 4 options and exactly one correct answer. Wrong options must be plausible (for example other laws, agencies, requirements or time periods) but clearly wrong according to the passages.
4. Never use "All of the above", "None of the above" or "Both A and B". Do not put letters like "A)" in the options.
5. Write each question as a standalone exam question; do not mention "the passage" or "the text".
6. correctIndex: the position (0 to 3) of the correct option.
7. explanations: one short sentence per option, in the same order as the options, saying why it is correct or incorrect according to the passages.
8. sourcePassages: the ID numbers (for example 812 for [P812]) of the passages that support the correct answer.
9. Do not copy long stretches of the passages word for word.

Answer as JSON: {"questions": [{"stem", "options", "correctIndex", "explanations", "sourcePassages"}]}`
}

export interface Draft {
  stem: string
  options: string[]
  correctIndex: number
  explanations: string[]
  sourcePassages: number[]
}

const BANNED_OPTION = /^(?:all|none) of the above$|^both [a-d] and [a-d]$/i

/** Keeps only well-formed drafts that cite passages from this chunk. */
export function validateDrafts(raw: unknown, chunk: Chunk): Draft[] {
  const list = (raw as { questions?: unknown })?.questions
  if (!Array.isArray(list)) return []
  const indexes = new Set(chunk.blocks.map((b) => b.index))
  const drafts: Draft[] = []
  for (const item of list) {
    const q = item as Partial<Draft>
    if (typeof q.stem !== 'string' || !q.stem.trim()) continue
    if (!Array.isArray(q.options) || q.options.length !== 4) continue
    const options = q.options.map((o) => String(o).replace(/^\s*[A-D][).:]\s+/, '').trim())
    if (options.some((o) => !o || BANNED_OPTION.test(o))) continue
    if (new Set(options.map((o) => o.toLowerCase())).size !== 4) continue
    if (!Number.isInteger(q.correctIndex) || q.correctIndex! < 0 || q.correctIndex! > 3) continue
    const sources = (Array.isArray(q.sourcePassages) ? q.sourcePassages : [])
      .map((n) => Number(String(n).replace(/^P/i, '')))
      .filter((n) => indexes.has(n))
    if (!sources.length) continue
    const explanations =
      Array.isArray(q.explanations) && q.explanations.length === 4 ? q.explanations.map((e) => String(e).trim()) : []
    drafts.push({ stem: q.stem.trim(), options, correctIndex: q.correctIndex!, explanations, sourcePassages: [...new Set(sources)] })
  }
  return drafts
}

export function checkPrompt(chunk: Chunk, drafts: Draft[]): string {
  const questions = drafts
    .map((d, i) => `${i + 1}. ${d.stem}\n${d.options.map((o, j) => `   ${j}) ${o}`).join('\n')}`)
    .join('\n\n')
  return `Answer each multiple-choice question below using ONLY these textbook passages.

Passages:

${passageList(chunk)}

Questions:

${questions}

For each question give:
- question: its number
- answer: the number (0 to 3) of the correct option, or -1 if the passages do not settle it
- ambiguous: true if more than one option could reasonably be correct, or the question is unclear
- reason: one short sentence

Answer as JSON: {"checks": [{"question", "answer", "ambiguous", "reason"}]}`
}

/** Keeps drafts the independent check answered the same way, without doubts. */
export function applyCheck(drafts: Draft[], raw: unknown): { kept: Draft[]; dropped: number } {
  const checks = (raw as { checks?: { question?: number; answer?: number; ambiguous?: boolean }[] })?.checks ?? []
  const kept = drafts.filter((draft, i) => {
    const check = checks.find((c) => Number(c.question) === i + 1)
    return !!check && Number(check.answer) === draft.correctIndex && check.ambiguous !== true
  })
  return { kept, dropped: drafts.length - kept.length }
}

export interface ChunkResult {
  questions: QuestionRow[]
  dropped: number
}

/** The two requests made for each part of the book. */
export type Step = 'write' | 'check'

export interface StepHooks {
  onStep?: (step: Step) => void
  onStats?: (step: Step, stats: CallStats) => void
  onRequest?: () => void
}

export async function generateForChunk(
  options: {
    call: JsonCall
    apiKey: string
    model: string
    bookId: string
    bookTitle: string
    chunk: Chunk
    now?: number
  } & StepHooks,
): Promise<ChunkResult> {
  const { call, apiKey, model, bookId, bookTitle, chunk, now = Date.now(), onStep, onStats, onRequest } = options
  const count = questionsWanted(chunk)
  onStep?.('write')
  const raw = await call({
    apiKey,
    model,
    system: SYSTEM,
    prompt: questionPrompt(bookTitle, chunk, count),
    schema: QUESTION_SCHEMA,
    onStats: (stats) => onStats?.('write', stats),
    onSent: onRequest,
  })
  const drafts = validateDrafts(raw, chunk)
  const rejected = Math.max(0, count - drafts.length)
  if (!drafts.length) return { questions: [], dropped: rejected }

  onStep?.('check')
  const check = await call({
    apiKey,
    model,
    system: SYSTEM,
    prompt: checkPrompt(chunk, drafts),
    schema: CHECK_SCHEMA,
    temperature: 0,
    onStats: (stats) => onStats?.('check', stats),
    onSent: onRequest,
  })
  const { kept, dropped } = applyCheck(drafts, check)
  return {
    dropped: rejected + dropped,
    questions: kept.map((d) => ({
      id: `ai-${crypto.randomUUID()}`,
      bookId,
      source: 'ai',
      stem: d.stem,
      options: d.options,
      answer: d.correctIndex,
      ...(d.explanations.length ? { explanations: d.explanations } : {}),
      blockIndexes: d.sourcePassages,
      chapter: chunk.chapter,
      chunk: chunk.key,
      model,
      createdAt: now,
    })),
  }
}
