import Dexie, { type EntityTable } from 'dexie'
import type { Block, TocEntry } from '../book/types'

export interface SettingRow {
  key: string
  value: unknown
}

export interface BookRow {
  id: string
  title: string
  author?: string
  language?: string
  fileName: string
  importedAt: number
  blockCount: number
  /** Blocks that are not headings: paragraphs, list items, tables. */
  passageCount: number
  hasPageNumbers: boolean
  toc: TocEntry[]
  /** Where the reader was last opened, for "Continue reading". */
  lastReadIndex?: number
}

export interface BlockRow extends Block {
  bookId: string
}

export type QuestionSource = 'cloze' | 'ai'

export interface QuestionRow {
  id: string
  bookId: string
  /** 'cloze' = concept check made without AI (the name is kept for stored data); 'ai' = written by Gemini. */
  source: QuestionSource
  /** For no-AI questions: which pattern made it (a definition asked either way, or what a law does). */
  style?: 'define' | 'term' | 'law'
  stem: string
  /** Four options; `answer` is the index of the correct one. Shuffled when shown. */
  options: string[]
  answer: number
  /** Why each option is right or wrong. */
  explanations?: string[]
  /** Book passages that back the answer (block indexes). */
  blockIndexes: number[]
  /** For fill-in-the-blank: the exact sentence from the book, highlighted in feedback. */
  quote?: string
  /** First part of the passage's location, used to filter by chapter. */
  chapter: string
  /** Which slice of the book an AI question came from, so generation can resume. */
  chunk?: string
  model?: string
  createdAt: number
  flagged?: boolean
  /** When the flag was last set or cleared, so the newest change wins when devices merge. */
  flaggedAt?: number
}

/** One answer given. Only ever added, never changed, so devices can merge them when syncing. */
export interface AttemptRow {
  id: string
  questionId: string
  bookId: string
  chosen: number
  correct: boolean
  at: number
}

// All study data lives in the browser's IndexedDB on this device.
export class RevExamDB extends Dexie {
  settings!: EntityTable<SettingRow, 'key'>
  books!: EntityTable<BookRow, 'id'>
  blocks!: Dexie.Table<BlockRow, [string, number]>
  questions!: EntityTable<QuestionRow, 'id'>
  attempts!: EntityTable<AttemptRow, 'id'>

  constructor(name = 'rev-exam') {
    super(name)
    this.version(1).stores({
      settings: 'key',
    })
    this.version(2).stores({
      books: 'id, importedAt',
      blocks: '[bookId+index], bookId',
    })
    this.version(3).stores({
      questions: 'id, bookId, [bookId+source]',
      attempts: 'id, questionId, bookId, at',
    })
  }
}

export const db = new RevExamDB()
