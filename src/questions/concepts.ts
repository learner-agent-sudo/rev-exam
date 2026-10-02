import type { BlockRow, QuestionRow } from '../db/db'
import { hashString, seededRandom, shuffle } from './random'
import { chapterOf, isStudyPassage } from './sections'
import { splitSentences } from './sentences'

// Concept questions made without AI, from two patterns textbooks use for ideas:
//
// 1. Definitions — "Data minimization is the practice of …", "X refers to …", and
//    glossary entries ("Term. Definition."). Asked both ways: "Which best describes X?"
//    (wrong options are other concepts' definitions) and "Which term means …?".
// 2. What a law or agency does — "The GLBA requires financial institutions to …".
//    Asked as "Which law requires financial institutions to …?".
//
// Every wrong option is explained ("This describes …"), so a wrong answer still teaches.

export type ConceptStyle = 'define' | 'term' | 'law'

export interface Definition {
  term: string
  key: string
  definition: string
  block: BlockRow
  sentence: string
  chapter: string
}

export interface Entity {
  name: string
  acronym?: string
  kind: 'law' | 'agency'
  key: string
}

export interface Duty {
  entity: Entity
  /** Question stem without the law, e.g. "requires financial institutions to …". */
  predicate: string
  /** "Under the GLBA, …" sentences are asked as "Which law is this?". */
  under: boolean
  block: BlockRow
  sentence: string
  chapter: string
}

// ---------- Laws and agencies ----------

const CONNECT = '(?:of|and|for|the|on|in|to|&)'
const CAP = "[A-Z][A-Za-z'’.-]*"
const NAME = `(?:${CAP}\\s+(?:${CONNECT}\\s+)*)`
const LAW = new RegExp(`\\b${NAME}{1,9}(?:Act|Rule|Regulation|Directive|Amendment|Shield|Framework)\\b`, 'g')
const AGENCIES = [
  new RegExp(`\\b${NAME}{1,6}(?:Commission|Bureau|Agency|Administration|Board|Department|Office|Authority|Council)\\b`, 'g'),
  new RegExp(`\\b(?:Department|Office|Bureau) of (?:the )?${CAP}(?:\\s+(?:${CONNECT}\\s+)*${CAP})*\\b`, 'g'),
]
const LEADING =
  /^(?:The|A|An|This|That|These|Those|Its|Their|Under|In|By|Since|Unlike|Like|Both|Each|Also|Only|When|While|After|Before|Although|However|Because|If|As|For|Of|And|To|On|the|of|and|for|to|on|in)\s+/

function stripLeading(text: string): string {
  let out = text.trim()
  for (let prev = ''; prev !== out; ) {
    prev = out
    out = out.replace(LEADING, '')
  }
  return out
}

const keyOf = (text: string) => text.toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ').trim()
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Laws and agencies named in the text, with acronyms from "Full Name (ACRONYM)". */
export function findEntities(sentences: string[]): Map<string, Entity> {
  const entities = new Map<string, Entity>()
  const add = (raw: string, kind: Entity['kind']) => {
    const name = stripLeading(raw)
    if (name.split(/\s+/).length < 2) return undefined
    const key = keyOf(name)
    const entity = entities.get(key) ?? { name, kind, key }
    entities.set(key, entity)
    return entity
  }
  for (const sentence of sentences) {
    for (const [pattern, kind] of [[LAW, 'law'], ...AGENCIES.map((a) => [a, 'agency'])] as [RegExp, Entity['kind']][]) {
      for (const m of sentence.matchAll(pattern)) {
        const entity = add(m[0], kind)
        const acronym = /^\s*\(([A-Z][A-Z0-9&]{1,7})\)/.exec(sentence.slice(m.index + m[0].length))?.[1]
        if (entity && acronym) entity.acronym ??= acronym
      }
    }
  }
  // An agency name inside a law name ("Federal Trade Commission Act") is not a separate agency mention.
  return entities
}

export function displayName(entity: Entity): string {
  return entity.acronym ? `${entity.name} (${entity.acronym})` : entity.name
}

const DUTY_VERBS = [
  'requires', 'required', 'prohibits', 'prohibited', 'bans', 'banned', 'restricts', 'restricted', 'limits', 'limited',
  'regulates', 'regulated', 'governs', 'governed', 'covers', 'covered', 'applies to', 'applied to', 'protects',
  'protected', 'gives', 'gave', 'grants', 'granted', 'allows', 'allowed', 'permits', 'permitted', 'mandates',
  'mandated', 'imposes', 'imposed', 'establishes', 'established', 'creates', 'created', 'preempts', 'preempted',
  'enforces', 'enforced', 'oversees', 'oversaw', 'defines', 'defined', 'sets out', 'focuses on', 'addresses',
  'obligates', 'directs', 'authorizes', 'authorized', 'amends', 'amended', 'provides', 'provided', 'guarantees',
  'exempts', 'brings', 'investigates', 'issues', 'issued', 'administers', 'expanded', 'expands', 'introduced',
]
const VERB_PATTERN = DUTY_VERBS.map(escape).join('|')
const ADVERB = /^(?:also|generally|specifically|now|still|further|explicitly|expressly|primarily|broadly)\s+/
// "was enacted in 1970 to regulate …" / "was enacted in 1974 and protects …"
const ENACTED = /^(?:was|were) (?:enacted|passed|adopted|signed into law|created|established)(?: in \d{4})?(?:\s+(and|to)\s+(.+))?$/

/** A sentence that says what a known law or agency does, or undefined. */
export function findDuty(block: BlockRow, sentence: string, entities: Entity[], chapter: string): Duty | undefined {
  const text = sentence.replace(/[.]$/, '')
  for (const entity of entities) {
    const names = [escape(entity.name), ...(entity.acronym ? [escape(entity.acronym)] : [])].join('|')
    const acronym = entity.acronym ? `(?:\\s*\\(${escape(entity.acronym)}\\))?` : ''

    let predicate: string | undefined
    const under = new RegExp(`^Under (?:the )?(?:${names})\\b${acronym},\\s+(.+)$`).exec(text)
    if (under) {
      predicate = under[1]
    } else {
      const direct = new RegExp(`^(?:The\\s+)?(?:${names})\\b${acronym}(?:,\\s+[^,]{3,90},)?\\s+(.+)$`).exec(text)
      if (!direct) continue
      let rest = direct[1]
      const enacted = ENACTED.exec(rest)
      if (enacted) {
        if (enacted[1] === 'to') predicate = `was enacted to ${enacted[2]}`
        else if (enacted[1] === 'and') rest = enacted[2]
        else return undefined
      }
      if (!predicate) {
        rest = rest.replace(ADVERB, '')
        if (!new RegExp(`^(?:${VERB_PATTERN})\\b`).test(rest)) return undefined
        predicate = rest
      }
    }

    const words = predicate.split(/\s+/).length
    if (words < 4 || words > 40) return undefined
    // The answer must not appear in its own question.
    if (new RegExp(`\\b(?:${names})\\b`, 'i').test(predicate)) return undefined
    return { entity, predicate: predicate.replace(/[.;:,]+$/, ''), under: Boolean(under), block, sentence, chapter }
  }
  return undefined
}

// ---------- Definitions ----------

const NOT_TERMS = new Set(
  (
    'it this that these those they there here such our your my his her their its some many most all each every both ' +
    'one another what which who how why when if and but or so also including using knowing following framing result ' +
    'goal problem answer key point question challenge difference reason idea way thing issue case focus fact example ' +
    'rest first second next last other others same following above below chapter section book guide figure table note ' +
    // Sentence openers that are not the thing being defined ("For he never …", "Although there …").
    'for from although though yet nor much in on at with without after before because since while whereas thus hence ' +
    'therefore perhaps even never about approximately nearly over under few several'
  ).split(' '),
)
// "X is a difficult concept" or "X is the friend of Y" are opinions, not definitions.
const EVALUATIVE = new Set(
  (
    'difficult easy good great bad important crucial critical key major big simple complex highly very bit lot friend ' +
    'failing bright best worst real tricky matter question problem challenge way thing issue case focus first last ' +
    'little long short better worse common popular natural obvious perfect poor strong weak huge small nice useful ' +
    'answer solution must-read following'
  ).split(' '),
)
const GLOSSARY_SECTION = /glossary|terminology|definitions|key terms|vocabulary/i
// Forewords and prefaces describe people and the book itself, not concepts to learn.
const NOT_CONCEPT_SECTION = /^(?:foreword|preface|introduction to this (?:book|edition)|about this book)/i

function cleanDefinition(text: string): string {
  const firstSentence = splitSentences(text.replace(/\bSee also [^.]+\.\s*/g, '').trim())[0] ?? ''
  let tidy = firstSentence.replace(/^(?:defined as|known as)\s+/i, '').replace(/[.;:]+$/, '').trim()
  // A sentence split inside brackets leaves "… circle (Books": drop the unfinished aside.
  const open = tidy.lastIndexOf('(')
  if (open > 0 && tidy.indexOf(')', open) < 0) tidy = tidy.slice(0, open).replace(/[\s,;:]+$/, '')
  return tidy.charAt(0).toUpperCase() + tidy.slice(1)
}

function plausibleTerm(term: string): boolean {
  const words = term.split(/\s+/)
  if (words.length < 1 || words.length > 6 || term.length < 3) return false
  if (NOT_TERMS.has(words[0].toLowerCase())) return false
  if (/[,;:?!<>=“”"]|\d|percent/.test(term)) return false
  // "EPUB defines a" is half a sentence, not a term.
  if (/^(?:a|an|the|of|to|and|or|is|are)$/i.test(words[words.length - 1])) return false
  if (/\b(?:whether|that|which|who|if|when|you|your|we|our|I)\b/.test(term)) return false
  if (/ing$/i.test(words[0]) && words.length > 1 && /^(?:a|an|the|every|each|your|our)$/i.test(words[1])) return false
  return true
}

function plausibleDefinition(definition: string): boolean {
  const words = definition.split(/\s+/)
  if (words.length < 5 || words.length > 45) return false
  // Dialogue and code are not definitions.
  if (/[!?]|[,.]["”’](?:\s|$)|["”’][,.]?\s+(?:said|cried|interrupted|asked|replied)|[<>{}=]/.test(definition)) return false
  // "The following example shows …", "this specification does not …" describe the book itself.
  if (/^(?:the following|this (?:specification|section|chapter|book|guide|document)|for example|see\b)/i.test(definition)) return false
  if (/\b(?:I|I’m|I'm|you|your|we|our)\b/.test(definition)) return false
  return true
}

/** Words right after "is"/"are" that mean a description, not a definition ("is often used"). */
const NOT_DEFINING = /^(?:not|also|sometimes|always|never|rarely|frequently|generally|mostly|largely|simply|actually|really|probably|certainly|clearly|increasingly|rather|quite|fairly|pretty|somewhat|relatively|particularly|especially|extremely|incredibly|almost|nearly|entirely|fully|often|usually|typically|very|so|too|more|less|still|just|only|now|being|then|already|likely|unlikely|able|unable|important|necessary|required|available|possible|used|based|essential|subject|responsible|considered|expected|designed|meant|intended|known for)\b/

/** "X is/are a …", "X is any …", "Cookies are small files that …", "X refers to/means …". */
export function definitionInSentence(sentence: string): { term: string; definition: string } | undefined {
  if (/^["“‘']|[!?]/.test(sentence)) return undefined // Dialogue and questions.
  const m =
    /^(?:The (?:term|phrase|concept of) )?["“]?(?:(?:A|An|The) )?([A-Za-z][\w’'()/ -]{1,60}?)["”]?(?:\s*\([A-Z][A-Z0-9&]{1,7}\))?,?\s+(is|are|refers to|means|is defined as|denotes)\s+(.+?)[.]?$/.exec(
      sentence,
    )
  if (!m) return undefined
  const term = m[1].trim()
  // "is defined as …" is explicit, so it skips the checks for plain "is".
  const explicit = /^defined as\s+/.test(m[3])
  const definition = m[3].replace(/^defined as\s+/, '').trim()
  if ((m[2] === 'is' || m[2] === 'are') && !explicit) {
    if (NOT_DEFINING.test(definition)) return undefined
    const article = /^(?:a|an|the|any|one of the|one of)\s+(\S+)/.exec(definition)
    if (article) {
      // "a difficult concept", "the friend of …" are opinions, not definitions.
      if (EVALUATIVE.has(article[1].toLowerCase().replace(/\W/g, ''))) return undefined
    } else if (!/^\S+(?:\s+\S+){0,8}?\s+(?:that|which|who|whose|where)\b/.test(definition)) {
      return undefined // Without an article, only "small files that …" style definitions count.
    }
  } else if (/^that\b/i.test(definition)) {
    return undefined // "X means that …" states a consequence, not a meaning.
  }
  if (!plausibleTerm(term) || !plausibleDefinition(definition)) return undefined
  return { term, definition: cleanDefinition(definition) }
}

/** Glossary entries: "Term. Definition.", "Term: Definition", "Term — Definition". */
export function glossaryEntry(text: string): { term: string; definition: string } | undefined {
  const m = /^([A-Z][^.:—–]{1,60}?)\s*(?:\.|:|—|–| - )\s+(?:See also [^.]+\.\s+)?(.+)$/.exec(text.trim())
  if (!m) return undefined
  const term = m[1].replace(/\s*\([^)]*\)$/, '').trim()
  const definition = cleanDefinition(m[2])
  if (!plausibleTerm(term) || !plausibleDefinition(definition)) return undefined
  return { term, definition }
}

// ---------- Questions ----------

export interface ConceptOptions {
  /** Most questions about the same law or agency. */
  perAnswer?: number
  now?: number
}

function related(a: string, b: string): boolean {
  return a === b || a.includes(b) || b.includes(a)
}

function countIn(corpus: string, phrase: string): number {
  let count = 0
  for (let at = corpus.indexOf(phrase); at >= 0; at = corpus.indexOf(phrase, at + phrase.length)) count++
  return count
}

const lowerFirst = (text: string) => (/^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text)

export function generateConcepts(bookId: string, blocks: BlockRow[], options: ConceptOptions = {}): QuestionRow[] {
  const { perAnswer = 4, now = Date.now() } = options
  const study = blocks.filter((b) => (b.kind === 'paragraph' || b.kind === 'list-item') && isStudyPassage(b))
  const sentencesOf = new Map(study.map((b) => [b.index, splitSentences(b.text)]))
  const corpus = study.map((b) => b.text.toLowerCase()).join('\n')

  // 1. Definitions, one per term (the first in reading order).
  const definitions = new Map<string, Definition>()
  const addDefinition = (found: { term: string; definition: string } | undefined, block: BlockRow, sentence: string, glossary: boolean) => {
    if (!found) return
    const key = keyOf(found.term)
    if (definitions.has(key) || found.definition.toLowerCase().includes(key)) return
    // Outside a glossary, a real concept is mentioned again somewhere else in the book.
    if (!glossary && countIn(corpus, key) < 2) return
    definitions.set(key, { term: found.term, key, definition: found.definition, block, sentence, chapter: chapterOf(block) })
  }
  study.forEach((block, i) => {
    const glossary = block.path.some((p) => GLOSSARY_SECTION.test(p))
    if (glossary) {
      const entry = glossaryEntry(block.text)
      if (entry) return addDefinition(entry, block, block.text, true)
      // <dt>Term</dt><dd>Definition</dd> arrive as a short block followed by its definition.
      const next = study[i + 1]
      if (next && next.index === block.index + 1 && !/[.!?]$/.test(block.text) && block.text.split(/\s+/).length <= 6) {
        const definition = cleanDefinition(next.text)
        if (plausibleTerm(block.text) && plausibleDefinition(definition)) {
          addDefinition({ term: block.text, definition }, next, next.text, true)
        }
      }
      return
    }
    if (NOT_CONCEPT_SECTION.test(chapterOf(block))) return
    for (const sentence of sentencesOf.get(block.index) ?? []) addDefinition(definitionInSentence(sentence), block, sentence, false)
  })

  // 2. Laws and agencies, and sentences saying what they do.
  const entityMap = findEntities([...sentencesOf.values()].flat())
  const entities = [...entityMap.values()].sort((a, b) => b.name.length - a.name.length)
  const duties: Duty[] = []
  for (const block of study) {
    for (const sentence of sentencesOf.get(block.index) ?? []) {
      const duty = findDuty(block, sentence, entities, chapterOf(block))
      if (duty) duties.push(duty)
    }
  }

  const questions: QuestionRow[] = []

  // Definition questions.
  const defList = [...definitions.values()]
  for (const def of defList) {
    const seed = hashString(`${bookId}|define|${def.key}`)
    const random = seededRandom(seed)
    const others = defList.filter(
      (o) => !related(o.key, def.key) && !o.definition.toLowerCase().includes(def.key) && o.definition !== def.definition,
    )
    // Similar-length options from the same chapter, so length is not a giveaway.
    const ranked = [...others].sort(
      (a, b) =>
        Number(b.chapter === def.chapter) - Number(a.chapter === def.chapter) ||
        Math.abs(a.definition.length - def.definition.length) - Math.abs(b.definition.length - def.definition.length),
    )
    const wrong = shuffle(ranked.slice(0, 6), random).slice(0, 3)
    if (wrong.length < 3) continue

    const askTerm = random() < 0.5
    questions.push({
      id: `concept-${seed.toString(36)}`,
      bookId,
      source: 'cloze',
      style: askTerm ? 'term' : 'define',
      stem: askTerm
        ? `Which term does the book describe as “${lowerFirst(def.definition)}”?`
        : `Which of the following best describes “${def.term}”?`,
      options: askTerm ? [def.term, ...wrong.map((w) => w.term)] : [def.definition, ...wrong.map((w) => w.definition)],
      answer: 0,
      explanations: askTerm
        ? [`This is how the book describes “${def.term}”.`, ...wrong.map((w) => `“${w.term}” means: ${lowerFirst(w.definition)}.`)]
        : [`This is how the book describes “${def.term}”.`, ...wrong.map((w) => `This describes “${w.term}”.`)],
      blockIndexes: [def.block.index],
      quote: def.sentence,
      chapter: def.chapter,
      createdAt: now,
    })
  }

  // "Which law …?" questions.
  const firstDuty = new Map<string, Duty>()
  for (const duty of duties) if (!firstDuty.has(duty.entity.key)) firstDuty.set(duty.entity.key, duty)
  const used = new Map<string, number>()
  for (const duty of duties) {
    if ((used.get(duty.entity.key) ?? 0) >= perAnswer) continue
    const seed = hashString(`${bookId}|law|${duty.block.index}|${duty.sentence}`)
    const random = seededRandom(seed)
    const pool = entities.filter(
      (e) => e.kind === duty.entity.kind && !related(e.key, duty.entity.key) && !duty.sentence.toLowerCase().includes(e.key),
    )
    const ranked = [
      ...shuffle(pool.filter((e) => firstDuty.get(e.key)?.chapter === duty.chapter), random),
      ...shuffle(pool.filter((e) => firstDuty.get(e.key)?.chapter !== duty.chapter), random),
    ]
    const wrong: Entity[] = []
    for (const e of ranked) {
      if (wrong.some((w) => related(w.key, e.key))) continue
      wrong.push(e)
      if (wrong.length === 3) break
    }
    if (wrong.length < 3) continue

    const kind = duty.entity.kind
    const explain = (e: Entity) => {
      const known = firstDuty.get(e.key)
      if (!known) return `The book does not describe this ${kind} here.`
      return known.under
        ? `Under ${displayName(e)}, ${lowerFirst(known.predicate)}.`
        : `${displayName(e)} ${known.predicate}.`
    }
    questions.push({
      id: `concept-${seed.toString(36)}`,
      bookId,
      source: 'cloze',
      style: 'law',
      stem: duty.under
        ? `Which ${kind} is this? “Under this ${kind}, ${lowerFirst(duty.predicate)}.”`
        : `Which ${kind} ${duty.predicate}?`,
      options: [displayName(duty.entity), ...wrong.map(displayName)],
      answer: 0,
      explanations: [`This is the ${kind} the book describes here.`, ...wrong.map(explain)],
      blockIndexes: [duty.block.index],
      quote: duty.sentence,
      chapter: duty.chapter,
      createdAt: now,
    })
    used.set(duty.entity.key, (used.get(duty.entity.key) ?? 0) + 1)
  }

  return questions
}
