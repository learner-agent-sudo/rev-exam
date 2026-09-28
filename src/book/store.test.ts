// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { RevExamDB } from '../db/db'
import { deleteBook, getBook, importBook, listBooks, loadBlocks, rememberPosition, searchBooks } from './store'
import { makeEpub, sampleHandbook } from './testing/makeEpub'

let database: RevExamDB

afterEach(async () => {
  await database.delete()
})

async function importSample() {
  const data = await makeEpub(sampleHandbook())
  return importBook({ name: 'handbook.epub', arrayBuffer: async () => data.slice().buffer }, undefined, database)
}

describe('book store', () => {
  it('imports, reads, searches and deletes a book', async () => {
    database = new RevExamDB('store-test')
    const book = await importSample()

    expect(book).toMatchObject({ title: 'Sample Privacy Handbook', fileName: 'handbook.epub', hasPageNumbers: true })
    expect(await listBooks(database)).toHaveLength(1)

    const first = await loadBlocks(book.id, 0, 3, database)
    expect(first.map((b) => b.index)).toEqual([0, 1, 2])
    expect(first[0]).toMatchObject({ bookId: book.id, kind: 'heading', text: 'Chapter 1. Foundations of Privacy' })

    const { hits, more } = await searchBooks('federal TRADE', 50, database)
    expect(hits.map((h) => h.text)).toEqual([
      'The Federal Trade Commission brings actions against unfair or deceptive practices.',
    ])
    expect(more).toBe(false)
    expect((await searchBooks('a', 50, database)).hits).toEqual([])

    await rememberPosition(book.id, 7, database)
    expect((await getBook(book.id, database))?.lastReadIndex).toBe(7)

    await deleteBook(book.id, database)
    expect(await listBooks(database)).toEqual([])
    expect(await database.blocks.count()).toBe(0)
  })

  it('limits search results and says there are more', async () => {
    database = new RevExamDB('store-test-limit')
    await importSample()
    const { hits, more } = await searchBooks('privacy', 2, database)
    expect(hits).toHaveLength(2)
    expect(more).toBe(true)
  })
})
