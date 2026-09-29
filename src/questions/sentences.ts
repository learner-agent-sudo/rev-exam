// Splits passage text into sentences without breaking on common legal and
// English abbreviations ("U.S.", "e.g.", "Inc.", "v.", "C.F.R.").

const ABBREVIATIONS = new Set([
  'U.S', 'U.K', 'E.U', 'U.N', 'e.g', 'i.e', 'etc', 'cf', 'al', 'vs', 'v', 'viz', 'approx', 'Inc', 'Corp', 'Co', 'Ltd',
  'LLC', 'No', 'Nos', 'Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Jr', 'Sr', 'St', 'Art', 'Arts', 'Sec', 'Secs', 'Fed', 'Reg',
  'Regs', 'Stat', 'Pub', 'L', 'C.F.R', 'U.S.C', 'Cir', 'Cal', 'Civ', 'Ct', 'App', 'Supp', 'Rev', 'Ch', 'ch', 'para',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec', 'Gov', 'Dept', 'Assn', 'Ass',
])

const BOUNDARY = /([.!?])(["”’)\]]*)\s+(?=["“(]?[A-Z0-9])/g

export function splitSentences(text: string): string[] {
  const sentences: string[] = []
  let start = 0
  for (const match of text.matchAll(BOUNDARY)) {
    const end = match.index + match[1].length + match[2].length
    if (match[1] === '.') {
      const before = text.slice(start, match.index)
      const word = /([A-Za-z][A-Za-z.]*)$/.exec(before)?.[1] ?? ''
      // "U.S.", "e.g.", "Inc." and single initials ("J. Smith") do not end a sentence.
      if (ABBREVIATIONS.has(word) || /^[A-Z]$/.test(word)) continue
    }
    const sentence = text.slice(start, end).trim()
    if (sentence) sentences.push(sentence)
    start = end
  }
  const rest = text.slice(start).trim()
  if (rest) sentences.push(rest)
  return sentences
}
