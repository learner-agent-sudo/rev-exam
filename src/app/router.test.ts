import { describe, expect, it } from 'vitest'
import { href, parseHash } from './router'

describe('parseHash', () => {
  it.each([
    ['', 'home'],
    ['#/', 'home'],
    ['#/settings', 'settings'],
    ['#settings', 'settings'],
    ['#/book/chapter-3', 'book'],
    ['#/study?mode=exam', 'study'],
    ['#/unknown', 'home'],
  ])('%s -> %s', (hash, route) => {
    expect(parseHash(hash)).toBe(route)
  })

  it('round-trips with href', () => {
    expect(parseHash(href('study'))).toBe('study')
    expect(parseHash(href('home'))).toBe('home')
  })
})
