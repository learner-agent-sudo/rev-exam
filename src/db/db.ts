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

// All study data lives in the browser's IndexedDB on this device.
export class RevExamDB extends Dexie {
  settings!: EntityTable<SettingRow, 'key'>
  books!: EntityTable<BookRow, 'id'>
  blocks!: Dexie.Table<BlockRow, [string, number]>

  constructor(name = 'rev-exam') {
    super(name)
    this.version(1).stores({
      settings: 'key',
    })
    this.version(2).stores({
      books: 'id, importedAt',
      blocks: '[bookId+index], bookId',
    })
  }
}

export const db = new RevExamDB()
