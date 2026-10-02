// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parseEpub } from '../book/epub'
import { makeEpub, sampleLawsHandbook } from '../book/testing/makeEpub'
import type { BlockRow } from '../db/db'
import { definitionInSentence, generateConcepts, glossaryEntry } from './concepts'

describe('definitionInSentence', () => {
  it.each([
    ['Usability is the ability of a reader to access the content on any given reading system.', 'Usability', 'The ability of a reader to access the content on any given reading system'],
    ['Personal information is any information that relates to an identified or identifiable individual.', 'Personal information', 'Any information that relates to an identified or identifiable individual'],
    ['A data breach is an incident in which personal information is accessed without authorization.', 'data breach', 'An incident in which personal information is accessed without authorization'],
    ['Cookies are small text files that websites store on a visitor’s device.', 'Cookies', 'Small text files that websites store on a visitor’s device'],
    ['Privacy by Design refers to building privacy protections into products from the start.', 'Privacy by Design', 'Building privacy protections into products from the start'],
    ['The term personal data is defined as information relating to an identified natural person.', 'personal data', 'Information relating to an identified natural person'],
  ])('finds the definition in: %s', (sentence, term, definition) => {
    expect(definitionInSentence(sentence)).toEqual({ term, definition })
  })

  it.each([
    'Accessibility is a difficult concept to define.',
    'Standards and conventions are the friend of accessibility.',
    'Layout is a highly technical process, and it is also idiosyncratic.',
    'Principles are not laws on their own in most places.',
    'It means something different depending on your needs.',
    'The cascading nature of styles means that the declaration closest to the element wins.',
    'Using a div instead of an aside element means a reading system will not know it can skip.',
    'This guide is a practical introduction to accessible publishing for everyone.',
    'Notice is required before any information about consumers is collected.',
    'EPUB defines a means of representing, packaging and encoding structured Web content.',
    'Examples are the following example shows a manifest item element for the cover.',
    '“Captain Ahab is the Captain of this ship,” said the old sailor to the boy.',
    'For he never is a man to be trusted with the boats at night.',
  ])('ignores opinions and non-definitions: %s', (sentence) => {
    expect(definitionInSentence(sentence)).toBeUndefined()
  })
})

describe('glossaryEntry', () => {
  it('reads "Term. Definition." entries, dropping cross-references and asides', () => {
    expect(glossaryEntry('Depth of indexing (granularity). See also Exhaustivity. The level of detail in the text that will be picked up in the index.')).toEqual({
      term: 'Depth of indexing',
      definition: 'The level of detail in the text that will be picked up in the index',
    })
    expect(glossaryEntry('Exhaustivity. Inclusion of all relevant material in the index. Exhaustivity, however, must go hand in hand with discrimination.')).toEqual({
      term: 'Exhaustivity',
      definition: 'Inclusion of all relevant material in the index',
    })
    expect(glossaryEntry('Opt-in: A choice model in which information is used only after a person agrees.')?.term).toBe('Opt-in')
  })

  it('ignores lines that are not entries', () => {
    expect(glossaryEntry('See Chapter 4.')).toBeUndefined()
    expect(glossaryEntry('Short. Too short.')).toBeUndefined()
  })
})

describe('generateConcepts', async () => {
  const book = await parseEpub(await makeEpub(sampleLawsHandbook()))
  const blocks: BlockRow[] = book.blocks.map((b) => ({ ...b, bookId: 'b' }))
  const questions = generateConcepts('b', blocks, { now: 1 })
  const definitions = questions.filter((q) => q.style !== 'law')
  const laws = questions.filter((q) => q.style === 'law')

  it('asks about each definition and glossary entry once', () => {
    const terms = definitions.map((q) => (q.style === 'term' ? q.options[q.answer] : /“(.+)”\?$/.exec(q.stem)![1]))
    expect(terms.sort()).toEqual([
      'Consent',
      'Data controller',
      'Data minimization',
      'Data processor',
      'De-identification',
      'Opt-in',
      'Personal information',
      'Privacy by Design',
      'Purpose limitation',
      'data breach',
    ])
  })

  it('asks definitions both ways, explaining every wrong option', () => {
    const define = definitions.find((q) => q.style === 'define')!
    expect(define.stem).toMatch(/^Which of the following best describes “.+”\?$/)
    expect(define.explanations![0]).toMatch(/^This is how the book describes/)
    for (const e of define.explanations!.slice(1)) expect(e).toMatch(/^This describes “.+”\.$/)

    const term = definitions.find((q) => q.style === 'term')!
    expect(term.stem).toMatch(/^Which term does the book describe as “.+”\?$/)
    for (const e of term.explanations!.slice(1)) expect(e).toMatch(/^“.+” means: .+\.$/)
  })

  it('never puts the answer in its own question or options', () => {
    for (const q of definitions) {
      const term = q.style === 'term' ? q.options[q.answer] : /“(.+)”\?$/.exec(q.stem)![1]
      const others = q.style === 'term' ? [q.stem] : q.options
      for (const text of others) expect(text.toLowerCase()).not.toContain(term.toLowerCase())
    }
  })

  it('asks which law does what, from the book’s own sentences', () => {
    expect(laws.map((q) => q.stem).sort()).toEqual([
      'Which law applies to health plans and many health care providers?',
      'Which law is this? “Under this law, financial institutions must protect the security of customer information.”',
      'Which law protects children under 13 years of age?',
      'Which law protects student education records?',
      'Which law requires financial institutions to explain their information-sharing practices?',
      'Which law was enacted to regulate consumer reporting agencies?',
    ])
    const coppa = laws.find((q) => q.stem === 'Which law protects children under 13 years of age?')!
    expect(coppa.options[coppa.answer]).toBe("Children's Online Privacy Protection Act (COPPA)")
    expect(coppa.options).toHaveLength(4)
    expect(new Set(coppa.options).size).toBe(4)
  })

  it('explains wrong laws with what the book says they do', () => {
    const all = laws.flatMap((q) => q.explanations!.slice(1))
    expect(all).toContain('Fair Credit Reporting Act (FCRA) was enacted to regulate consumer reporting agencies.')
    expect(all).toContain('Family Educational Rights and Privacy Act (FERPA) protects student education records.')
  })

  it('points every question at the passage it came from', () => {
    for (const q of questions) expect(blocks[q.blockIndexes[0]].text).toContain(q.quote)
  })

  it('is repeatable, so refreshing keeps answer history', () => {
    expect(generateConcepts('b', blocks, { now: 1 })).toEqual(questions)
  })

  it('needs a definition to be a recurring concept, outside glossaries', () => {
    const lone: BlockRow[] = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((name, index) => ({
      bookId: 'x',
      index,
      kind: 'paragraph',
      path: ['Ch 1'],
      text: `${name} is a method that teams use to plan the work for each week in advance.`,
    }))
    expect(generateConcepts('x', lone)).toEqual([])
  })
})
