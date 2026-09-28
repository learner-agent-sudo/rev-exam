export type BlockKind = 'heading' | 'paragraph' | 'list-item' | 'table'

/** One piece of the book in reading order: a heading, paragraph, list item or table. */
export interface Block {
  index: number
  kind: BlockKind
  /** Exact text as it appears in the book (whitespace tidied). */
  text: string
  /** Where it sits: chapter › section › subsection. */
  path: string[]
  /** Print page label, only when the EPUB includes page markers. */
  page?: string
  /** Heading depth, 1 = top. Only for headings. */
  level?: number
  /** Cell text for tables. */
  rows?: string[][]
}

export interface TocEntry {
  title: string
  depth: number
  /** First block of this entry; undefined if it could not be located. */
  blockIndex?: number
}

export interface ParsedBook {
  title: string
  author?: string
  language?: string
  toc: TocEntry[]
  blocks: Block[]
  hasPageNumbers: boolean
}
