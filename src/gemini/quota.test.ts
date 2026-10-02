// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { markUsedUp, nextPacificReset, pacificDay, recordRequest, todayUsage } from './quota'

describe('Pacific time', () => {
  it('finds the Pacific date', () => {
    // 2026-10-02 06:30 UTC is still 1 October in California (UTC−7 in summer).
    expect(pacificDay(Date.UTC(2026, 9, 2, 6, 30))).toBe('2026-10-01')
    expect(pacificDay(Date.UTC(2026, 9, 2, 8, 0))).toBe('2026-10-02')
  })

  it('finds the next reset at midnight Pacific, in summer and winter time', () => {
    // Summer: midnight PDT is 07:00 UTC.
    expect(nextPacificReset(Date.UTC(2026, 9, 2, 6, 30))).toBe(Date.UTC(2026, 9, 2, 7, 0))
    expect(nextPacificReset(Date.UTC(2026, 9, 2, 7, 0))).toBe(Date.UTC(2026, 9, 3, 7, 0))
    // Winter: midnight PST is 08:00 UTC.
    expect(nextPacificReset(Date.UTC(2026, 11, 15, 20, 15))).toBe(Date.UTC(2026, 11, 16, 8, 0))
  })
})

describe('usage counts', () => {
  beforeEach(() => localStorage.clear())

  it('counts requests per model and remembers used-up models for the day', () => {
    const morning = Date.UTC(2026, 9, 2, 16, 0) // 9:00 Pacific
    recordRequest('gemini-3-flash', morning)
    recordRequest('gemini-3-flash', morning)
    recordRequest('gemini-3.1-flash-lite', morning)
    markUsedUp('gemini-3-flash', morning)
    expect(todayUsage(morning)).toEqual({
      requests: { 'gemini-3-flash': 2, 'gemini-3.1-flash-lite': 1 },
      usedUp: ['gemini-3-flash'],
      resetsAt: Date.UTC(2026, 9, 3, 7, 0),
    })
  })

  it('starts fresh after the Pacific midnight reset', () => {
    recordRequest('gemini-3-flash', Date.UTC(2026, 9, 2, 16, 0))
    markUsedUp('gemini-3-flash', Date.UTC(2026, 9, 2, 16, 0))
    expect(todayUsage(Date.UTC(2026, 9, 3, 7, 1))).toMatchObject({ requests: {}, usedUp: [] })
  })
})
