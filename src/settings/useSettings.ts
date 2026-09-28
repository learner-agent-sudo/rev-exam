import { useCallback, useEffect, useState } from 'react'
import { clearSetting, loadSettings, saveSetting, type SettingKey, type Settings } from './settings'

export function useSettings() {
  const [settings, setSettings] = useState<Partial<Settings>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    loadSettings().then((values) => {
      if (!active) return
      setSettings(values)
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [])

  const save = useCallback(async <K extends SettingKey>(key: K, value: Settings[K]) => {
    await saveSetting(key, value)
    setSettings((prev) => ({ ...prev, [key]: value }))
  }, [])

  const clear = useCallback(async (key: SettingKey) => {
    await clearSetting(key)
    setSettings((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  return { settings, loaded, save, clear }
}
