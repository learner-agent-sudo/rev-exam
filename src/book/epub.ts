import JSZip from 'jszip'
import type { Block, BlockKind, ParsedBook, TocEntry } from './types'

// Reads a DRM-free EPUB (2 or 3) entirely in the browser and turns it into
// blocks in reading order. Nothing leaves the device.

export class EpubError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EpubError'
  }
}

export interface ParseProgress {
  done: number
  total: number
}

const OPS_NS = 'http://www.idpf.org/2007/ops'
const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'])

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'center', 'dd', 'details', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup',
  'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'ul',
])
const SKIP_TAGS = new Set([
  'script', 'style', 'nav', 'head', 'template', 'noscript', 'rt', 'rp',
  // Media elements: their inner text is fallback for old readers, not book content.
  'audio', 'video', 'object', 'embed', 'iframe', 'canvas', 'svg',
])
const SECTION_TAGS = new Set(['section', 'article'])

export function normalizeText(text: string): string {
  return text.replace(/­/g, '').replace(/\s+/g, ' ').trim()
}

/** Resolves an href relative to the file that contains it. Returns a zip path without #fragment. */
export function resolvePath(fromFile: string, href: string): string {
  const [rawPath] = href.split('#')
  let path = rawPath
  try {
    path = decodeURIComponent(rawPath)
  } catch {
    // Keep the raw path if it is not valid percent-encoding.
  }
  if (!path) return fromFile
  const parts = path.startsWith('/') ? [] : fromFile.split('/').slice(0, -1)
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join('/')
}

function fragmentOf(href: string): string | undefined {
  const hash = href.indexOf('#')
  if (hash < 0) return undefined
  const fragment = href.slice(hash + 1)
  try {
    return decodeURIComponent(fragment) || undefined
  } catch {
    return fragment || undefined
  }
}

function byLocalName(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter((el) => el.localName === name)
}

function childrenByLocalName(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((child) => child.localName === name)
}

function epubType(el: Element): string {
  return el.getAttributeNS(OPS_NS, 'type') || el.getAttribute('epub:type') || ''
}

function parseXml(text: string, what: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new EpubError(`This EPUB's ${what} is damaged.`)
  return doc
}

function parseContent(text: string): Document {
  const xhtml = new DOMParser().parseFromString(text, 'application/xhtml+xml')
  if (xhtml.getElementsByTagName('parsererror').length === 0) return xhtml
  // Many EPUBs use HTML entities or sloppy markup that strict XML rejects.
  return new DOMParser().parseFromString(text, 'text/html')
}

class Zip {
  private readonly zip: JSZip
  private readonly lowerCase = new Map<string, string>()

  constructor(zip: JSZip) {
    this.zip = zip
    zip.forEach((path) => this.lowerCase.set(path.toLowerCase(), path))
  }

  has(path: string): boolean {
    return this.entry(path) !== null
  }

  async text(path: string): Promise<string | undefined> {
    return this.entry(path)?.async('string')
  }

  private entry(path: string) {
    return this.zip.file(path) ?? this.zip.file(this.lowerCase.get(path.toLowerCase()) ?? '')
  }
}

async function assertNoDrm(zip: Zip) {
  const encryption = await zip.text('META-INF/encryption.xml')
  if (!encryption) return
  const doc = parseXml(encryption, 'encryption info')
  for (const data of byLocalName(doc, 'EncryptedData')) {
    const algorithm = byLocalName(data, 'EncryptionMethod')[0]?.getAttribute('Algorithm') ?? ''
    const uri = byLocalName(data, 'CipherReference')[0]?.getAttribute('URI') ?? ''
    const isFont = /\.(otf|ttf|woff2?)$/i.test(uri)
    if (!(isFont && FONT_OBFUSCATION.has(algorithm))) {
      throw new EpubError(
        'This book is copy-protected (DRM), so its text cannot be read. Use a DRM-free EPUB of the book.',
      )
    }
  }
}

interface ManifestItem {
  path: string
  mediaType: string
  properties: string
}

interface NavLink {
  title: string
  depth: number
  path: string
  fragment?: string
}

function parseNavList(ol: Element, navPath: string, depth: number, out: NavLink[]) {
  for (const li of childrenByLocalName(ol, 'li')) {
    const label = childrenByLocalName(li, 'a')[0] ?? childrenByLocalName(li, 'span')[0]
    const href = label?.getAttribute('href')
    const title = label ? normalizeText(label.textContent ?? '') : ''
    if (title && href) {
      out.push({ title, depth, path: resolvePath(navPath, href), fragment: fragmentOf(href) })
    }
    const nested = childrenByLocalName(li, 'ol')[0]
    if (nested) parseNavList(nested, navPath, title && href ? depth + 1 : depth, out)
  }
}

function parseEpub3Nav(doc: Document, navPath: string) {
  const navs = byLocalName(doc, 'nav')
  const tocNav = navs.find((n) => epubType(n).split(/\s+/).includes('toc')) ?? navs[0]
  const pageNav = navs.find((n) => epubType(n).split(/\s+/).includes('page-list'))
  const toc: NavLink[] = []
  const pages: NavLink[] = []
  const tocList = tocNav && byLocalName(tocNav, 'ol')[0]
  if (tocList) parseNavList(tocList, navPath, 0, toc)
  const pageList = pageNav && byLocalName(pageNav, 'ol')[0]
  if (pageList) parseNavList(pageList, navPath, 0, pages)
  return { toc, pages }
}

function parseNcx(doc: Document, ncxPath: string) {
  const toc: NavLink[] = []
  const walk = (parent: Element, depth: number) => {
    for (const point of childrenByLocalName(parent, 'navPoint')) {
      const title = normalizeText(byLocalName(point, 'text')[0]?.textContent ?? '')
      const src = childrenByLocalName(point, 'content')[0]?.getAttribute('src')
      if (title && src) toc.push({ title, depth, path: resolvePath(ncxPath, src), fragment: fragmentOf(src) })
      walk(point, depth + 1)
    }
  }
  const navMap = byLocalName(doc, 'navMap')[0]
  if (navMap) walk(navMap, 0)

  const pages: NavLink[] = byLocalName(doc, 'pageTarget').flatMap((target) => {
    const title = normalizeText(byLocalName(target, 'text')[0]?.textContent ?? '')
    const src = byLocalName(target, 'content')[0]?.getAttribute('src')
    return title && src ? [{ title, depth: 0, path: resolvePath(ncxPath, src), fragment: fragmentOf(src) }] : []
  })
  return { toc, pages }
}

/** Walks content documents in reading order and emits blocks. */
class BlockBuilder {
  readonly blocks: Block[] = []
  readonly toc: TocEntry[]
  private readonly tocTargets = new Map<string, number[]>()
  private readonly pageTargets = new Map<string, string>()
  private pendingToc: number[] = []
  private chapter: string | undefined
  /** Bumped whenever a new top-level contents entry starts. */
  private chapterCount = 0
  private headings: { rank: number; text: string }[] = []
  private page: string | undefined
  private file = ''

  constructor(tocLinks: NavLink[], pageLinks: NavLink[]) {
    this.toc = tocLinks.map(({ title, depth }) => ({ title, depth }))
    tocLinks.forEach((link, i) => {
      const key = link.fragment ? `${link.path}#${link.fragment}` : link.path
      this.tocTargets.set(key, [...(this.tocTargets.get(key) ?? []), i])
    })
    for (const link of pageLinks) {
      if (link.fragment) this.pageTargets.set(`${link.path}#${link.fragment}`, link.title)
    }
  }

  addDocument(path: string, doc: Document) {
    this.file = path
    const firstBlock = this.blocks.length
    this.queueToc(path)
    const body = doc.body ?? byLocalName(doc, 'body')[0]
    // Headings in the body carry on into the next file (long chapters are often split).
    if (body) this.walk(body, 'paragraph', true)

    // Entries whose #anchor never turned up point at the start of their file.
    for (const [key, entries] of this.tocTargets) {
      if (!key.startsWith(`${path}#`)) continue
      for (const i of entries) {
        if (this.toc[i].blockIndex !== undefined || this.pendingToc.includes(i)) continue
        if (firstBlock < this.blocks.length) this.toc[i].blockIndex = firstBlock
        else this.pendingToc.push(i)
      }
    }
  }

  finish(): TocEntry[] {
    return this.toc.filter((entry) => entry.blockIndex !== undefined)
  }

  private queueToc(key: string) {
    for (const i of this.tocTargets.get(key) ?? []) {
      if (this.toc[i].blockIndex === undefined && !this.pendingToc.includes(i)) this.pendingToc.push(i)
    }
  }

  private noteAnchors(el: Element) {
    for (const node of [el, ...Array.from(el.querySelectorAll('[id]'))]) {
      const id = node.getAttribute('id')
      if (id) this.queueToc(`${this.file}#${id}`)
    }
  }

  /**
   * Page number marked by this element, if any. `marker` is true when the element
   * only exists to mark the page (its own text, e.g. "12", is not book content).
   */
  private pageMark(el: Element): { label: string; marker: boolean } | undefined {
    const text = normalizeText(el.textContent ?? '')
    const isBreak = epubType(el).split(/\s+/).includes('pagebreak') || el.getAttribute('role') === 'doc-pagebreak'
    const id = el.getAttribute('id')
    const listed = id ? this.pageTargets.get(`${this.file}#${id}`) : undefined
    if (listed) return { label: listed, marker: isBreak || !text || (text.length <= listed.length + 4 && text.includes(listed)) }
    if (!isBreak) return undefined
    const label = normalizeText(el.getAttribute('aria-label') || el.getAttribute('title') || text)
    return label ? { label, marker: true } : undefined
  }

  /** Text of an element, skipping page markers. Also reports page markers found inside it. */
  private extract(nodes: Node[]): { text: string; leadingPage?: string; lastPage?: string } {
    let text = ''
    let leadingPage: string | undefined
    let lastPage: string | undefined
    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
        text += node.nodeValue ?? ''
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      const el = node as Element
      const tag = el.localName.toLowerCase()
      if (SKIP_TAGS.has(tag)) return
      const mark = this.pageMark(el)
      if (mark) {
        if (!normalizeText(text)) leadingPage = mark.label
        lastPage = mark.label
        if (mark.marker) return
      }
      if (tag === 'br') {
        text += ' '
        return
      }
      el.childNodes.forEach(visit)
      if (BLOCK_TAGS.has(tag)) text += ' '
    }
    nodes.forEach(visit)
    return { text: normalizeText(text), leadingPage, lastPage }
  }

  private emitText(nodes: Node[], kind: BlockKind, headingRank?: number) {
    const { text, leadingPage, lastPage } = this.extract(nodes)
    if (leadingPage) this.page = leadingPage
    if (text) this.emit({ kind, text, level: headingRank })
    if (lastPage) this.page = lastPage
  }

  private emit(block: { kind: BlockKind; text: string; level?: number; rows?: string[][] }) {
    const index = this.blocks.length
    for (const i of this.pendingToc) {
      this.toc[i].blockIndex = index
      if (this.toc[i].depth === 0) {
        this.chapter = this.toc[i].title
        this.chapterCount++
        this.headings = []
      }
    }
    this.pendingToc = []

    let level: number | undefined
    if (block.kind === 'heading' && block.level !== undefined) {
      const rank = block.level
      while (this.headings.length && this.headings[this.headings.length - 1].rank >= rank) this.headings.pop()
      this.headings.push({ rank, text: block.text })
      level = this.headings.length
    }

    this.blocks.push({
      index,
      kind: block.kind,
      text: block.text,
      path: buildPath(this.chapter, this.headings.map((h) => h.text)),
      ...(this.page ? { page: this.page } : {}),
      ...(level !== undefined ? { level } : {}),
      ...(block.rows ? { rows: block.rows } : {}),
    })
  }

  private walk(container: Element, kind: BlockKind, isBody = false) {
    const headingsBefore = [...this.headings]
    const chapterBefore = this.chapterCount
    const blocksBefore = this.blocks.length
    let inline: Node[] = []
    const flush = () => {
      for (const node of inline) if (node.nodeType === Node.ELEMENT_NODE) this.noteAnchors(node as Element)
      if (inline.length) this.emitText(inline, kind)
      inline = []
    }

    for (const node of Array.from(container.childNodes)) {
      if (node.nodeType !== Node.ELEMENT_NODE) {
        if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) inline.push(node)
        continue
      }
      const el = node as Element
      const tag = el.localName.toLowerCase()
      if (SKIP_TAGS.has(tag)) continue
      if (!BLOCK_TAGS.has(tag)) {
        inline.push(el)
        continue
      }

      flush()

      if (/^h[1-6]$/.test(tag)) {
        this.noteAnchors(el)
        this.emitText([el], 'heading', headingRank(el, Number(tag[1])))
      } else if (tag === 'table') {
        this.noteAnchors(el)
        this.emitTable(el)
      } else if (tag === 'hr') {
        continue
      } else if (hasBlockChildren(el)) {
        const id = el.getAttribute('id')
        if (id) this.queueToc(`${this.file}#${id}`)
        const mark = this.pageMark(el)
        if (mark) this.page = mark.label
        this.walk(el, tag === 'li' ? 'list-item' : kind)
      } else {
        this.noteAnchors(el)
        this.emitText([el], tag === 'li' ? 'list-item' : kind)
      }
    }
    flush()

    // A heading inside a box (a section, or a "note" div) only covers that box.
    // Wrapper divs that hold nothing but a heading are left alone.
    const hadContent = this.blocks.slice(blocksBefore).some((b) => b.kind !== 'heading')
    if (!isBody && hadContent && this.chapterCount === chapterBefore) this.headings = headingsBefore
  }

  private emitTable(table: Element) {
    const rows = byLocalName(table, 'tr')
      .map((tr) => Array.from(tr.children).filter((c) => c.localName === 'td' || c.localName === 'th'))
      .map((cells) => cells.map((cell) => this.extract([cell]).text))
      .filter((cells) => cells.some(Boolean))
    if (!rows.length) return
    const caption = byLocalName(table, 'caption')[0]
    if (caption) this.emitText([caption], 'paragraph')
    this.emit({ kind: 'table', text: rows.map((r) => r.join(' | ')).join('\n'), rows })
  }
}

function hasBlockChildren(el: Element): boolean {
  return Array.from(el.children).some((child) => BLOCK_TAGS.has(child.localName.toLowerCase()))
}

// Books mark heading depth either with <h1>–<h6> or by nesting <section>s
// (some use <h2> at every level). Combining both orders headings correctly in either style.
function headingRank(el: Element, tagLevel: number): number {
  let depth = 0
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (SECTION_TAGS.has(p.localName.toLowerCase())) depth++
  }
  return depth * 10 + tagLevel
}

function same(a: string, b: string): boolean {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x === y || x.includes(y) || y.includes(x)
}

function buildPath(chapter: string | undefined, headings: string[]): string[] {
  const path: string[] = []
  if (chapter) path.push(chapter)
  headings.forEach((heading, i) => {
    const prev = path[path.length - 1]
    // The chapter's own heading usually repeats its table-of-contents title.
    if (prev && (i === 0 && chapter ? same(prev, heading) : prev.toLowerCase() === heading.toLowerCase())) return
    path.push(heading)
  })
  return path
}

export async function parseEpub(
  data: ArrayBuffer | Uint8Array,
  onProgress?: (progress: ParseProgress) => void,
): Promise<ParsedBook> {
  let jszip: JSZip
  try {
    jszip = await JSZip.loadAsync(data)
  } catch {
    throw new EpubError("This file isn't a valid EPUB (it could not be opened as one).")
  }
  const zip = new Zip(jszip)

  const container = await zip.text('META-INF/container.xml')
  if (!container) throw new EpubError("This file isn't a valid EPUB (container.xml is missing).")
  await assertNoDrm(zip)

  const opfPath = byLocalName(parseXml(container, 'container'), 'rootfile')[0]?.getAttribute('full-path')
  const opfText = opfPath && (await zip.text(opfPath))
  if (!opfPath || !opfText) throw new EpubError("This file isn't a valid EPUB (package file is missing).")
  const opf = parseXml(opfText, 'package file')

  const meta = (name: string) => normalizeText(byLocalName(opf, name)[0]?.textContent ?? '') || undefined
  const manifest = new Map<string, ManifestItem>()
  for (const item of byLocalName(opf, 'item')) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (!id || !href) continue
    manifest.set(id, {
      path: resolvePath(opfPath, href),
      mediaType: item.getAttribute('media-type') ?? '',
      properties: item.getAttribute('properties') ?? '',
    })
  }

  // Table of contents and page list: EPUB 3 nav document first, EPUB 2 NCX as fallback.
  let nav: { toc: NavLink[]; pages: NavLink[] } = { toc: [], pages: [] }
  const navItem = [...manifest.values()].find((m) => m.properties.split(/\s+/).includes('nav'))
  const navText = navItem && (await zip.text(navItem.path))
  if (navItem && navText) nav = parseEpub3Nav(parseContent(navText), navItem.path)
  const spineEl = byLocalName(opf, 'spine')[0]
  const ncxItem = manifest.get(spineEl?.getAttribute('toc') ?? '') ??
    [...manifest.values()].find((m) => m.mediaType === 'application/x-dtbncx+xml')
  if ((!nav.toc.length || !nav.pages.length) && ncxItem) {
    const ncxText = await zip.text(ncxItem.path)
    if (ncxText) {
      const ncx = parseNcx(parseXml(ncxText, 'table of contents'), ncxItem.path)
      nav = { toc: nav.toc.length ? nav.toc : ncx.toc, pages: nav.pages.length ? nav.pages : ncx.pages }
    }
  }

  const spine = (spineEl ? byLocalName(spineEl, 'itemref') : [])
    .map((ref) => manifest.get(ref.getAttribute('idref') ?? ''))
    .filter((item): item is ManifestItem => !!item && /x?html/.test(item.mediaType) && item !== navItem)

  const builder = new BlockBuilder(nav.toc, nav.pages)
  for (const [i, item] of spine.entries()) {
    const text = await zip.text(item.path)
    if (text) builder.addDocument(item.path, parseContent(text))
    onProgress?.({ done: i + 1, total: spine.length })
    // Let the page repaint between chapters so the progress bar moves.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  if (!builder.blocks.some((b) => b.kind !== 'heading')) {
    throw new EpubError('No readable text was found in this book. It may contain only images.')
  }

  return {
    title: meta('title') ?? 'Untitled book',
    author: meta('creator'),
    language: meta('language'),
    toc: builder.finish(),
    blocks: builder.blocks,
    hasPageNumbers: builder.blocks.some((b) => b.page !== undefined),
  }
}
