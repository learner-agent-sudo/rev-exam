import type { BlockRow, QuestionRow } from '../db/db'
import { hashString, seededRandom, shuffle } from './random'
import { chapterOf, isStudyPassage } from './sections'
import { splitSentences } from './sentences'

// Fill-in-the-blank questions made without AI: take a sentence from the book,
// blank out a key term (a law, agency, acronym, year or number) and offer three
// other terms of the same kind from the same book as wrong options.

export type TermKind = 'law' | 'agency' | 'acronym' | 'year' | 'number'

export interface Term {
  kind: TermKind
  text: string
  /** Comparison key: lower case, without a leading "the" or plural "s". */
  key: string
  /** For numbers: the unit ("day", "%", "$"...), so options stay comparable. */
  unit?: string
}

const KIND_WEIGHT: Record<TermKind, number> = { law: 3, agency: 3, acronym: 2, year: 2, number: 2 }

const CONNECT = "(?:of|and|for|the|on|in|to|&)"
const CAP = "[A-Z][A-Za-z'’.-]*"
const NAME = `(?:${CAP}\\s+(?:${CONNECT}\\s+)*)`
const LAW = new RegExp(`\\b${NAME}{1,9}(?:Act|Rule|Regulation|Directive|Amendment|Shield|Framework|Principles)\\b`, 'g')
// Two patterns, run separately so "The Department" cannot hide "Department of Health and Human Services".
const AGENCIES = [
  new RegExp(`\\b${NAME}{1,6}(?:Commission|Bureau|Agency|Administration|Board|Department|Office|Court|Authority|Council)\\b`, 'g'),
  new RegExp(`\\b(?:Department|Office|Bureau) of (?:the )?${CAP}(?:\\s+(?:${CONNECT}\\s+)*${CAP})*\\b`, 'g'),
]
const ACRONYM = /\b[A-Z][A-Z0-9&]{1,7}s?\b/g
const YEAR = /\b(?:1[89]\d\d|20[0-4]\d)\b/g
const NUMBER =
  /(\$\s?)?\b(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\b(\s?(?:%|percent|days?|months?|years?|hours?|minutes?|million|billion|employees|people|individuals|records|consumers))?/g

const LEADING_WORDS = /^(?:The|A|An|This|That|These|Those|Its|Their|Under|In|By|Since|Unlike|Like|Both|Each|Also|Only|When|While|After|Before|Although|However|Because|If|As|For|Of|And|To|On|the|of|and|for|to|on|in)\s+/
const NOT_ACRONYMS = new Set(['I', 'A', 'US', 'USA', 'OK', 'AM', 'PM', 'TV', 'ID', 'IT', 'ISBN', 'PDF', 'URL', 'HTML', 'NOTE', 'TIP'])
const NUMBER_CUE = /(?:under|over|than|age|aged|least|within|to|up|about|approximately|nearly)\s+$/i
const CITATION_CUE = /(?:Section|Sec\.|Title|Part|Chapter|Article|Art\.|§|No\.|Vol\.|p\.|pp\.)\s*$/

function stripLeading(text: string): string {
  let out = text.trim()
  for (let prev = ''; prev !== out; ) {
    prev = out
    out = out.replace(LEADING_WORDS, '')
  }
  return out
}

function keyOf(text: string): string {
  return text.toLowerCase().replace(/^the\s+/, '').replace(/’/g, "'").replace(/(?<=[a-z0-9])s$/, '')
}

function normalizeUnit(raw: string | undefined, dollar: boolean): string {
  if (dollar) return '$'
  const unit = (raw ?? '').trim().toLowerCase()
  if (!unit) return 'bare'
  if (unit === 'percent') return '%'
  return unit.replace(/s$/, '')
}

interface Found extends Term {
  start: number
  end: number
}

/** Finds candidate terms in a sentence. Overlaps are resolved in favour of the longer match. */
export function findTerms(sentence: string): Term[] {
  const found: Found[] = []
  const add = (kind: TermKind, raw: string, index: number, unit?: string) => {
    const text = kind === 'law' || kind === 'agency' ? stripLeading(raw) : raw
    const start = index + raw.length - text.length
    if ((kind === 'law' || kind === 'agency') && text.split(/\s+/).length < 2) return
    found.push({ kind, text, key: keyOf(text), start, end: start + text.length, ...(unit ? { unit } : {}) })
  }

  for (const m of sentence.matchAll(LAW)) add('law', m[0], m.index)
  for (const pattern of AGENCIES) for (const m of sentence.matchAll(pattern)) add('agency', m[0], m.index)
  for (const m of sentence.matchAll(ACRONYM)) {
    const word = m[0]
    if (NOT_ACRONYMS.has(word) || /^[IVXLCDM]+$/.test(word) || /^\d/.test(word)) continue
    if (!/[A-Z].*[A-Z]/.test(word)) continue
    add('acronym', word, m.index)
  }
  for (const m of sentence.matchAll(YEAR)) add('year', m[0], m.index)
  for (const m of sentence.matchAll(NUMBER)) {
    const [whole, dollar, digits, unitText] = m
    const before = sentence.slice(0, m.index)
    if (CITATION_CUE.test(before)) continue
    const value = Number(digits.replace(/,/g, ''))
    const isYear = /^(?:1[89]\d\d|20[0-4]\d)$/.test(digits) && !dollar && !unitText
    if (isYear || value < 2) continue
    if (!dollar && !unitText && !NUMBER_CUE.test(before)) continue
    add('number', whole.trim(), m.index, normalizeUnit(unitText, Boolean(dollar)))
  }

  // Keep the longest of any overlapping matches ("FTC Act" beats "FTC").
  found.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)
  const kept: Found[] = []
  for (const term of found) {
    if (kept.some((k) => term.start < k.end && k.start < term.end)) continue
    kept.push(term)
  }
  return kept.sort((a, b) => a.start - b.start).map(({ kind, text, key, unit }) => ({ kind, text, key, ...(unit ? { unit } : {}) }))
}

function eligibleSentence(sentence: string): boolean {
  if (sentence.length < 40 || sentence.length > 350) return false
  if (sentence.split(/\s+/).length < 7) return false
  if (/:$/.test(sentence)) return false
  const letters = sentence.replace(/[^A-Za-z]/g, '')
  if (letters.length && sentence.replace(/[^A-Z]/g, '').length / letters.length > 0.6) return false
  if (sentence.replace(/[^0-9]/g, '').length / sentence.length > 0.2) return false
  return true
}

function eligibleBlock(block: BlockRow): boolean {
  return (block.kind === 'paragraph' || block.kind === 'list-item') && isStudyPassage(block)
}

const poolKey = (term: Term) => (term.kind === 'number' ? `number:${term.unit}` : term.kind)

function related(a: string, b: string): boolean {
  return a === b || a.includes(b) || b.includes(a)
}

export interface ClozeOptions {
  /** Most questions taken from one passage. */
  perPassage?: number
  now?: number
}

export function generateCloze(bookId: string, blocks: BlockRow[], options: ClozeOptions = {}): QuestionRow[] {
  const { perPassage = 2, now = Date.now() } = options

  // 1. Every candidate sentence and its terms, plus a pool of terms by kind for wrong options.
  const candidates: { block: BlockRow; sentence: string; terms: Term[]; chapter: string }[] = []
  const pools = new Map<string, Map<string, { term: Term; chapters: Set<string> }>>()
  for (const block of blocks) {
    if (!eligibleBlock(block)) continue
    const chapter = chapterOf(block)
    for (const sentence of splitSentences(block.text)) {
      if (!eligibleSentence(sentence)) continue
      const terms = findTerms(sentence)
      if (!terms.length) continue
      candidates.push({ block, sentence, terms, chapter })
      for (const term of terms) {
        const pool = pools.get(poolKey(term)) ?? new Map()
        pools.set(poolKey(term), pool)
        const entry = pool.get(term.key) ?? { term, chapters: new Set<string>() }
        entry.chapters.add(chapter)
        pool.set(term.key, entry)
      }
    }
  }

  // 2. For each sentence, blank one term that has three good wrong options.
  const questions: QuestionRow[] = []
  const perBlock = new Map<number, number>()
  for (const { block, sentence, terms, chapter } of candidates) {
    if ((perBlock.get(block.index) ?? 0) >= perPassage) continue
    const lowerSentence = sentence.toLowerCase()
    const sentenceSeed = hashString(`${bookId}|${block.index}|${sentence}`)

    const viable: { term: Term; wrong: Term[]; stem: string }[] = []
    for (const term of terms) {
      // An acronym spelled out in the same sentence gives itself away.
      if (term.kind === 'acronym' && lowerSentence.includes(`(${term.text.toLowerCase()})`)) continue
      if (term.text.length > sentence.length / 2) continue

      const random = seededRandom(sentenceSeed ^ hashString(term.text))
      const pool = [...(pools.get(poolKey(term))?.values() ?? [])].filter(
        ({ term: other }) => !related(other.key, term.key) && !lowerSentence.includes(other.text.toLowerCase()),
      )
      // Prefer wrong options from the same chapter: they are more plausible.
      const sameChapter = shuffle(pool.filter((p) => p.chapters.has(chapter)), random)
      const elsewhere = shuffle(pool.filter((p) => !p.chapters.has(chapter)), random)
      const wrong: Term[] = []
      for (const { term: other } of [...sameChapter, ...elsewhere]) {
        if (wrong.some((w) => related(w.key, other.key))) continue
        wrong.push(other)
        if (wrong.length === 3) break
      }
      if (wrong.length < 3) continue

      // Blank whole-term occurrences only ("13" must not cut into "2013").
      const escaped = term.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const stem = sentence.replace(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'g'), '_____')
      if (stem !== sentence) viable.push({ term, wrong, stem })
    }
    if (!viable.length) continue

    // Mix question types across the book, leaning towards laws and agencies.
    const weights = viable.map((v) => KIND_WEIGHT[v.term.kind])
    let pick = seededRandom(sentenceSeed)() * weights.reduce((a, b) => a + b, 0)
    const chosen = viable.find((_, i) => (pick -= weights[i]) < 0) ?? viable[0]

    questions.push({
      id: `cloze-${hashString(`${bookId}|${block.index}|${sentence}|${chosen.term.text}`).toString(36)}`,
      bookId,
      source: 'cloze',
      stem: chosen.stem,
      options: [chosen.term.text, ...chosen.wrong.map((w) => w.text)],
      answer: 0,
      blockIndexes: [block.index],
      quote: sentence,
      chapter,
      createdAt: now,
    })
    perBlock.set(block.index, (perBlock.get(block.index) ?? 0) + 1)
  }
  return questions
}
