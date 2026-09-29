import { useEffect, useMemo, useState } from 'react'
import { href } from '../../app/router'
import { loadAllBlocks } from '../../book/store'
import type { BookRow } from '../../db/db'
import { chunkBook, questionsWanted, type Chunk } from '../../questions/ai'
import { isGenerating, startGeneration, stopGeneration, useGenerationJob } from '../../questions/job'
import type { BankStats } from '../../questions/store'
import { useSettings } from '../../settings/useSettings'

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

interface ChapterPlan {
  chapter: string
  chunks: Chunk[]
  pending: Chunk[]
}

export function AiGenerator({ book, stats }: { book: BookRow; stats: BankStats }) {
  const { settings, loaded } = useSettings()
  const job = useGenerationJob()
  const running = isGenerating(job) && job.bookId === book.id
  const [chunks, setChunks] = useState<Chunk[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    let active = true
    loadAllBlocks(book.id).then((blocks) => active && setChunks(chunkBook(blocks)))
    return () => {
      active = false
    }
  }, [book.id])

  const plan: ChapterPlan[] = useMemo(() => {
    const byChapter = new Map<string, ChapterPlan>()
    for (const chunk of chunks ?? []) {
      const entry = byChapter.get(chunk.chapter) ?? { chapter: chunk.chapter, chunks: [], pending: [] }
      entry.chunks.push(chunk)
      if (!stats.doneChunks.has(chunk.key)) entry.pending.push(chunk)
      byChapter.set(chunk.chapter, entry)
    }
    return [...byChapter.values()]
  }, [chunks, stats])

  const aiCount = (chapter: string) => stats.chapters.find((c) => c.chapter === chapter)?.ai ?? 0
  const todo = plan.filter((p) => selected.has(p.chapter)).flatMap((p) => p.pending)
  const requests = todo.length * 2
  const minutes = Math.max(1, Math.ceil((requests * 7) / 60))
  const expected = todo.reduce((sum, c) => sum + questionsWanted(c), 0)

  function toggle(chapter: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(chapter)) next.delete(chapter)
      else next.add(chapter)
      return next
    })
  }

  function start() {
    if (!settings.geminiApiKey || !settings.geminiModel) return
    void startGeneration({ book, chapters: [...selected], apiKey: settings.geminiApiKey, model: settings.geminiModel })
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
          {chunks === null ? (
            <p className="muted">Loading chapters…</p>
          ) : (
            <>
              <div className="row chapter-actions">
                <button className="btn btn-quiet" onClick={() => setSelected(new Set(plan.filter((p) => p.pending.length).map((p) => p.chapter)))}>
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
                            : `${p.pending.length} of ${plural(p.chunks.length, 'part')} to do · ${plural(aiCount(p.chapter), 'question')}`}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
              {todo.length > 0 && (
                <p className="muted small">
                  {plural(todo.length, 'part')}, about {plural(expected, 'question')} before the check:{' '}
                  {plural(requests, 'request')} to Gemini, roughly {plural(minutes, 'minute')} on the free tier. Finished
                  parts are saved, so you can stop and continue later.
                </p>
              )}
              <button className="btn" onClick={start} disabled={todo.length === 0}>
                Create questions
              </button>
            </>
          )}
        </>
      )}
    </section>
  )
}

function Progress() {
  const job = useGenerationJob()
  return (
    <div className="stack" role="status">
      <div className="progress">
        <progress value={job.chunksDone} max={job.chunksTotal || 1} />
        <span className="small muted">
          Part {Math.min(job.chunksDone + 1, job.chunksTotal)} of {job.chunksTotal}
          {job.chapter ? ` · ${job.chapter}` : ''}
        </span>
      </div>
      <p className="small">
        {plural(job.kept, 'question')} kept · {job.dropped} dropped by the check
        {job.skipped ? ` · ${plural(job.skipped, 'part')} skipped` : ''}
      </p>
      {job.message && <p className="notice notice-info">{job.message}</p>}
      <p className="muted small">Keep this tab open. You can switch to other screens in the app.</p>
      <div>
        <button className="btn btn-danger" onClick={stopGeneration}>
          Stop
        </button>
      </div>
    </div>
  )
}

function Outcome() {
  const job = useGenerationJob()
  const summary = `${plural(job.kept, 'question')} kept, ${job.dropped} dropped by the check${job.skipped ? `, ${plural(job.skipped, 'part')} skipped` : ''}.`
  if (job.status === 'error') {
    return (
      <p className="notice notice-bad" role="alert">
        Stopped: {job.message} {summary}
      </p>
    )
  }
  return (
    <p className="notice notice-ok" role="status">
      {job.status === 'stopped' ? 'Stopped.' : 'Finished.'} {summary}
    </p>
  )
}
