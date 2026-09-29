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
