import { useMemo, useSyncExternalStore } from 'react'

// Hash-based routes (#/book/read/<id>/<index>?mark=1) work on GitHub Pages without server rewrites.
export const ROUTES = ['home', 'book', 'study', 'settings'] as const
export type Route = (typeof ROUTES)[number]

export interface Location {
  name: Route
  params: string[]
  query: URLSearchParams
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function parseHash(hash: string): Location {
  const raw = hash.replace(/^#\/?/, '')
  const queryStart = raw.indexOf('?')
  const path = queryStart >= 0 ? raw.slice(0, queryStart) : raw
  const query = new URLSearchParams(queryStart >= 0 ? raw.slice(queryStart + 1) : '')
  const [first, ...rest] = path.split('/').filter(Boolean).map(decode)
  if (first && (ROUTES as readonly string[]).includes(first)) return { name: first as Route, params: rest, query }
  return { name: 'home', params: [], query }
}

export function href(route: Route, params: (string | number)[] = [], query?: Record<string, string>): string {
  const segments = [route === 'home' ? '' : route, ...params.map((p) => encodeURIComponent(String(p)))]
  const search = query ? new URLSearchParams(query).toString() : ''
  return `#/${segments.filter(Boolean).join('/')}${search ? `?${search}` : ''}`
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useLocation(): Location {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  return useMemo(() => parseHash(hash), [hash])
}
