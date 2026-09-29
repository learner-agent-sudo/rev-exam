import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

// Tells the user when the app is ready offline, and when a new version can be loaded.
export function UpdateToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW()

  // "Ready offline" is just news; let it fade so it never covers answer buttons.
  useEffect(() => {
    if (!offlineReady) return
    const timer = setTimeout(() => setOfflineReady(false), 6000)
    return () => clearTimeout(timer)
  }, [offlineReady, setOfflineReady])

  if (needRefresh) {
    return (
      <div className="toast" role="status">
        <span>A new version is ready.</span>
        <button className="btn" onClick={() => updateServiceWorker()}>
          Update
        </button>
        <button className="btn btn-quiet" onClick={() => setNeedRefresh(false)}>
          Later
        </button>
      </div>
    )
  }

  if (offlineReady) {
    return (
      <div className="toast" role="status">
        <span>Ready to work offline.</span>
        <button className="btn btn-quiet" onClick={() => setOfflineReady(false)}>
          OK
        </button>
      </div>
    )
  }

  return null
}
