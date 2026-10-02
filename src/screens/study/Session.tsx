import { useEffect, useMemo, useState } from 'react'
import { href } from '../../app/router'
import type { BlockRow, QuestionRow } from '../../db/db'
import { shuffle } from '../../questions/random'
import { flagQuestion, loadPassages, pickSession, recordAttempt, type SourceFilter } from '../../questions/store'

interface Props {
  bookId: string
  source: SourceFilter
  chapter: string
  size: number
}

interface Result {
  question: QuestionRow
  correct: boolean
}

const LETTERS = ['A', 'B', 'C', 'D']

export function Session({ bookId, source, chapter, size }: Props) {
  const [questions, setQuestions] = useState<QuestionRow[] | null>(null)
  const [position, setPosition] = useState(0)
  const [results, setResults] = useState<Result[]>([])

  useEffect(() => {
    let active = true
    pickSession({ bookId, source, chapter, size }).then((qs) => active && setQuestions(qs))
    return () => {
      active = false
    }
  }, [bookId, source, chapter, size])

  // A new query string makes the Study screen start a fresh session.
  const again = () => {
    window.location.hash = href('study', ['session'], { book: bookId, source, chapter, size: String(size), n: String(Date.now()) })
  }

  if (questions === null) return <p className="muted">Loading…</p>
  if (questions.length === 0) {
    return (
      <div className="page">
        <h1>No questions to practise</h1>
        <a className="btn btn-quiet" href={href('study')}>
          Back to Study
        </a>
      </div>
    )
  }
  if (position >= questions.length) return <Summary results={results} again={again} />

  const question = questions[position]
  return (
    <div className="page session">
      <nav className="session-top" aria-label="Session">
        <a href={href('study')}>← End</a>
        <span className="small muted">
          {position + 1} / {questions.length}
        </span>
      </nav>
      <div className="meter" aria-hidden="true">
        <span style={{ width: `${(position / questions.length) * 100}%` }} />
      </div>
      <QuestionCard
        key={question.id}
        question={question}
        last={position === questions.length - 1}
        onAnswered={(correct) => setResults((r) => [...r, { question, correct }])}
        onNext={() => {
          setPosition((p) => p + 1)
          window.scrollTo(0, 0)
        }}
      />
    </div>
  )
}

function QuestionCard({
  question,
  last,
  onAnswered,
  onNext,
}: {
  question: QuestionRow
  last: boolean
  onAnswered: (correct: boolean) => void
  onNext: () => void
}) {
  // Show options in a fresh order each time, so position is never a clue.
  const order = useMemo(() => shuffle([0, 1, 2, 3]), [])
  const [chosen, setChosen] = useState<number | null>(null)
  const [passages, setPassages] = useState<BlockRow[]>([])
  const [flagged, setFlagged] = useState(Boolean(question.flagged))
  const answered = chosen !== null

  useEffect(() => {
    let active = true
    loadPassages(question.bookId, question.blockIndexes).then((p) => active && setPassages(p))
    return () => {
      active = false
    }
  }, [question])

  function choose(option: number) {
    if (answered) return
    setChosen(option)
    void recordAttempt(question, option)
    onAnswered(option === question.answer)
  }

  // Keyboard on the laptop: 1–4 or A–D to answer, Enter to go on.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
      const key = event.key.toLowerCase()
      const slot = '1234'.indexOf(key) >= 0 ? '1234'.indexOf(key) : 'abcd'.indexOf(key)
      if (!answered && slot >= 0) choose(order[slot])
      else if (answered && (event.key === 'Enter' || event.key === 'ArrowRight')) onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function toggleFlag() {
    await flagQuestion(question.id, !flagged)
    setFlagged(!flagged)
  }

  const correctSlot = order.indexOf(question.answer)
  const isCorrect = chosen === question.answer

  return (
    <article className="question">
      <div className="row chips">
        <span className="chip">{question.source === 'ai' ? 'Exam-style' : question.style ? 'Concept check' : 'Fill in the blank'}</span>
        <span className="chip chip-plain">{question.chapter}</span>
      </div>
      <h2 className="stem">
        <Stem text={question.stem} />
      </h2>

      <ol className="options" role="list">
        {order.map((option, slot) => {
          const state = !answered
            ? ''
            : option === question.answer
              ? 'correct'
              : option === chosen
                ? 'wrong'
                : 'dim'
          return (
            <li key={option}>
              <button className={`option ${state}`} onClick={() => choose(option)} disabled={answered} aria-pressed={chosen === option}>
                <span className="letter">{LETTERS[slot]}</span>
                <span className="option-text">
                  {question.options[option]}
                  {answered && question.explanations?.[option] && (
                    <span className="why">{question.explanations[option]}</span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ol>

      {answered && (
        <section className="feedback" aria-live="polite">
          <p className={`verdict ${isCorrect ? 'ok' : 'bad'}`}>
            {isCorrect ? 'Correct.' : `Not quite. The answer is ${LETTERS[correctSlot]}.`}
          </p>

          <h3 className="eyebrow">From the book</h3>
          {passages.map((passage) => (
            <figure key={passage.index} className="source">
              <figcaption>
                {passage.path.join(' › ') || 'Start of book'}
                {passage.page && ` · p. ${passage.page}`}
              </figcaption>
              <blockquote>
                <Highlighted text={passage.text} quote={question.quote} />
              </blockquote>
              <a href={href('book', ['read', passage.bookId, passage.index], { mark: '1' })}>Read it in the book →</a>
            </figure>
          ))}

          <div className="row session-actions">
            <button className={`btn btn-quiet ${flagged ? 'flagged' : ''}`} onClick={toggleFlag} aria-pressed={flagged}>
              {flagged ? '⚑ Flagged: removed from practice' : 'Flag as wrong or unclear'}
            </button>
            <button className="btn" onClick={onNext}>
              {last ? 'See results' : 'Next question →'}
            </button>
          </div>
        </section>
      )}
    </article>
  )
}

function Stem({ text }: { text: string }) {
  const parts = text.split('_____')
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && <span className="blank" aria-label="blank" />}
        </span>
      ))}
    </>
  )
}

function Highlighted({ text, quote }: { text: string; quote?: string }) {
  const at = quote ? text.indexOf(quote) : -1
  if (!quote || at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark>{quote}</mark>
      {text.slice(at + quote.length)}
    </>
  )
}

function Summary({ results, again }: { results: Result[]; again: () => void }) {
  const right = results.filter((r) => r.correct).length
  return (
    <div className="page">
      <p className="eyebrow">Session finished</p>
      <h1>
        {right} of {results.length} correct
      </h1>
      <section className="card">
        <ol className="review">
          {results.map(({ question, correct }) => (
            <li key={question.id} className={correct ? 'ok' : 'bad'}>
              <span className="mark-icon" aria-label={correct ? 'correct' : 'wrong'}>
                {correct ? '✓' : '✗'}
              </span>
              <span>
                {question.stem.replaceAll('_____', '___')}
                {!correct && <span className="review-answer">Answer: {question.options[question.answer]}</span>}
              </span>
            </li>
          ))}
        </ol>
      </section>
      <div className="row">
        <button className="btn" onClick={again}>
          Practise again
        </button>
        <a className="btn btn-quiet" href={href('study')}>
          Back to Study
        </a>
      </div>
    </div>
  )
}
