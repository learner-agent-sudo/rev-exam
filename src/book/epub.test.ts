// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EpubError, parseEpub, resolvePath } from './epub'
import { makeEpub, sampleHandbook } from './testing/makeEpub'
import type { Block } from './types'

const find = (blocks: Block[], text: string) => {
  const block = blocks.find((b) => b.text === text)
  if (!block) throw new Error(`No block with text: ${text}`)
  return block
}

describe('resolvePath', () => {
  it.each([
    ['OEBPS/content.opf', 'Text/ch%201.xhtml#x', 'OEBPS/Text/ch 1.xhtml'],
    ['OEBPS/Text/a.xhtml', '../Images/b.png', 'OEBPS/Images/b.png'],
    ['OEBPS/Text/a.xhtml', './b.xhtml', 'OEBPS/Text/b.xhtml'],
    ['OEBPS/nav.xhtml', '#frag', 'OEBPS/nav.xhtml'],
    ['a/b.opf', '/root.xhtml', 'root.xhtml'],
  ])('%s + %s -> %s', (from, href, expected) => {
    expect(resolvePath(from, href)).toBe(expected)
  })
})

describe('parseEpub: EPUB 3 book', async () => {
  const book = await parseEpub(await makeEpub(sampleHandbook()))

  it('reads metadata', () => {
    expect(book).toMatchObject({ title: 'Sample Privacy Handbook', author: 'Test Author', language: 'en' })
  })

  it('links contents entries to their headings', () => {
    expect(book.toc.map((t) => [t.title, t.depth, book.blocks[t.blockIndex!].text])).toEqual([
      ['Chapter 1. Foundations of Privacy', 0, 'Chapter 1. Foundations of Privacy'],
      ['Fair Information Practices', 1, 'Fair Information Practices'],
      ['Chapter 2. Enforcement', 0, 'Chapter 2. Enforcement'],
    ])
  })

  it('records where each passage sits', () => {
    expect(find(book.blocks, 'Privacy law protects personal information about individuals.').path).toEqual([
      'Chapter 1. Foundations of Privacy',
    ])
    expect(find(book.blocks, 'Access and correction rights let individuals review the data held about them.').path).toEqual([
      'Chapter 1. Foundations of Privacy',
      'Fair Information Practices',
    ])
    expect(find(book.blocks, 'Principles are not laws on their own.').path).toEqual([
      'Chapter 1. Foundations of Privacy',
      'Note',
    ])
    // After the section and the note box end, their headings no longer apply.
    expect(find(book.blocks, 'Regulators often enforce these principles through consumer protection law.').path).toEqual([
      'Chapter 1. Foundations of Privacy',
    ])
  })

  it('keeps list items, headings and tables', () => {
    expect(find(book.blocks, 'Notice: tell people what is collected.').kind).toBe('list-item')
    expect(find(book.blocks, 'Chapter 2. Enforcement')).toMatchObject({ kind: 'heading', level: 1 })
    expect(find(book.blocks, 'Fair Information Practices')).toMatchObject({ kind: 'heading', level: 2 })
    const table = book.blocks.find((b) => b.kind === 'table')
    expect(table?.rows).toEqual([
      ['Agency', 'Area'],
      ['FTC', 'Consumer protection'],
      ['HHS', 'Health information'],
    ])
    expect(table?.text).toBe('Agency | Area\nFTC | Consumer protection\nHHS | Health information')
  })

  it('tracks print page numbers from page markers', () => {
    expect(book.hasPageNumbers).toBe(true)
    expect(find(book.blocks, 'Privacy law protects personal information about individuals.').page).toBeUndefined()
    expect(find(book.blocks, 'Access and correction rights let individuals review the data held about them.').page).toBe('2')
    expect(find(book.blocks, 'Chapter 2. Enforcement').page).toBe('3')
  })

  it('numbers blocks in reading order', () => {
    expect(book.blocks.map((b) => b.index)).toEqual(book.blocks.map((_, i) => i))
  })
})

describe('parseEpub: other shapes', () => {
  it('reads an EPUB 2 book with an NCX page list and loose HTML', async () => {
    const data = await makeEpub({
      version: 2,
      chapters: [
        {
          file: 'a.xhtml',
          body: '<h2>Intro</h2>Loose text with <em>emphasis</em> and a soft­hyphen.<p>Second&nbsp;para<a id="pg5"></a> continues.</p><p>After page.</p>',
        },
      ],
      pageList: [{ label: '5', href: 'Text/a.xhtml#pg5' }],
    })
    const book = await parseEpub(data)
    expect(book.toc).toEqual([{ title: 'Intro', depth: 0, blockIndex: 0 }])
    expect(book.blocks.map((b) => [b.kind, b.text, b.page])).toEqual([
      ['heading', 'Intro', undefined],
      ['paragraph', 'Loose text with emphasis and a softhyphen.', undefined],
      ['paragraph', 'Second para continues.', undefined],
      ['paragraph', 'After page.', '5'],
    ])
  })

  it('drops visible page numbers from the text and applies them after the break', async () => {
    const book = await parseEpub(
      await makeEpub({
        chapters: [
          {
            file: 'a.xhtml',
            body: '<h1>Pages</h1><p>Before the break <span epub:type="pagebreak" title="7">7</span>after the break.</p><p>Next.</p>',
          },
        ],
      }),
    )
    expect(find(book.blocks, 'Before the break after the break.').page).toBeUndefined()
    expect(find(book.blocks, 'Next.').page).toBe('7')
  })

  it('keeps a heading that sits alone in a wrapper div', async () => {
    const book = await parseEpub(
      await makeEpub({
        chapters: [{ file: 'a.xhtml', body: '<h1>Book</h1><div class="title"><h2>Section A</h2></div><p>Text A</p>' }],
      }),
    )
    expect(find(book.blocks, 'Text A').path).toEqual(['Book', 'Section A'])
  })

  it('ignores fallback text inside media elements', async () => {
    const book = await parseEpub(
      await makeEpub({
        chapters: [{ file: 'a.xhtml', body: '<h1>Media</h1><video src="v.mp4">Your reader cannot play video.</video><p>Real text.</p>' }],
      }),
    )
    expect(book.blocks.map((b) => b.text)).toEqual(['Media', 'Real text.'])
  })

  it('rejects copy-protected books', async () => {
    const data = await makeEpub({ chapters: [{ file: 'a.xhtml', body: '<p>Secret</p>' }], encrypted: ['a.xhtml'] })
    await expect(parseEpub(data)).rejects.toThrow(/copy-protected/)
  })

  it('rejects files that are not EPUBs', async () => {
    await expect(parseEpub(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(EpubError)
  })

  it('rejects books without text', async () => {
    const data = await makeEpub({ chapters: [{ file: 'a.xhtml', body: '<img src="cover.png" alt="Cover"/>' }] })
    await expect(parseEpub(data)).rejects.toThrow(/No readable text/)
  })

  it('reports progress per content file', async () => {
    const progress: string[] = []
    await parseEpub(await makeEpub(sampleHandbook()), (p) => progress.push(`${p.done}/${p.total}`))
    expect(progress).toEqual(['1/2', '2/2'])
  })
})
