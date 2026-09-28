import { useEffect, useMemo, useState } from 'react'
import { href } from '../../app/router'
import { nextSegment, previousSegment, segmentFor, segmentStarts } from '../../book/segments'
import { getBook, loadBlocks, rememberPosition } from '../../book/store'
import type { BlockRow, BookRow } from '../../db/db'

interface Props {
  bookId: string
  index: number
  /** Highlight the passage at `index` (used by search results and, later, question references). */
  mark: boolean
  /** Search the reader came from, for the back link. */
  query: string
}

export function Reader({ bookId, index, mark, query }: Props) {
  const [book, setBook] = useState<BookRow | null | undefined>(undefined)
  const [loaded, setLoaded] = useState<{ start: number; blocks: BlockRow[] } | null>(null)

  useEffect(() => {
    let active = true
    getBook(bookId).then((b) => active && setBook(b ?? null))
    return () => {
      active = false
    }
  }, [bookId])

  const starts = useMemo(() => segmentStarts((book?.toc ?? []).map((t) => t.blockIndex ?? 0)), [book])
  const segment = book ? segmentFor(index, starts, book.blockCount) : undefined
  const segStart = segment?.start
  const segEnd = segment?.end

  useEffect(() => {
    if (segStart === undefined || segEnd === undefined) return
    let active = true
    loadBlocks(bookId, segStart, segEnd).then((blocks) => active && setLoaded({ start: segStart, blocks }))
    void rememberPosition(bookId, index)
    return () => {
      active = false
    }
  }, [bookId, segStart, segEnd, index])

  const blocks = loaded && loaded.start === segStart ? loaded.blocks : null

  // Bring the requested passage into view once its segment is on screen.
  useEffect(() => {
    if (!blocks) return
    const target = document.getElementById(`b-${index}`)
    if (target && (mark || index !== segStart)) target.scrollIntoView({ block: 'center' })
    else window.scrollTo(0, 0)
  }, [blocks, index, mark, segStart])

  if (book === undefined) return <p className="muted">Loading…</p>
  if (book === null || !segment) {
    return (
      <div className="page">
        <h1>Book not found</h1>
        <p className="muted">It may have been deleted on this device.</p>
        <a className="btn btn-quiet" href={href('book')}>
          Back to Book
        </a>
      </div>
    )
  }

  const prev = previousSegment(segment, starts, book.blockCount)
  const next = nextSegment(segment, starts, book.blockCount)
  const focus = blocks?.find((b) => b.index === index) ?? blocks?.[0]
  const back = query ? { to: href('book', [], { q: query }), label: '← Search results' } : { to: href('book'), label: '← Contents' }

  return (
    <article className="page reader">
      <nav className="reader-top" aria-label="Reader">
        <a href={back.to}>{back.label}</a>
        <span className="muted small">{book.title}</span>
      </nav>
      {focus && focus.path.length > 0 && <p className="crumbs">{focus.path.join(' › ')}</p>}

      <div className="reader-body">
        {blocks === null ? <p className="muted">Loading…</p> : <Blocks blocks={blocks} target={mark ? index : undefined} />}
      </div>

      <nav className="reader-pager" aria-label="Pages">
        {prev ? (
          <a className="btn btn-quiet" href={href('book', ['read', book.id, prev.start])}>
            ← Previous
          </a>
        ) : (
          <span />
        )}
        <span className="muted small">
          {Math.round((segment.end / book.blockCount) * 100)}% through
        </span>
        {next ? (
          <a className="btn btn-quiet" href={href('book', ['read', book.id, next.start])}>
            Next →
          </a>
        ) : (
          <span />
        )}
      </nav>
    </article>
  )
}

/** Indexes of blocks where a new print page begins. */
function pageStarts(blocks: BlockRow[]): Set<number> {
  const starts = new Set<number>()
  let current: string | undefined
  for (const block of blocks) {
    if (block.page !== undefined && block.page !== current) starts.add(block.index)
    current = block.page ?? current
  }
  return starts
}

function Blocks({ blocks, target }: { blocks: BlockRow[]; target?: number }) {
  const newPage = pageStarts(blocks)
  return (
    <>
      {blocks.map((block) => {
        const showPage = newPage.has(block.index)
        const props = {
          id: `b-${block.index}`,
          className: block.index === target ? 'target' : undefined,
        }
        const page = showPage ? (
          <span className="page-mark" aria-label={`Page ${block.page}`}>
            p. {block.page}
          </span>
        ) : null

        if (block.kind === 'heading') {
          const Tag = block.level === 1 ? 'h2' : block.level === 2 ? 'h3' : 'h4'
          return (
            <Tag key={block.index} {...props}>
              {page}
              {block.text}
            </Tag>
          )
        }
        if (block.kind === 'table') {
          return (
            <div key={block.index} {...props} className={`table-wrap ${props.className ?? ''}`}>
              {page}
              <table>
                <tbody>
                  {(block.rows ?? []).map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td key={c}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        return (
          <p key={block.index} {...props} className={`${block.kind === 'list-item' ? 'li' : ''} ${props.className ?? ''}`}>
            {page}
            {block.text}
          </p>
        )
      })}
    </>
  )
}
