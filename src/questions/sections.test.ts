import { describe, expect, it } from 'vitest'
import type { BlockRow } from '../db/db'
import { noteBlocks, studyPassages } from './sections'

const block = (index: number, text: string, path = ['Chapter 4']): BlockRow => ({ bookId: 'b', index, kind: 'paragraph', path, text })

describe('noteBlocks', () => {
  it('finds endnotes like the ones in the CIPP/US book', () => {
    const blocks = [
      block(0, 'The FTC can seek civil penalties for violations of its orders.'),
      block(1, '55 15 U.S.C. § 45(a).'),
      block(2, '56 “FTC Approves Final Order Settling Charges against Software and Rent-To-Own Companies,” Federal Trade Commission, April 15, 2013, https://www.ftc.gov/news-events/press-releases/2013/04/ftc.'),
      block(3, '57 Ibid.'),
      block(4, '75 “Any person who engages in unfair competition shall be liable for a civil penalty not to exceed two thousand five hundred dollars ($2,500) for each violation.” Cal. Bus. & Prof. Code § 17206 (1977).'),
    ]
    expect([...noteBlocks(blocks)].sort()).toEqual([1, 2, 3, 4])
    expect(studyPassages(blocks).map((b) => b.index)).toEqual([0])
  })

  it('keeps ordinary sentences that happen to start with a number', () => {
    const blocks = [
      block(0, '13 states have passed comprehensive consumer privacy laws.'),
      block(1, 'Each of them gives consumers a right to know what is collected.'),
    ]
    expect(noteBlocks(blocks).size).toBe(0)
  })

  it('keeps numbered steps that do not look like notes', () => {
    const blocks = [block(0, '1. Identify the personal data you hold.'), block(1, '2. Decide why you need it.')]
    expect(noteBlocks(blocks).size).toBe(0)
  })

  it('skips sections called Notes, Index and the like', () => {
    expect(studyPassages([block(0, 'Some text that sits in the index section.', ['Index'])])).toEqual([])
  })
})
