import type { BlockRow } from '../db/db'

// Front and back matter make poor questions.
const SKIP_SECTIONS =
  /^(?:(?:table of )?contents|index|copyright|acknowledge?ments?|about the (?:authors?|editors?|contributors?)|dedication|also by.*|bibliography|references|endnotes|notes)$/i

/** True for passages worth asking about: not headings, not the index, copyright page and similar. */
export function isStudyPassage(block: BlockRow): boolean {
  if (block.kind === 'heading') return false
  return !block.path.some((part) => SKIP_SECTIONS.test(part.trim()))
}

export function chapterOf(block: BlockRow): string {
  return block.path[0] ?? 'Start of book'
}

const NUMBERED = /^\d{1,3}[.)]?\s+\S/
const CITATION =
  /https?:\/\/|www\.|\b(?:U\.S\.C|C\.F\.R|Fed\. Reg|F\.\s?(?:2d|3d|4th|Supp)|S\. Ct|Id\.|Ibid|supra|infra|accessed|retrieved|available at|press release)\b/i
const NOTE_LIKE = /^\d{1,3}[.)]?\s+["“‘]|\b(?:1[89]|20)\d{2}\b|\sv\.\s/

/**
 * Endnotes and footnotes: numbered lines like "56 “FTC Approves Final Order…,” April 15,
 * 2016, https://…". They are citations, not study text. A numbered line counts as a note
 * when it has a link or legal citation, or sits in a run of numbered lines that look like
 * notes (a quote, a year or "v.").
 */
export function noteBlocks(blocks: BlockRow[]): Set<number> {
  const numbered = new Set(blocks.filter((b) => b.kind !== 'heading' && NUMBERED.test(b.text)).map((b) => b.index))
  const notes = new Set<number>()
  for (const block of blocks) {
    if (!numbered.has(block.index)) continue
    const inRun = numbered.has(block.index - 1) || numbered.has(block.index + 1)
    if (CITATION.test(block.text) || (inRun && NOTE_LIKE.test(block.text))) notes.add(block.index)
  }
  return notes
}

/** Passages questions can be made from, in reading order: no headings, front/back matter or notes. */
export function studyPassages(blocks: BlockRow[]): BlockRow[] {
  const notes = noteBlocks(blocks)
  return blocks.filter((b) => isStudyPassage(b) && !notes.has(b.index))
}
