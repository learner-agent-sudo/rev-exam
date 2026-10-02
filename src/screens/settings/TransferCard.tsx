import { useState } from 'react'
import { formatBytes, requestPersistentStorage } from '../../app/device'
import { listBooks } from '../../book/store'
import {
  exportData,
  mergeData,
  readTransferFile,
  transferBlob,
  transferFileName,
  TransferError,
  type MergeSummary,
} from '../../transfer/transfer'

type State =
  | { kind: 'idle' }
  | { kind: 'busy'; text: string }
  | { kind: 'done'; text: string; warning?: string }
  | { kind: 'error'; text: string }

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

/** "a, b and c" */
const list = (parts: string[]) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`)

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function describeMerge(s: MergeSummary): string {
  const added = [
    ...s.booksAdded.map((title) => `the book “${title}”`),
    ...(s.questionsAdded ? [plural(s.questionsAdded, 'new question')] : []),
    ...(s.attemptsAdded ? [plural(s.attemptsAdded, 'answer')] : []),
  ]
  const changed = [
    ...(s.questionsUpdated ? [`${plural(s.questionsUpdated, 'question')} updated`] : []),
    ...(s.questionsRemoved ? [`${plural(s.questionsRemoved, 'old concept-check question')} replaced`] : []),
  ]
  const text = [added.length ? `Added ${list(added)}.` : '', changed.length ? `${list(changed)}.` : '']
    .filter(Boolean)
    .join(' ')
  return text || 'Nothing new: this device already had everything in the file.'
}

export function TransferCard() {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const busy = state.kind === 'busy'

  async function save() {
    setState({ kind: 'busy', text: 'Preparing the file…' })
    try {
      const data = await exportData()
      if (!data.books.length) {
        setState({ kind: 'error', text: 'There is nothing to move from this device yet: import a book first.' })
        return
      }
      const blob = await transferBlob(data)
      const name = transferFileName(blob)
      download(blob, name)
      const contents = list([
        plural(data.books.length, 'book'),
        plural(data.questions.length, 'question'),
        plural(data.attempts.length, 'answer'),
      ])
      setState({
        kind: 'done',
        text: `Saved ${name} (${formatBytes(blob.size)}) with ${contents}. Look for it in your Downloads.`,
      })
    } catch (error) {
      setState({ kind: 'error', text: `Saving failed: ${String(error)}` })
    }
  }

  async function load(file: File | undefined) {
    if (!file || busy) return
    setState({ kind: 'busy', text: `Loading ${file.name}…` })
    try {
      const summary = await mergeData(await readTransferFile(file))
      void requestPersistentStorage()
      const titles = (await listBooks()).map((b) => b.title)
      const twice = summary.booksAdded.filter((t) => titles.filter((x) => x === t).length > 1)
      const warnings = [
        ...summary.booksIncomplete.map(
          (t) => `“${t}” was left out because the file does not hold all of its passages. Save the file again on the other device.`,
        ),
        ...twice.map(
          (t) =>
            `This device also has its own copy of “${t}”, with its own questions and answers. To avoid mixing them up, delete the copy you do not need in Book (each shows the date it was imported).`,
        ),
      ]
      setState({ kind: 'done', text: describeMerge(summary), warning: warnings.join(' ') || undefined })
    } catch (error) {
      setState({ kind: 'error', text: error instanceof TransferError ? error.message : `Loading failed: ${String(error)}` })
    }
  }

  return (
    <section className="card" id="transfer" aria-labelledby="transfer-title">
      <div className="card-head">
        <h2 id="transfer-title">Move to another device</h2>
      </div>
      <p className="muted small">
        Your book, questions and answers are kept only in this browser. To study them on your phone or another computer,
        move them with a file:
      </p>
      <ol className="howto">
        <li>On the device that has them, press “Save transfer file”. It goes to your Downloads.</li>
        <li>Move the file across: upload it to Google Drive, email it to yourself, or copy it with a cable.</li>
        <li>
          On the other device, open Rev Exam, come to Settings and press “Load transfer file”. On Android, Google Drive
          is in the file picker's menu.
        </li>
      </ol>
      <p className="muted small">
        Loading adds what is new and keeps everything already there, so it is safe to repeat. Do it the other way round
        to bring your practice back. Your Gemini key is not included; practising does not need it.
      </p>
      <div className="stack">
        <div className="row">
          <button className="btn" onClick={save} disabled={busy}>
            Save transfer file
          </button>
          <label className={`btn btn-quiet${busy ? ' disabled' : ''}`}>
            <input
              className="visually-hidden"
              type="file"
              aria-label="Transfer file"
              disabled={busy}
              onChange={(e) => {
                void load(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            Load transfer file
          </label>
        </div>
        {state.kind === 'busy' && (
          <p className="muted small" role="status">
            {state.text}
          </p>
        )}
        {state.kind === 'done' && (
          <p className="notice notice-ok" role="status">
            {state.text}
          </p>
        )}
        {state.kind === 'done' && state.warning && (
          <p className="notice notice-info" role="alert">
            {state.warning}
          </p>
        )}
        {state.kind === 'error' && (
          <p className="notice notice-bad" role="alert">
            {state.text}
          </p>
        )}
      </div>
    </section>
  )
}
