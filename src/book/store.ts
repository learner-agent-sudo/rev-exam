import { db, type BlockRow, type BookRow, type RevExamDB } from '../db/db'
import { parseEpub, type ParseProgress } from './epub'

export interface ImportSource {
  name: string
  arrayBuffer(): Promise<ArrayBuffer>
}

export async function importBook(
  file: ImportSource,
  onProgress?: (progress: ParseProgress) => void,
  database: RevExamDB = db,
): Promise<BookRow> {
  const parsed = await parseEpub(await file.arrayBuffer(), onProgress)
  const book: BookRow = {
    id: crypto.randomUUID(),
    title: parsed.title,
    author: parsed.author,
    language: parsed.language,
    fileName: file.name,
    importedAt: Date.now(),
    blockCount: parsed.blocks.length,
    passageCount: parsed.blocks.filter((b) => b.kind !== 'heading').length,
    hasPageNumbers: parsed.hasPageNumbers,
    toc: parsed.toc,
  }
  await database.transaction('rw', database.books, database.blocks, async () => {
    await database.books.add(book)
    await database.blocks.bulkAdd(parsed.blocks.map((block) => ({ ...block, bookId: book.id })))
  })
  return book
}

export async function listBooks(database: RevExamDB = db): Promise<BookRow[]> {
  return database.books.orderBy('importedAt').toArray()
}

export async function getBook(id: string, database: RevExamDB = db): Promise<BookRow | undefined> {
  return database.books.get(id)
}

export async function deleteBook(id: string, database: RevExamDB = db): Promise<void> {
  await database.transaction('rw', database.books, database.blocks, async () => {
    await database.blocks.where('bookId').equals(id).delete()
    await database.books.delete(id)
  })
}

export async function rememberPosition(id: string, index: number, database: RevExamDB = db): Promise<void> {
  await database.books.update(id, { lastReadIndex: index })
}

/** Blocks with start <= index < end, in reading order. */
export async function loadBlocks(bookId: string, start: number, end: number, database: RevExamDB = db) {
  return database.blocks.where('[bookId+index]').between([bookId, start], [bookId, end]).toArray()
}

export interface SearchResult {
  hits: BlockRow[]
  more: boolean
}

/** Case-insensitive text search across all imported books, in reading order. */
export async function searchBooks(query: string, limit = 50, database: RevExamDB = db): Promise<SearchResult> {
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return { hits: [], more: false }
  const hits = await database.blocks
    .filter((block) => block.text.toLowerCase().includes(needle))
    .limit(limit + 1)
    .toArray()
  return { hits: hits.slice(0, limit), more: hits.length > limit }
}
