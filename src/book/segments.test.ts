import { describe, expect, it } from 'vitest'
import { nextSegment, previousSegment, segmentFor, segmentStarts } from './segments'

describe('segments', () => {
  const starts = segmentStarts([10, 3, 10, 40])

  it('builds sorted unique starts including 0', () => {
    expect(starts).toEqual([0, 3, 10, 40])
  })

  it('finds the contents section around an index', () => {
    expect(segmentFor(0, starts, 50)).toEqual({ start: 0, end: 3 })
    expect(segmentFor(5, starts, 50)).toEqual({ start: 3, end: 10 })
    expect(segmentFor(45, starts, 50)).toEqual({ start: 40, end: 50 })
  })

  it('splits long sections into fixed chunks', () => {
    // Section 10..40 with chunks of 8: 10-18, 18-26, 26-34, 34-40
    expect(segmentFor(10, starts, 50, 8)).toEqual({ start: 10, end: 18 })
    expect(segmentFor(27, starts, 50, 8)).toEqual({ start: 26, end: 34 })
    expect(segmentFor(39, starts, 50, 8)).toEqual({ start: 34, end: 40 })
  })

  it('clamps out-of-range indexes', () => {
    expect(segmentFor(-5, starts, 50)).toEqual({ start: 0, end: 3 })
    expect(segmentFor(999, starts, 50)).toEqual({ start: 40, end: 50 })
  })

  it('steps to neighbouring segments', () => {
    const middle = segmentFor(27, starts, 50, 8)
    expect(previousSegment(middle, starts, 50, 8)).toEqual({ start: 18, end: 26 })
    expect(nextSegment(middle, starts, 50, 8)).toEqual({ start: 34, end: 40 })
    expect(nextSegment({ start: 34, end: 40 }, starts, 50, 8)).toEqual({ start: 40, end: 48 })
    expect(previousSegment({ start: 0, end: 3 }, starts, 50, 8)).toBeUndefined()
    expect(nextSegment({ start: 48, end: 50 }, starts, 50, 8)).toBeUndefined()
  })
})
