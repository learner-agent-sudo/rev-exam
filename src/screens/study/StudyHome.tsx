import { useCallback, useEffect, useState } from 'react'
import { href } from '../../app/router'
import { StudyIcon } from '../../app/icons'
import { listBooks, loadAllBlocks } from '../../book/store'
import type { BookRow } from '../../db/db'
import { generateCloze } from '../../questions/cloze'
import { useGenerationJob } from '../../questions/job'
import { bankStats, replaceClozeQuestions, type BankStats, type SourceFilter } from '../../questions/store'
import { AiGenerator } from './AiGenerator'

export function StudyHome() {
  const [books, setBooks] = useState<BookRow[] | null>(null)
  const [bookId, setBookId] = useState<string | null>(null)
  const [stats, setStats] = useState<BankStats | null>(null)
  const job = useGenerationJob()

  useEffect(() => {
    let active = true
    listBooks().then((list) => {
      if (!active) return
      setBooks(list)
      setBookId((current) => current ?? list[list.length - 1]?.id ?? null)
    })
    return () => {
      active = false
    }
  }, [])

  const refresh = useCallback(async () => {
    if (bookId) setStats(await bankStats(bookId))
  }, [bookId])

  // Reload counts when the book changes and whenever the AI job saves more questions.
  useEffect(() => {
    let active = true
    if (bookId) bankStats(bookId).then((s) => active && setStats(s))
    return () => {
      active = false
    }
  }, [bookId, job.kept, job.status])

  const book = books?.find((b) => b.id === bookId)

  if (books === null) return <p className="muted">Loading…</p>
  if (!book) {
    return (
      <div className="page">
        <p className="eyebrow">Practice and mock exams</p>
        <h1>Study</h1>
        <section className="card empty">
          <StudyIcon />
          <h2>Import your book first</h2>
          <p className="muted">Questions are made from your textbook, so start by importing its EPUB file.</p>
          <a className="btn" href={href('book')}>
            Go to Book
          </a>
        </section>
      </div>
    )
  }

  return (
    <div className="page">
      <p className="eyebrow">Practice and mock exams</p>
      <h1>Study</h1>
      {books.length > 1 && (
        <div className="card">
          <label htmlFor="book-pick">Book</label>
          <select id="book-pick" value={book.id} onChange={(e) => setBookId(e.target.value)}>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </div>
      )}
      {stats && <PracticeCard book={book} stats={stats} />}
      {stats && <ClozeCard book={book} stats={stats} onChange={refresh} />}
      {stats && <AiGenerator book={book} stats={stats} />}
    </div>
  )
}

const SOURCES: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'All questions' },
  { value: 'ai', label: 'Exam-style (Gemini)' },
  { value: 'cloze', label: 'Fill in the blank' },
]

function PracticeCard({ book, stats }: { book: BookRow; stats: BankStats }) {
  const [source, setSource] = useState<SourceFilter>('all')
  const [chapter, setChapter] = useState('')
  const [size, setSize] = useState('10')

  const countFor = (c: { ai: number; cloze: number }) => (source === 'all' ? c.ai + c.cloze : c[source])
  const available = chapter
    ? countFor(stats.chapters.find((c) => c.chapter === chapter) ?? { ai: 0, cloze: 0 })
    : countFor(stats)

  return (
    <section className="card" aria-labelledby="practice-title">
      <div className="card-head">
        <h2 id="practice-title">Practice</h2>
        <span className="chip">{(stats.ai + stats.cloze).toLocaleString()} questions</span>
      </div>
      {stats.ai + stats.cloze === 0 ? (
        <p className="muted">No questions yet. Create some below: fill-in-the-blank takes a second and needs no AI.</p>
      ) : (
        <>
          <div className="form-grid">
            <div>
              <label htmlFor="p-source">Questions</label>
              <select id="p-source" value={source} onChange={(e) => setSource(e.target.value as SourceFilter)}>
                {SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label} ({s.value === 'all' ? stats.ai + stats.cloze : stats[s.value]})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="p-chapter">Chapter</label>
              <select id="p-chapter" value={chapter} onChange={(e) => setChapter(e.target.value)}>
                <option value="">Whole book</option>
                {stats.chapters.map((c) => (
                  <option key={c.chapter} value={c.chapter}>
                    {c.chapter} ({countFor(c)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="p-size">How many</label>
              <select id="p-size" value={size} onChange={(e) => setSize(e.target.value)}>
                {['10', '20', '40'].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="muted small">New questions come first, then ones you got wrong last time.</p>
          {available > 0 ? (
            <a className="btn" href={href('study', ['session'], { book: book.id, source, chapter, size })}>
              Start practice
            </a>
          ) : (
            <p className="notice notice-info">No questions of this kind in this chapter yet.</p>
          )}
        </>
      )}
    </section>
  )
}

function ClozeCard({ book, stats, onChange }: { book: BookRow; stats: BankStats; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    const questions = generateCloze(book.id, await loadAllBlocks(book.id))
    await replaceClozeQuestions(book.id, questions)
    setNotice(
      questions.length
        ? `Created ${questions.length.toLocaleString()} fill-in-the-blank questions.`
        : 'No suitable sentences were found in this book.',
    )
    setBusy(false)
    onChange()
  }

  return (
    <section className="card" aria-labelledby="cloze-title">
      <div className="card-head">
        <h2 id="cloze-title">Fill in the blank</h2>
        <span className="chip">No AI · works offline</span>
      </div>
      <p className="muted small">
        Real sentences from your book with a law, agency, acronym, year or number blanked out. The wrong options are
        similar terms from the same book. Good for memorising names and facts; it cannot test understanding like the
        exam-style questions below.
      </p>
      <div className="row">
        <button className="btn" onClick={create} disabled={busy}>
          {busy ? 'Creating…' : stats.cloze ? 'Refresh from the book' : 'Create from my book'}
        </button>
        {stats.cloze > 0 && <span className="muted small">{stats.cloze.toLocaleString()} ready</span>}
      </div>
      {notice && (
        <p className="notice notice-ok spaced" role="status">
          {notice}
        </p>
      )}
    </section>
  )
}
