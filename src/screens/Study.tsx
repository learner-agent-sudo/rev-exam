import type { Location } from '../app/router'
import type { SourceFilter } from '../questions/store'
import { Session } from './study/Session'
import { StudyHome } from './study/StudyHome'

const SOURCES: SourceFilter[] = ['all', 'ai', 'cloze']

export function Study({ location }: { location: Location }) {
  const { query } = location
  const bookId = query.get('book')
  if (location.params[0] === 'session' && bookId) {
    const source = SOURCES.find((s) => s === query.get('source')) ?? 'all'
    return (
      // A new query string (e.g. "Practise again") starts a fresh session.
      <Session
        key={query.toString()}
        bookId={bookId}
        source={source}
        chapter={query.get('chapter') ?? ''}
        size={Number(query.get('size')) || 10}
      />
    )
  }
  return <StudyHome />
}
