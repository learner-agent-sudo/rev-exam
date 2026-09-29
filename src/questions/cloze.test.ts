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

  it('ignores capitals used for emphasis', () => {
    expect(terms('(SULKY AND SLEEPY) Don’t know where it is.')).toEqual([])
    expect(terms('But THAT was all he said to the crew.')).toEqual([])
    expect(terms('The CCPA and the GDPR differ.')).toEqual(['acronym:CCPA', 'acronym:GDPR'])
  })
})

describe('generateCloze filters', () => {
  const block = (index: number, text: string): BlockRow => ({ bookId: 'b', index, kind: 'paragraph', path: ['Ch 1'], text })

  it('skips code and markup', () => {
    const blocks = [
      block(0, "hr.transition { background: url('x.gif') no-repeat 50% 50%; height: 1em; margin: 0.5em 0em; }"),
      block(1, '<p aria-live="true">Your current score from the FTC is 50% today.</p>'),
    ]
    expect(generateCloze('b', blocks)).toEqual([])
  })

  it('offers years close to the right one', () => {
    const years = [1950, 1960, 1970, 1980, 1995, 1996, 1997, 1998, 1999, 2000, 2001]
    const blocks = years.map((y, i) => block(i, `The committee reviewed the privacy rules again in ${y} after many complaints.`))
    const question = generateCloze('b', blocks).find((q) => q.options[q.answer] === '1998')!
    for (const option of question.options) expect(Math.abs(Number(option) - 1998)).toBeLessThanOrEqual(3)
  })

  it('uses one answer at most four times, so a common term cannot flood the bank', () => {
    const laws = ['Fair Credit Reporting Act', 'Video Privacy Protection Act', 'Gramm-Leach-Bliley Act']
    const blocks = [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => block(n, `Federal agencies must follow the Privacy Act for record system number ${'I'.repeat(n)} about people.`)),
      ...laws.map((law, i) => block(20 + i, `The ${law} sets rules that many companies must follow every single day.`)),
    ]
    const answers = generateCloze('b', blocks).map((q) => q.options[q.answer])
    expect(answers.filter((a) => a === 'Privacy Act')).toHaveLength(4)
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
