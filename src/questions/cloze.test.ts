// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parseEpub } from '../book/epub'
import { makeEpub, sampleLawsHandbook } from '../book/testing/makeEpub'
import type { BlockRow } from '../db/db'
import { findTerms, generateCloze } from './cloze'

const terms = (sentence: string) => findTerms(sentence).map((t) => [t.kind, t.text, t.unit].filter(Boolean).join(':'))

describe('findTerms', () => {
  it('finds laws, agencies and acronyms, preferring the longest match', () => {
    expect(terms('Under the Fair Credit Reporting Act, the FTC Act and HIPAA both apply.')).toEqual([
      'law:Fair Credit Reporting Act',
      'law:FTC Act',
      'acronym:HIPAA',
    ])
    expect(terms('The Department of Health and Human Services enforces the HIPAA Privacy Rule.')).toEqual([
      'agency:Department of Health and Human Services',
      'law:HIPAA Privacy Rule',
    ])
    expect(terms('The Federal Trade Commission sued.')).toEqual(['agency:Federal Trade Commission'])
  })

  it('finds years and numbers with units, but not citations or bare counts', () => {
    expect(terms('COPPA took effect in 2000 and covers children under 13, with fines up to $50,000 and 30 days to cure.')).toEqual([
      'acronym:COPPA',
      'year:2000',
      'number:13:bare',
      'number:$50,000:$',
      'number:30 days:day',
    ])
    expect(terms('Section 5 of the FTC Act has 3 parts.')).toEqual(['law:FTC Act'])
  })

  it('ignores roman numerals and single capitals', () => {
    expect(terms('Title V and Part II of the rule apply to I and A.')).toEqual([])
  })
})

describe('generateCloze', async () => {
  const book = await parseEpub(await makeEpub(sampleLawsHandbook()))
  const blocks: BlockRow[] = book.blocks.map((b) => ({ ...b, bookId: 'book-1' }))
  const questions = generateCloze('book-1', blocks, { now: 1 })

  it('makes a question from each law sentence', () => {
    const lawChapter = questions.filter((q) => q.chapter === 'Chapter 3. Federal Privacy Laws')
    expect(lawChapter).toHaveLength(6)
  })

  it('blanks the answer out of a real sentence from the book', () => {
    for (const q of questions) {
      expect(q.stem).toContain('_____')
      expect(q.stem.replaceAll('_____', q.options[q.answer])).toBe(q.quote)
      expect(blocks[q.blockIndexes[0]].text).toContain(q.quote)
    }
  })

  it('offers three different wrong options of the same kind that are not in the sentence', () => {
    for (const q of questions) {
      expect(q.options).toHaveLength(4)
      expect(new Set(q.options.map((o) => o.toLowerCase())).size).toBe(4)
      for (const wrong of q.options.slice(1)) expect(q.quote!.toLowerCase()).not.toContain(wrong.toLowerCase())
      const kinds = q.options.map((o) => (/^\d{4}$/.test(o) ? 'year' : /(Act|Rule|Principles)$/.test(o) ? 'law' : /^[A-Z]+$/.test(o) ? 'acronym' : 'other'))
      expect(new Set(kinds).size).toBe(1)
    }
  })

  it('mixes question types', () => {
    const kinds = new Set(questions.map((q) => (/^\d{4}$/.test(q.options[0]) ? 'year' : 'law')))
    expect(kinds).toEqual(new Set(['year', 'law']))
  })

  it('is repeatable, so regenerating keeps question ids and answer history', () => {
    expect(generateCloze('book-1', blocks, { now: 1 })).toEqual(questions)
  })

  it('skips index and copyright sections', () => {
    const skipped: BlockRow[] = [
      { bookId: 'b', index: 0, kind: 'paragraph', path: ['Index'], text: 'The Fair Credit Reporting Act was passed by Congress in 1970 after hearings.' },
      { bookId: 'b', index: 1, kind: 'paragraph', path: ['Copyright'], text: 'The Privacy Act was passed by Congress in 1974 after many long hearings.' },
    ]
    expect(generateCloze('b', skipped)).toEqual([])
  })
})
