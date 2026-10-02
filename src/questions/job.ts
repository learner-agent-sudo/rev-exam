import { useSyncExternalStore } from 'react'
import { loadAllBlocks } from '../book/store'
import type { BookRow, QuestionRow } from '../db/db'
import { generateJson } from '../gemini/generate'
import { fallbackModels, GeminiError, listModels } from '../gemini/models'
import { markUsedUp, nextPacificReset, recordRequest, todayUsage } from '../gemini/quota'
import { generateForChunk, pendingChunks, type Chunk, type ChunkResult, type Step, type StepHooks } from './ai'
import type { CallStats } from '../gemini/generate'
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
  model?: string
  /** The request in progress, and when it started (for the live timer). */
  step?: Step
  stepStartedAt?: number
  startedAt?: number
  /** Average time per finished part, for the time-left estimate. */
  avgPartMs?: number
  /** What happened, newest last, for troubleshooting. */
  log: LogEntry[]
}

export interface LogEntry {
  at: number
  text: string
}

export interface RunDeps {
  generate: (chunk: Chunk, hooks: StepHooks) => Promise<ChunkResult>
  save: (rows: QuestionRow[]) => Promise<void>
  sleep: (ms: number) => Promise<void>
  stopped: () => boolean
  update: (progress: Partial<JobProgress>) => void
  now?: () => number
  /** On a used-up daily allowance: move to the next free model, if there is one. */
  nextModel?: () => { used: string; next?: string }
}

/** "3:00 PM" today, or "Fri 3:00 PM" when it is another day. */
export function resetTimeText(resetAt: number, now = Date.now()): string {
  const time = new Date(resetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const sameDay = new Date(resetAt).toDateString() === new Date(now).toDateString()
  return sameDay ? time : `${new Date(resetAt).toLocaleDateString([], { weekday: 'short' })} ${time}`
}

export function allUsedUpMessage(now = Date.now()): string {
  return `Today's free Gemini allowance is used up for every available model. Finished parts are saved; it resets at ${resetTimeText(nextPacificReset(now), now)} your time.`
}

export const STEP_TEXT: Record<Step, string> = { write: 'Writing questions', check: 'Checking questions' }
const LOG_SIZE = 40

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

function describeStats(step: Step, stats: CallStats): string {
  const parts = [`${STEP_TEXT[step]}: ${seconds(stats.ms)}`]
  if (stats.promptTokens !== undefined) {
    const tokens = [
      `${stats.promptTokens.toLocaleString()} in`,
      `${(stats.outputTokens ?? 0).toLocaleString()} out`,
      ...(stats.thinkingTokens ? [`${stats.thinkingTokens.toLocaleString()} thinking`] : []),
    ]
    parts.push(`tokens ${tokens.join(', ')}`)
  }
  if (stats.simplified) parts.push('resent without schema/thinking settings')
  return parts.join(' · ')
}

const MAX_RATE_WAITS = 8
const MAX_SERVER_RETRIES = 3

/**
 * Works through the chunks one by one, saving as it goes. Waits out short
 * rate limits, retries server hiccups, skips parts Gemini declines, and stops
 * on problems that retrying cannot fix (bad key, offline, daily limit).
 */
export async function runGeneration(chunks: Chunk[], deps: RunDeps): Promise<JobStatus> {
  const now = deps.now ?? Date.now
  let kept = 0
  let dropped = 0
  let skipped = 0
  let log: LogEntry[] = []
  const partTimes: number[] = []
  const note = (part: number, text: string) => {
    log = [...log, { at: now(), text: `Part ${part} · ${text}` }].slice(-LOG_SIZE)
    deps.update({ log })
  }

  for (const [i, chunk] of chunks.entries()) {
    const part = i + 1
    if (deps.stopped()) return finish('stopped')
    deps.update({ status: 'running', chapter: chunk.chapter, message: undefined })
    const partStarted = now()
    const hooks: StepHooks = {
      onStep: (step) => deps.update({ step, stepStartedAt: now() }),
      onStats: (step, stats) => note(part, describeStats(step, stats)),
    }
    let rateWaits = 0
    let serverRetries = 0
    for (;;) {
      try {
        const result = await deps.generate(chunk, hooks)
        await deps.save(result.questions)
        kept += result.questions.length
        dropped += result.dropped
        note(part, `kept ${result.questions.length}, dropped ${result.dropped}`)
        break
      } catch (error) {
        if (!(error instanceof GeminiError)) {
          note(part, `error: ${String(error)}`)
          deps.update({ status: 'error', message: `Something went wrong: ${String(error)}` })
          return 'error'
        }
        if (error.kind === 'rate-limit' && error.daily && deps.nextModel) {
          const { used, next } = deps.nextModel()
          if (next) {
            note(part, `daily free limit used up for ${used}; continuing with ${next}`)
            continue
          }
          note(part, `daily free limit used up for ${used}; no other free model left`)
          deps.update({ status: 'error', message: allUsedUpMessage(now()), kept, dropped, skipped, step: undefined })
          return 'error'
        }
        if (error.kind === 'rate-limit' && !error.daily && rateWaits < MAX_RATE_WAITS) {
          rateWaits++
          const wait = Math.min(Math.max(error.retryAfterMs ?? 30_000, 5_000), 120_000)
          note(part, `free-tier limit reached, waiting ${Math.ceil(wait / 1000)} s`)
          deps.update({ status: 'waiting', message: `Free-tier limit reached; waiting ${Math.ceil(wait / 1000)} seconds…` })
          await deps.sleep(wait)
          if (deps.stopped()) return finish('stopped')
          deps.update({ status: 'running', message: undefined })
          continue
        }
        if (error.kind === 'server' && serverRetries < MAX_SERVER_RETRIES) {
          serverRetries++
          note(part, `${error.message} Trying again (${serverRetries} of ${MAX_SERVER_RETRIES}).`)
          await deps.sleep(5_000 * serverRetries)
          if (deps.stopped()) return finish('stopped')
          continue
        }
        if (error.kind === 'blocked' || error.kind === 'bad-output' || error.kind === 'server') {
          note(part, `skipped: ${error.message}`)
          skipped++
          break
        }
        note(part, `stopped: ${error.message}`)
        deps.update({ status: 'error', message: error.message, kept, dropped, skipped, step: undefined })
        return 'error'
      }
    }
    partTimes.push(now() - partStarted)
    const avgPartMs = partTimes.reduce((a, b) => a + b, 0) / partTimes.length
    deps.update({ chunksDone: part, kept, dropped, skipped, avgPartMs })
  }
  return finish('done')

  function finish(status: JobStatus): JobStatus {
    deps.update({ status, message: undefined, kept, dropped, skipped, step: undefined })
    return status
  }
}

// ---------- The one generation job the app runs at a time ----------

let progress: JobProgress = { status: 'idle', chunksDone: 0, chunksTotal: 0, kept: 0, dropped: 0, skipped: 0, log: [] }
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

/** Parts of these chapters that do not have AI questions yet. */
export async function chunksToDo(bookId: string, chapters: string[]): Promise<Chunk[]> {
  const blocks = await loadAllBlocks(bookId)
  const { doneChunks } = await bankStats(bookId)
  return pendingChunks(blocks, doneChunks).filter((c) => chapters.includes(c.chapter))
}

export async function startGeneration(options: { book: BookRow; chapters: string[]; apiKey: string; model: string }) {
  if (isGenerating()) return
  const { book, chapters, apiKey, model } = options
  stopRequested = false

  // The preferred model first, then other free models (each has its own daily allowance),
  // skipping any already used up today.
  let models = [model]
  try {
    models = fallbackModels(await listModels(apiKey), model)
  } catch {
    // Offline or the list failed: just try the preferred model.
  }
  const usedUp = todayUsage().usedUp
  models = models.filter((m) => !usedUp.includes(m))
  if (!models.length) {
    update({ status: 'error', bookId: book.id, message: allUsedUpMessage(), log: [] })
    return
  }
  let current = 0

  const chunks = await chunksToDo(book.id, chapters)
  update({
    status: 'running',
    bookId: book.id,
    model: models[0],
    chunksDone: 0,
    chunksTotal: chunks.length,
    kept: 0,
    dropped: 0,
    skipped: 0,
    chapter: undefined,
    message: undefined,
    step: undefined,
    startedAt: Date.now(),
    avgPartMs: undefined,
    log: [],
  })

  // Keep the screen on so the laptop does not sleep halfway through.
  const lock = await navigator.wakeLock?.request('screen').catch(() => null)
  try {
    await runGeneration(chunks, {
      generate: (chunk, hooks) =>
        generateForChunk({
          call: generateJson,
          apiKey,
          model: models[current],
          bookId: book.id,
          bookTitle: book.title,
          chunk,
          ...hooks,
          onRequest: () => recordRequest(models[current]),
        }),
      nextModel: () => {
        const used = models[current]
        markUsedUp(used)
        current++
        const next = models[current]
        if (next) update({ model: next })
        return { used, next }
      },
      save: (rows) => saveQuestions(rows),
      sleep,
      stopped: () => stopRequested,
      update,
    })
  } finally {
    await lock?.release().catch(() => undefined)
  }
}
