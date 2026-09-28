import { useState, type DragEvent } from 'react'
import { requestPersistentStorage } from '../../app/device'
import { EpubError } from '../../book/epub'
import { importBook } from '../../book/store'
import type { BookRow } from '../../db/db'

type State =
  | { kind: 'idle' }
  | { kind: 'reading'; name: string; done: number; total: number }
  | { kind: 'error'; message: string }

export function ImportCard({ onImported, title = 'Import your book' }: { onImported: (book: BookRow) => void; title?: string }) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [dragging, setDragging] = useState(false)
  const reading = state.kind === 'reading'

  async function handle(file: File | undefined) {
    if (!file || reading) return
    setState({ kind: 'reading', name: file.name, done: 0, total: 0 })
    try {
      const book = await importBook(file, (p) => setState({ kind: 'reading', name: file.name, ...p }))
      // Ask the browser to keep the book even when the device is short of space.
      void requestPersistentStorage()
      setState({ kind: 'idle' })
      onImported(book)
    } catch (error) {
      const message = error instanceof EpubError ? error.message : `The import failed: ${String(error)}`
      setState({ kind: 'error', message })
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    void handle(event.dataTransfer.files[0])
  }

  return (
    <section className="card" aria-labelledby="import-title">
      <h2 id="import-title">{title}</h2>
      <p className="muted small">
        Choose the EPUB file of your textbook. It is read on this device and never uploaded anywhere. Copy-protected
        (DRM) files cannot be read.
      </p>
      <label
        className={`dropzone${dragging ? ' over' : ''}${reading ? ' busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          className="visually-hidden"
          type="file"
          accept=".epub,application/epub+zip"
          aria-label="EPUB file"
          disabled={reading}
          onChange={(e) => {
            void handle(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <span className="dropzone-title">{reading ? `Reading ${state.name}…` : 'Choose EPUB file'}</span>
        <span className="small muted">{reading ? 'Keep this screen open' : 'or drop it here'}</span>
      </label>
      {reading && (
        <div className="progress" role="status">
          <progress value={state.done} max={state.total || 1} />
          <span className="small muted">{state.total ? `Part ${state.done} of ${state.total}` : 'Opening…'}</span>
        </div>
      )}
      {state.kind === 'error' && (
        <p className="notice notice-bad" role="alert">
          {state.message}
        </p>
      )}
    </section>
  )
}
