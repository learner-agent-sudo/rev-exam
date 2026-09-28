import { describe, expect, it } from 'vitest'
import { href, parseHash } from './router'

describe('parseHash', () => {
  it.each([
    ['', 'home', []],
    ['#/', 'home', []],
    ['#/settings', 'settings', []],
    ['#settings', 'settings', []],
    ['#/book/read/abc/42', 'book', ['read', 'abc', '42']],
    ['#/study?mode=exam', 'study', []],
    ['#/unknown/1', 'home', []],
  ])('%s -> %s %j', (hash, name, params) => {
    expect(parseHash(hash)).toMatchObject({ name, params })
  })

  it('reads the query string', () => {
    expect(parseHash('#/book?q=trade%20commission').query.get('q')).toBe('trade commission')
  })

  it('round-trips with href', () => {
    const link = href('book', ['read', 'id with space', 7], { mark: '1' })
    expect(link).toBe('#/book/read/id%20with%20space/7?mark=1')
    const location = parseHash(link)
    expect(location).toMatchObject({ name: 'book', params: ['read', 'id with space', '7'] })
    expect(location.query.get('mark')).toBe('1')
    expect(href('home')).toBe('#/')
    expect(parseHash(href('study')).name).toBe('study')
  })
})
