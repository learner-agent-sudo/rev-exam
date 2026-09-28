import { isInstalled, useInstallPrompt } from '../app/device'
import { href } from '../app/router'
import { useSettings } from '../settings/useSettings'

export function Home() {
  const { settings, loaded } = useSettings()
  const { canInstall, install } = useInstallPrompt()
  const installed = isInstalled()
  const hasKey = Boolean(settings.geminiApiKey)

  return (
    <div className="page">
      <p className="eyebrow">CIPP/US revision</p>
      <h1>
        Every answer, backed by <span className="mark">the exact passage</span>.
      </h1>
      <p className="lede">
        Import your textbook, practise with exam-style questions, and see the book's own words whenever you get one
        wrong.
      </p>

      <section className="card" aria-labelledby="setup-title">
        <div className="card-head">
          <h2 id="setup-title">Getting set up</h2>
        </div>
        <ol className="steps">
          <li className={installed ? 'done' : ''}>
            <span className="step-title">Install the app</span>
            <div className="step-body">
              {installed ? (
                'Installed. It opens from your home screen and works offline.'
              ) : canInstall ? (
                <>
                  Add Rev Exam to this device so it opens like an app and works offline.
                  <div className="row">
                    <button className="btn" onClick={install}>
                      Install
                    </button>
                  </div>
                </>
              ) : (
                'In Chrome, open the ⋮ menu and choose "Install app" or "Add to home screen".'
              )}
            </div>
          </li>
          <li className={hasKey ? 'done' : ''}>
            <span className="step-title">Add your Gemini API key</span>
            <div className="step-body">
              {!loaded ? (
                'Checking…'
              ) : hasKey ? (
                <>
                  Key saved on this device. <a href={href('settings')}>Change it in Settings</a>.
                </>
              ) : (
                <>
                  Needed later to create questions from your book.
                  <div className="row">
                    <a className="btn btn-quiet" href={href('settings')}>
                      Open Settings
                    </a>
                  </div>
                </>
              )}
            </div>
          </li>
          <li className="later">
            <span className="step-title">Import your book</span>
            <div className="step-body">Coming in the next build step.</div>
          </li>
          <li className="later">
            <span className="step-title">Create questions</span>
            <div className="step-body">Coming after the book import.</div>
          </li>
        </ol>
      </section>
    </div>
  )
}
