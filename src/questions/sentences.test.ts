import { describe, expect, it } from 'vitest'
import { splitSentences } from './sentences'

describe('splitSentences', () => {
  it('splits on sentence ends', () => {
    expect(splitSentences('First one. Second one! Third one? "Quoted." Last')).toEqual([
      'First one.',
      'Second one!',
      'Third one?',
      '"Quoted."',
      'Last',
    ])
  })

  it('does not split on legal and common abbreviations', () => {
    expect(
      splitSentences(
        'The U.S. Congress acted, e.g. in 1998. See 15 U.S.C. § 6501 and 16 C.F.R. Part 312. In FTC v. Wyndham the court agreed. J. Smith wrote it.',
      ),
    ).toEqual([
      'The U.S. Congress acted, e.g. in 1998.',
      'See 15 U.S.C. § 6501 and 16 C.F.R. Part 312.',
      'In FTC v. Wyndham the court agreed.',
      'J. Smith wrote it.',
    ])
  })

  it('keeps closing quotes and brackets with the sentence', () => {
    expect(splitSentences('He said "stop." Then (it ended.) Next')).toEqual(['He said "stop."', 'Then (it ended.)', 'Next'])
  })
})
