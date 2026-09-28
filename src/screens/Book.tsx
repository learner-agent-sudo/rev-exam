import type { Location } from '../app/router'
import { Library } from './book/Library'
import { Reader } from './book/Reader'

export function Book({ location }: { location: Location }) {
  const [view, bookId, index] = location.params
  if (view === 'read' && bookId) {
    return (
      <Reader
        bookId={bookId}
        index={Number(index) || 0}
        mark={location.query.get('mark') === '1'}
        query={location.query.get('q') ?? ''}
      />
    )
  }
  return <Library query={location.query.get('q') ?? ''} />
}
