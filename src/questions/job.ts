import { useSyncExternalStore } from 'react'
import { db, type BookRow, type QuestionRow } from '../db/db'
import { generateJson } from '../gemini/generate'
import { GeminiError } from '../gemini/models'
import { chunkBook, generateForChunk, type Chunk, type ChunkResult } from './ai'
import { bankStats, saveQuestions } from './store'

export type JobStatus = 'idle' | 'running' | 'waiting' | 'done' | 'stopped' | 'error'

export interface JobProgress {
  status: JobStatus
  bookId?: string
  chunksDone: number
  chunksTotal: number
  /** Questions that passed the check and were saved. */
  kept: number
  /** Questions the check (or format validation) threw away. */
  dropped: number
  /** Parts of the book Gemini declined or answered unreadably. */
  skipped: number
  chapter?: string
  message?: string
}

export interface RunDeps {
  generate: (chunk: Chunk) => Promise<ChunkResult>
  save: (rows: QuestionRow[]) => Promise<void>
  sleep: (ms: number) => Promise<void>
  stopped: () => boolean
  update: (progress: Partial<JobProgress>) => void
}

const MAX_RATE_WAITS = 8
const MAX_SERVER_RETRIES = 3

/**
 * Works through the chunks one by one, saving as it goes. Waits out short
 * rate limits, retries server hiccups, skips parts Gemini declines, and stops
 * on problems that retrying cannot fix (bad key, offline, daily limit).
 */
export async function runGeneration(chunks: Chunk[], deps: RunDeps): Promise<JobStatus> {
  let kept = 0
  let dropped = 0
  let skipped = 0
  for (const [i, chunk] of chunks.entries()) {
    if (deps.stopped()) return finish('stopped')
    deps.update({ status: 'running', chapter: chunk.chapter, message: undefined })
    let rateWaits = 0
    let serverRetries = 0
    for (;;) {
      try {
        const result = await deps.generate(chunk)
        await deps.save(result.questions)
        kept += result.questions.length
        dropped += result.dropped
        break
      } catch (error) {
        if (!(error instanceof GeminiError)) {
          deps.update({ status: 'error', message: `Something went wrong: ${String(error)}` })
          return 'error'
        }
        if (error.kind === 'rate-limit' && !error.daily && rateWaits < MAX_RATE_WAITS) {
          rateWaits++
          const wait = Math.min(Math.max(error.retryAfterMs ?? 30_000, 5_000), 120_000)
          deps.update({ status: 'waiting', message: `Free-tier limit reached; waiting ${Math.ceil(wait / 1000)} seconds…` })
          await deps.sleep(wait)
          if (deps.stopped()) return finish('stopped')
          deps.update({ status: 'running', message: undefined })
          continue
        }
        if (error.kind === 'server' && serverRetries < MAX_SERVER_RETRIES) {
          serverRetries++
          await deps.sleep(5_000 * serverRetries)
          if (deps.stopped()) return finish('stopped')
          continue
        }
        if (error.kind === 'blocked' || error.kind === 'bad-output' || error.kind === 'server') {
          skipped++
          break
        }
        deps.update({ status: 'error', message: error.message, kept, dropped, skipped })
        return 'error'
      }
    }
    deps.update({ chunksDone: i + 1, kept, dropped, skipped })
  }
  return finish('done')

  function finish(status: JobStatus): JobStatus {
    deps.update({ status, message: undefined, kept, dropped, skipped })
    return status
  }
}

// ---------- The one generation job the app runs at a time ----------

let progress: JobProgress = { status: 'idle', chunksDone: 0, chunksTotal: 0, kept: 0, dropped: 0, skipped: 0 }
const listeners = new Set<() => void>()
let stopRequested = false
const wakeSleepers = new Set<() => void>()

function update(patch: Partial<JobProgress>) {
  progress = { ...progress, ...patch }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useGenerationJob(): JobProgress {
  return useSyncExternalStore(subscribe, () => progress)
}

/** A wait that ends early when the user presses Stop. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      wakeSleepers.delete(done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    wakeSleepers.add(done)
  })
}

export function stopGeneration() {
  stopRequested = true
  wakeSleepers.forEach((wake) => wake())
}

export function isGenerating(p: JobProgress = progress): boolean {
  return p.status === 'running' || p.status === 'waiting'
}

/** Chunks of these chapters that do not have AI questions yet. */
export async function pendingChunks(bookId: string, chapters: string[]): Promise<Chunk[]> {
  const blocks = await db.blocks.where('bookId').equals(bookId).toArray()
  const { doneChunks } = await bankStats(bookId)
  return chunkBook(blocks).filter((c) => chapters.includes(c.chapter) && !doneChunks.has(c.key))
}

export async function startGeneration(options: { book: BookRow; chapters: string[]; apiKey: string; model: string }) {
  if (isGenerating()) return
  const { book, chapters, apiKey, model } = options
  stopRequested = false
  const chunks = await pendingChunks(book.id, chapters)
  update({ status: 'running', bookId: book.id, chunksDone: 0, chunksTotal: chunks.length, kept: 0, dropped: 0, skipped: 0, chapter: undefined, message: undefined })

  // Keep the screen on so the laptop does not sleep halfway through.
  const lock = await navigator.wakeLock?.request('screen').catch(() => null)
  try {
    await runGeneration(chunks, {
      generate: (chunk) => generateForChunk({ call: generateJson, apiKey, model, bookId: book.id, bookTitle: book.title, chunk }),
      save: (rows) => saveQuestions(rows),
      sleep,
      stopped: () => stopRequested,
      update,
    })
  } finally {
    await lock?.release().catch(() => undefined)
  }
}
