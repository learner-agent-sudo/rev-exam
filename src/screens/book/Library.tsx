import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { href } from '../../app/router'
import { deleteBook, listBooks, searchBooks, type SearchResult } from '../../book/store'
import type { BookRow } from '../../db/db'
import { ImportCard } from './ImportCard'
import { snippet } from './snippet'

export function Library({ query }: { query: string }) {
  const [books, setBooks] = useState<BookRow[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => setBooks(await listBooks()), [])
  useEffect(() => {
    let active = true
    listBooks().then((list) => active && setBooks(list))
    return () => {
      active = false
    }
  }, [])

  function imported(book: BookRow) {
    const chapters = book.toc.filter((t) => t.depth === 0).length
    setNotice(
      `Imported “${book.title}”: ${chapters} chapters, ${book.passageCount.toLocaleString()} passages, ` +
        (book.hasPageNumbers ? 'with print page numbers.' : 'no print page numbers in this EPUB.'),
    )
    void refresh()
  }

  return (
    <div className="page">
      <p className="eyebrow">Your book</p>
      <h1>Book</h1>
      {notice && (
        <p className="notice notice-ok" role="status">
          {notice}
        </p>
      )}
      {books === null ? (
        <p className="muted">Loading…</p>
      ) : books.length === 0 ? (
        <ImportCard onImported={imported} />
      ) : (
        <>
          <SearchCard query={query} />
          {books.map((book) => (
            <BookCard key={book.id} book={book} onDeleted={refresh} />
          ))}
          <details className="card more">
            <summary>Import another book</summary>
            <ImportCard onImported={imported} title="Import another book" />
          </details>
        </>
      )}
    </div>
  )
}

function SearchCard({ query }: { query: string }) {
  const [found, setFound] = useState<{ query: string; results: SearchResult } | null>(null)
  const searchable = query.trim().length >= 2
  const results = searchable && found?.query === query ? found.results : null

  useEffect(() => {
    if (!searchable) return
    let active = true
    searchBooks(query).then((r) => active && setFound({ query, results: r }))
    return () => {
      active = false
    }
  }, [query, searchable])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const q = String(new FormData(event.currentTarget).get('q') ?? '').trim()
    window.location.hash = q ? href('book', [], { q }) : href('book')
  }

  return (
    <section className="card" aria-labelledby="search-title">
      <h2 id="search-title">Find in the book</h2>
      <form className="input-group" onSubmit={submit} role="search">
        <input
          key={query}
          className="input"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="e.g. Federal Trade Commission"
          aria-label="Search the book"
        />
        <button className="btn" type="submit">
          Search
        </button>
      </form>
      {results && (
        <div className="results">
          <p className="muted small" role="status">
            {results.hits.length === 0
              ? 'No passages match.'
              : results.more
                ? `Showing the first ${results.hits.length} matching passages.`
                : `${results.hits.length} matching passage${results.hits.length === 1 ? '' : 's'}.`}
          </p>
          <ol className="hits">
            {results.hits.map((hit) => {
              const s = snippet(hit.text, query)
              return (
                <li key={`${hit.bookId}-${hit.index}`}>
                  <a href={href('book', ['read', hit.bookId, hit.index], { mark: '1', q: query })}>
                    <span className="hit-where">
                      {hit.path.join(' › ') || 'Start of book'}
                      {hit.page && ` · p. ${hit.page}`}
                    </span>
                    <span className="hit-text">
                      {s.before}
                      <mark>{s.match}</mark>
                      {s.after}
                    </span>
                  </a>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </section>
  )
}

function BookCard({ book, onDeleted }: { book: BookRow; onDeleted: () => void }) {
  const [showAll, setShowAll] = useState(false)
  const chapters = book.toc.filter((t) => t.depth === 0).length
  const hasDeeper = book.toc.some((t) => t.depth > 1)
  const entries = book.toc.filter((t) => showAll || t.depth <= 1)
  const resumeAt = book.lastReadIndex ?? 0

  async function remove() {
    if (!window.confirm(`Delete “${book.title}” from this device?`)) return
    await deleteBook(book.id)
    onDeleted()
  }

  return (
    <section className="card" aria-label={book.title}>
      <p className="eyebrow">Imported {new Date(book.importedAt).toLocaleDateString()}</p>
      <h2 className="book-title">{book.title}</h2>
      {book.author && <p className="muted">{book.author}</p>}
      <dl className="facts">
        <dt>Chapters</dt>
        <dd>{chapters || '—'}</dd>
        <dt>Passages</dt>
        <dd>{book.passageCount.toLocaleString()}</dd>
        <dt>Page numbers</dt>
        <dd>{book.hasPageNumbers ? 'Yes, from the print edition' : 'Not in this EPUB (chapter and section only)'}</dd>
      </dl>
      <div className="row">
        <a className="btn" href={href('book', ['read', book.id, resumeAt])}>
          {book.lastReadIndex !== undefined ? 'Continue reading' : 'Start reading'}
        </a>
        <button className="btn btn-danger" onClick={remove}>
          Delete book
        </button>
      </div>

      <h3 className="spaced">Contents</h3>
      {entries.length === 0 ? (
        <p className="muted small">This EPUB has no table of contents.</p>
      ) : (
        <ol className="toc">
          {entries.map((entry, i) => (
            <li key={i} className={`toc-depth-${Math.min(entry.depth, 3)}`}>
              <a href={href('book', ['read', book.id, entry.blockIndex ?? 0])}>{entry.title}</a>
            </li>
          ))}
        </ol>
      )}
      {hasDeeper && (
        <button className="btn btn-quiet" onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Show fewer sections' : 'Show all sections'}
        </button>
      )}
    </section>
  )
}
