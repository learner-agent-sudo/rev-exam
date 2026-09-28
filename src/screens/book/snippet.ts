export interface Snippet {
  before: string
  match: string
  after: string
}

/** A short window of `text` around the first match of `query`. */
export function snippet(text: string, query: string, radius = 80): Snippet {
  const at = text.toLowerCase().indexOf(query.trim().toLowerCase())
  if (at < 0) return { before: text.slice(0, radius * 2), match: '', after: text.length > radius * 2 ? '…' : '' }
  const end = at + query.trim().length
  const from = Math.max(0, at - radius)
  const to = Math.min(text.length, end + radius)
  return {
    before: (from > 0 ? '…' : '') + text.slice(from, at),
    match: text.slice(at, end),
    after: text.slice(end, to) + (to < text.length ? '…' : ''),
  }
}
