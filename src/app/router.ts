import { useSyncExternalStore } from 'react'

// Hash-based routes (#/settings) work on GitHub Pages without server rewrites.
export const ROUTES = ['home', 'book', 'study', 'settings'] as const
export type Route = (typeof ROUTES)[number]

export function parseHash(hash: string): Route {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : 'home'
}

export function href(route: Route): string {
  return route === 'home' ? '#/' : `#/${route}`
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => parseHash(window.location.hash))
}
