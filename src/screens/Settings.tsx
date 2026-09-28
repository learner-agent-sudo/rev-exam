import { useEffect, useState, type FormEvent } from 'react'
import { formatBytes, getStorageStatus, requestPersistentStorage, type StorageStatus } from '../app/device'
import { GeminiError, listModels, pickDefaultModel, type GeminiModel } from '../gemini/models'
import { useSettings } from '../settings/useSettings'

type Check =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; count: number }
  | { state: 'error'; message: string }

export function Settings() {
  const { settings, save, clear } = useSettings()
  // null until the user edits the field; until then show the saved key.
  const [keyDraft, setKeyDraft] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [check, setCheck] = useState<Check>({ state: 'idle' })
  const [models, setModels] = useState<GeminiModel[]>([])
  const [storage, setStorage] = useState<StorageStatus | null>(null)

  useEffect(() => {
    getStorageStatus().then(setStorage)
  }, [])

  const keyInput = keyDraft ?? settings.geminiApiKey ?? ''

  async function saveAndCheck(event: FormEvent) {
    event.preventDefault()
    const key = keyInput.trim()
    if (!key) {
      setCheck({ state: 'error', message: 'Paste your API key first.' })
      return
    }
    await save('geminiApiKey', key)
    setCheck({ state: 'checking' })
    try {
      const available = await listModels(key)
      setModels(available)
      if (!settings.geminiModel || !available.some((m) => m.id === settings.geminiModel)) {
        const model = pickDefaultModel(available)
        if (model) await save('geminiModel', model)
      }
      setCheck({ state: 'ok', count: available.length })
    } catch (error) {
      const message = error instanceof GeminiError ? error.message : String(error)
      setCheck({ state: 'error', message: `Key saved, but the check failed. ${message}` })
    }
  }

  async function removeKey() {
    await clear('geminiApiKey')
    await clear('geminiModel')
    setKeyDraft(null)
    setModels([])
    setCheck({ state: 'idle' })
  }

  async function keepData() {
    await requestPersistentStorage()
    setStorage(await getStorageStatus())
  }

  const modelOptions =
    models.length > 0 ? models : settings.geminiModel ? [{ id: settings.geminiModel, displayName: settings.geminiModel }] : []

  return (
    <div className="page">
      <p className="eyebrow">This device</p>
      <h1>Settings</h1>

      <section className="card" aria-labelledby="gemini-title">
        <div className="card-head">
          <h2 id="gemini-title">Gemini API key</h2>
          {settings.geminiApiKey && <span className="chip">Saved</span>}
        </div>
        <p className="muted small">
          Used to create questions from your book. It is stored only on this device: never uploaded to GitHub, never
          synced.
        </p>
        <ol className="howto">
          <li>
            Open{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              Google AI Studio
            </a>{' '}
            and sign in with your Google account.
          </li>
          <li>Click "Create API key" and copy it.</li>
          <li>Paste it below and press "Save and check".</li>
        </ol>

        <form className="stack" onSubmit={saveAndCheck}>
          <div>
            <label htmlFor="api-key">API key</label>
            <div className="input-group">
              <input
                id="api-key"
                className="input"
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                value={keyInput}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="Paste your key"
              />
              <button type="button" className="btn btn-quiet" onClick={() => setShowKey((s) => !s)}>
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <div className="row">
            <button className="btn" type="submit" disabled={check.state === 'checking'}>
              {check.state === 'checking' ? 'Checking…' : 'Save and check'}
            </button>
            {settings.geminiApiKey && (
              <button type="button" className="btn btn-danger" onClick={removeKey}>
                Remove key
              </button>
            )}
          </div>
          {check.state === 'ok' && (
            <p className="notice notice-ok" role="status">
              The key works. {check.count} {check.count === 1 ? 'model' : 'models'} available.
            </p>
          )}
          {check.state === 'error' && (
            <p className="notice notice-bad" role="alert">
              {check.message}
            </p>
          )}
        </form>

        {modelOptions.length > 0 && (
          <div className="stack spaced">
            <div>
              <label htmlFor="model">Model</label>
              <select
                id="model"
                value={settings.geminiModel ?? ''}
                onChange={(e) => save('geminiModel', e.target.value)}
              >
                {modelOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName === m.id ? m.id : `${m.displayName} (${m.id})`}
                  </option>
                ))}
              </select>
            </div>
            <p className="muted small">
              A "Flash" model is picked for you: fast, cheap and available on the free tier. On the free tier, Google
              may use what the app sends (book passages, questions) to improve its products.
            </p>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="storage-title">
        <div className="card-head">
          <h2 id="storage-title">Storage</h2>
        </div>
        <dl className="facts">
          <dt>Used</dt>
          <dd>{formatBytes(storage?.usedBytes)}</dd>
          <dt>Protected</dt>
          <dd>{storage?.persisted ? 'Yes, the browser will keep this data' : 'Not yet'}</dd>
        </dl>
        {storage && !storage.persisted && (
          <>
            <p className="muted small">
              Without protection, the browser may clear the app's data if the device runs low on space.
            </p>
            <button className="btn btn-quiet" onClick={keepData}>
              Protect my data
            </button>
          </>
        )}
      </section>
    </div>
  )
}
