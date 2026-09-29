import JSZip from 'jszip'

// Builds small EPUB files for tests. Not used by the app itself.

export interface TocItem {
  title: string
  href: string
  children?: TocItem[]
}

export interface FixtureOptions {
  version?: 2 | 3
  title?: string
  author?: string
  language?: string
  /** Content files in reading order: file name (under OEBPS/Text/) and XHTML body markup. */
  chapters: { file: string; body: string }[]
  /** Defaults to one entry per chapter, titled from its first heading. */
  toc?: TocItem[]
  pageList?: { label: string; href: string }[]
  /** Content files to list as encrypted, as DRM would. */
  encrypted?: string[]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

function xhtml(title: string, body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>${esc(title)}</title></head>
<body>${body}</body>
</html>`
}

function navList(items: TocItem[]): string {
  return `<ol>${items
    .map((i) => `<li><a href="${esc(i.href)}">${esc(i.title)}</a>${i.children?.length ? navList(i.children) : ''}</li>`)
    .join('')}</ol>`
}

function ncxPoints(items: TocItem[], counter = { n: 0 }): string {
  return items
    .map((i) => {
      counter.n++
      return `<navPoint id="np${counter.n}" playOrder="${counter.n}"><navLabel><text>${esc(i.title)}</text></navLabel><content src="${esc(i.href)}"/>${ncxPoints(i.children ?? [], counter)}</navPoint>`
    })
    .join('')
}

export async function makeEpub(options: FixtureOptions): Promise<Uint8Array> {
  const { version = 3, title = 'Test Book', author = 'A. Author', language = 'en', chapters } = options
  const toc =
    options.toc ??
    chapters.map((c) => ({
      title: /<h\d[^>]*>([^<]*)</.exec(c.body)?.[1] ?? c.file,
      href: `Text/${c.file}`,
    }))

  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  )
  if (options.encrypted?.length) {
    zip.file(
      'META-INF/encryption.xml',
      `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">${options.encrypted
        .map(
          (f) =>
            `<enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><enc:CipherData><enc:CipherReference URI="OEBPS/Text/${f}"/></enc:CipherData></enc:EncryptedData>`,
        )
        .join('')}</encryption>`,
    )
  }

  const items = chapters
    .map((c, i) => `<item id="c${i}" href="Text/${c.file}" media-type="application/xhtml+xml"/>`)
    .join('')
  const spine = chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('')
  const navItem = version === 3 ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : ''
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${version}.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">urn:test:${esc(title)}</dc:identifier>
<dc:title>${esc(title)}</dc:title>
<dc:creator>${esc(author)}</dc:creator>
<dc:language>${language}</dc:language>
</metadata>
<manifest>${navItem}<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${items}</manifest>
<spine toc="ncx">${spine}</spine>
</package>`,
  )

  const pageList = options.pageList ?? []
  if (version === 3) {
    const pages = pageList.length
      ? `<nav epub:type="page-list"><ol>${pageList.map((p) => `<li><a href="${esc(p.href)}">${esc(p.label)}</a></li>`).join('')}</ol></nav>`
      : ''
    zip.file('OEBPS/nav.xhtml', xhtml('Contents', `<nav epub:type="toc"><h1>Contents</h1>${navList(toc)}</nav>${pages}`))
  }
  const ncxPages = pageList.length
    ? `<pageList>${pageList.map((p, i) => `<pageTarget id="pt${i}" type="normal" value="${i + 1}"><navLabel><text>${esc(p.label)}</text></navLabel><content src="${esc(p.href)}"/></pageTarget>`).join('')}</pageList>`
    : ''
  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>${esc(title)}</text></docTitle><navMap>${ncxPoints(toc)}</navMap>${ncxPages}</ncx>`,
  )

  for (const c of chapters) zip.file(`OEBPS/Text/${c.file}`, xhtml(c.file, c.body))
  return zip.generateAsync({ type: 'uint8array' })
}

/** A small privacy-law handbook used by the browser tests. The text is written for these tests. */
export function sampleHandbook(): FixtureOptions {
  return {
    title: 'Sample Privacy Handbook',
    author: 'Test Author',
    chapters: [
      {
        file: 'ch01.xhtml',
        body: `<section epub:type="chapter" id="ch1">
<h1>Chapter 1. Foundations of Privacy</h1>
<p>Privacy law protects personal information about individuals.</p>
<section id="fipps"><h2>Fair Information Practices</h2>
<p>The Fair Information Practice Principles describe how organizations should collect and use personal data.</p>
<ul><li>Notice: tell people what is collected.</li><li>Choice: let people decide how data is used.</li></ul>
<span epub:type="pagebreak" id="page2" title="2"></span>
<p>Access and correction rights let individuals review the data held about them.</p>
</section>
<aside class="note"><h3>Note</h3><p>Principles are not laws on their own.</p></aside>
<p>Regulators often enforce these principles through consumer protection law.</p>
</section>`,
      },
      {
        file: 'ch02.xhtml',
        body: `<section epub:type="chapter" id="ch2">
<span epub:type="pagebreak" id="page3" title="3"></span>
<h1>Chapter 2. Enforcement</h1>
<p>The Federal Trade Commission brings actions against unfair or deceptive practices.</p>
<table><tr><th>Agency</th><th>Area</th></tr><tr><td>FTC</td><td>Consumer protection</td></tr><tr><td>HHS</td><td>Health information</td></tr></table>
<p>State attorneys general can also enforce privacy laws in their states.</p>
</section>`,
      },
    ],
    toc: [
      {
        title: 'Chapter 1. Foundations of Privacy',
        href: 'Text/ch01.xhtml',
        children: [{ title: 'Fair Information Practices', href: 'Text/ch01.xhtml#fipps' }],
      },
      { title: 'Chapter 2. Enforcement', href: 'Text/ch02.xhtml' },
    ],
  }
}

/** The handbook plus a chapter of federal laws, with enough names, acronyms and years for questions. */
export function sampleLawsHandbook(): FixtureOptions {
  const base = sampleHandbook()
  return {
    ...base,
    title: 'Sample Privacy Handbook with Laws',
    chapters: [
      ...base.chapters,
      {
        file: 'ch03.xhtml',
        body: `<section epub:type="chapter" id="ch3">
<h1>Chapter 3. Federal Privacy Laws</h1>
<p>The Fair Credit Reporting Act (FCRA) was enacted in 1970 to regulate consumer reporting agencies.</p>
<p>The Family Educational Rights and Privacy Act (FERPA) was enacted in 1974 and protects student education records.</p>
<p>The Video Privacy Protection Act (VPPA) was enacted in 1988 after a newspaper published a judge's video rental history.</p>
<p>The Health Insurance Portability and Accountability Act (HIPAA) was enacted in 1996 and applies to health plans and many health care providers.</p>
<p>The Children's Online Privacy Protection Act (COPPA) was enacted in 1998 and protects children under 13 years of age.</p>
<p>The Gramm-Leach-Bliley Act (GLBA) was enacted in 1999 and requires financial institutions to explain their information-sharing practices.</p>
</section>`,
      },
    ],
    toc: [...(base.toc ?? []), { title: 'Chapter 3. Federal Privacy Laws', href: 'Text/ch03.xhtml' }],
  }
}
