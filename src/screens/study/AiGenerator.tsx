import { useEffect, useMemo, useState } from 'react'
import { href } from '../../app/router'
import { loadAllBlocks } from '../../book/store'
import type { BlockRow, BookRow } from '../../db/db'
import { todayUsage } from '../../gemini/quota'
import { chunkBook, pendingChunks, questionsWanted, type Chunk } from '../../questions/ai'
import {
  isGenerating,
  resetTimeText,
  startGeneration,
  STEP_TEXT,
  stopGeneration,
  useGenerationJob,
} from '../../questions/job'
import type { BankStats } from '../../questions/store'
import { useSettings } from '../../settings/useSettings'

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

interface ChapterPlan {
  chapter: string
  pending: Chunk[]
}

export function AiGenerator({ book, stats }: { book: BookRow; stats: BankStats }) {
  const { settings, loaded } = useSettings()
  const job = useGenerationJob()
  const running = isGenerating(job) && job.bookId === book.id
  const [blocks, setBlocks] = useState<BlockRow[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    let active = true
    loadAllBlocks(book.id).then((all) => active && setBlocks(all))
    return () => {
      active = false
    }
  }, [book.id])

  // Every chapter, in book order, with the parts that still have no AI questions.
  const plan: ChapterPlan[] = useMemo(() => {
    if (!blocks) return []
    const byChapter = new Map<string, ChapterPlan>()
    for (const chunk of chunkBook(blocks)) byChapter.set(chunk.chapter, { chapter: chunk.chapter, pending: [] })
    for (const chunk of pendingChunks(blocks, stats.doneChunks)) byChapter.get(chunk.chapter)?.pending.push(chunk)
    return [...byChapter.values()]
  }, [blocks, stats])

  const aiCount = (chapter: string) => stats.chapters.find((c) => c.chapter === chapter)?.ai ?? 0
  const todo = plan.filter((p) => selected.has(p.chapter)).flatMap((p) => p.pending)
  const wholeBook = plan.flatMap((p) => p.pending)
  const chaptersDone = plan.filter((p) => !p.pending.length).length

  function toggle(chapter: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(chapter)) next.delete(chapter)
      else next.add(chapter)
      return next
    })
  }

  function start(chapters: string[]) {
    if (!settings.geminiApiKey || !settings.geminiModel) return
    void startGeneration({ book, chapters, apiKey: settings.geminiApiKey, model: settings.geminiModel })
  }

  const hasKey = Boolean(settings.geminiApiKey && settings.geminiModel)

  return (
    <section className="card" aria-labelledby="ai-title">
      <div className="card-head">
        <h2 id="ai-title">Exam-style questions</h2>
        <span className="chip">Gemini · needs internet</span>
      </div>
      <p className="muted small">
        Gemini writes CIPP/US-style questions from each part of your book, then answers them again without seeing the
        intended answer. Questions where the two disagree, or that look ambiguous, are thrown away. Some imperfect ones
        may still get through: use “Flag” while practising. Best done on your laptop.
      </p>

      {!loaded ? null : !hasKey ? (
        <p className="notice notice-info">
          Add and check your Gemini API key in <a href={href('settings')}>Settings</a> first.
        </p>
      ) : running ? (
        <Progress />
      ) : (
        <>
          {job.bookId === book.id && job.status !== 'idle' && <Outcome />}
          <Allowance />
          {blocks === null ? (
            <p className="muted">Loading chapters…</p>
          ) : (
            <>
              {wholeBook.length === 0 ? (
                <p className="notice notice-ok">Every part of the book has exam-style questions.</p>
              ) : (
                <div className="stack whole-book">
                  <p className="small">
                    <Estimate parts={wholeBook} /> Finished parts are saved: if the daily allowance runs out, press the
                    button again later to carry on where it stopped.
                  </p>
                  <div>
                    <button className="btn" onClick={() => start(plan.map((p) => p.chapter))}>
                      {chaptersDone ? 'Continue with the rest of the book' : 'Create for the whole book'}
                    </button>
                  </div>
                </div>
              )}

              <details className="chapter-picker">
                <summary>
                  Choose chapters instead
                  <span className="muted"> · {chaptersDone} of {plan.length} chapters done</span>
                </summary>
                <div className="row chapter-actions">
                  <button
                    className="btn btn-quiet"
                    onClick={() => setSelected(new Set(plan.filter((p) => p.pending.length).map((p) => p.chapter)))}
                  >
                    Select all not done
                  </button>
                  <button className="btn btn-quiet" onClick={() => setSelected(new Set())}>
                    Clear
                  </button>
                </div>
                <ul className="chapter-list">
                  {plan.map((p) => {
                    const done = p.pending.length === 0
                    return (
                      <li key={p.chapter}>
                        <label className={done ? 'done' : ''}>
                          <input
                            type="checkbox"
                            checked={selected.has(p.chapter)}
                            disabled={done}
                            onChange={() => toggle(p.chapter)}
                          />
                          <span className="chapter-name">{p.chapter}</span>
                          <span className="chapter-meta">
                            {done
                              ? `Done · ${plural(aiCount(p.chapter), 'question')}`
                              : `${plural(p.pending.length, 'part')} to do · ${plural(aiCount(p.chapter), 'question')} so far`}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
                {todo.length > 0 && (
                  <p className="muted small">
                    <Estimate parts={todo} />
                  </p>
                )}
                <button className="btn" onClick={() => start([...selected])} disabled={todo.length === 0}>
                  Create for selected chapters
                </button>
              </details>
            </>
          )}
        </>
      )}
    </section>
  )
}

/** "3 parts, about 24 questions before the check: 6 requests to Gemini." */
function Estimate({ parts }: { parts: Chunk[] }) {
  const questions = parts.reduce((sum, c) => sum + questionsWanted(c), 0)
  return (
    <>
      {plural(parts.length, 'part')}, about {plural(questions, 'question')} before the check:{' '}
      {plural(parts.length * 2, 'request')} to Gemini.
    </>
  )
}

/** Today's free allowance: requests made on this device, used-up models and the reset time. */
function Allowance() {
  // Subscribing to the job re-draws this (and re-reads the counts) whenever it reports progress.
  useGenerationJob()
  const usage = todayUsage()
  const counts = Object.entries(usage.requests)
  return (
    <div className="allowance small">
      <p className="muted">
        Google's free allowance is per model and per day: roughly 20 requests for Flash models and several hundred for
        Flash-Lite. When one model runs out, the app carries on with the next free model. Allowances reset at{' '}
        {resetTimeText(usage.resetsAt)} your time.
      </p>
      {counts.length > 0 && (
        <p className="muted">
          Used today on this device: {counts.map(([model, n]) => `${model} ${n}`).join(' · ')}
          {usage.usedUp.length > 0 && <> · used up: {usage.usedUp.join(', ')}</>}
        </p>
      )}
    </div>
  )
}

/** Re-renders every second while `active`, for live timers. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

const duration = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000))
  return total < 60 ? `${total} s` : `${Math.floor(total / 60)} min ${total % 60} s`
}

function Progress() {
  const job = useGenerationJob()
  const now = useNow(true)
  const left = job.avgPartMs ? job.avgPartMs * (job.chunksTotal - job.chunksDone) : undefined
  return (
    <div className="stack" role="status">
      <div className="progress">
        <progress value={job.chunksDone} max={job.chunksTotal || 1} />
        <span className="small muted">
          Part {Math.min(job.chunksDone + 1, job.chunksTotal)} of {job.chunksTotal}
          {job.chapter ? ` · ${job.chapter}` : ''}
        </span>
      </div>
      {job.step && job.stepStartedAt && job.status === 'running' && (
        <p className="small live-step">
          {STEP_TEXT[job.step]}… {duration(now - job.stepStartedAt)}
        </p>
      )}
      <p className="small">
        {plural(job.kept, 'question')} kept · {job.dropped} dropped by the check
        {job.skipped ? ` · ${plural(job.skipped, 'part')} skipped` : ''}
      </p>
      {left !== undefined && (
        <p className="muted small">
          About {duration(job.avgPartMs!)} per part, so roughly {duration(left)} left.
        </p>
      )}
      {job.message && <p className="notice notice-info">{job.message}</p>}
      <p className="muted small">Model: {job.model}. Keep this tab open; you can switch to other screens in the app.</p>
      <div>
        <button className="btn btn-danger" onClick={stopGeneration}>
          Stop
        </button>
      </div>
      <Log />
    </div>
  )
}

/** Every request with its time and token counts, so slow runs can be diagnosed from a screenshot. */
function Log() {
  const job = useGenerationJob()
  if (!job.log.length) return null
  return (
    <details className="job-log">
      <summary>Details for troubleshooting</summary>
      <p className="muted small">Model: {job.model}</p>
      <ol>
        {job.log.map((entry, i) => (
          <li key={i}>
            <time>{new Date(entry.at).toLocaleTimeString()}</time> {entry.text}
          </li>
        ))}
      </ol>
    </details>
  )
}

function Outcome() {
  const job = useGenerationJob()
  const took = job.startedAt && job.log.length ? ` Took ${duration(job.log[job.log.length - 1].at - job.startedAt)}.` : ''
  const summary = `${plural(job.kept, 'question')} kept, ${job.dropped} dropped by the check${job.skipped ? `, ${plural(job.skipped, 'part')} skipped` : ''}.${took}`
  return (
    <>
      {job.status === 'error' ? (
        <p className="notice notice-bad" role="alert">
          Stopped: {job.message} {summary}
        </p>
      ) : (
        <p className="notice notice-ok" role="status">
          {job.status === 'stopped' ? 'Stopped.' : 'Finished.'} {summary}
        </p>
      )}
      <Log />
    </>
  )
}
