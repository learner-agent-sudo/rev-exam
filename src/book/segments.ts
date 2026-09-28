// The reader shows one "segment" at a time: the stretch between two contents
// entries, cut into chunks so a long chapter never renders thousands of blocks.
export const MAX_SEGMENT = 150

export interface Segment {
  start: number
  end: number // exclusive
}

/** Sorted, de-duplicated start indexes of contents entries (always includes 0). */
export function segmentStarts(tocIndexes: number[]): number[] {
  return [...new Set([0, ...tocIndexes])].sort((a, b) => a - b)
}

export function segmentFor(index: number, starts: number[], blockCount: number, max = MAX_SEGMENT): Segment {
  const clamped = Math.min(Math.max(index, 0), Math.max(blockCount - 1, 0))
  let sectionStart = 0
  let sectionEnd = blockCount
  for (const s of starts) {
    if (s <= clamped) sectionStart = s
    else {
      sectionEnd = Math.min(s, blockCount)
      break
    }
  }
  const start = sectionStart + Math.floor((clamped - sectionStart) / max) * max
  return { start, end: Math.min(start + max, sectionEnd) }
}

export function previousSegment(current: Segment, starts: number[], blockCount: number, max = MAX_SEGMENT) {
  return current.start > 0 ? segmentFor(current.start - 1, starts, blockCount, max) : undefined
}

export function nextSegment(current: Segment, starts: number[], blockCount: number, max = MAX_SEGMENT) {
  return current.end < blockCount ? segmentFor(current.end, starts, blockCount, max) : undefined
}
