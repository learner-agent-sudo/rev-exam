import { describe, expect, it } from 'vitest'
import { snippet } from './snippet'

describe('snippet', () => {
  it('centres on the match, keeping its original case', () => {
    expect(snippet('The Federal Trade Commission enforces.', 'trade', 5)).toEqual({
      before: '…eral ',
      match: 'Trade',
      after: ' Comm…',
    })
  })

  it('does not add ellipses at the edges', () => {
    expect(snippet('FTC acts', 'ftc', 10)).toEqual({ before: '', match: 'FTC', after: ' acts' })
  })
})
