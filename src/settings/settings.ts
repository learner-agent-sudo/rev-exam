import { db, type RevExamDB } from '../db/db'

export interface Settings {
  // Device-only: the API key must never be synced or exported.
  geminiApiKey: string
  geminiModel: string
}

export type SettingKey = keyof Settings

export async function loadSettings(database: RevExamDB = db): Promise<Partial<Settings>> {
  const rows = await database.settings.toArray()
  return Object.fromEntries(rows.map((row) => [row.key, row.value])) as Partial<Settings>
}

export async function saveSetting<K extends SettingKey>(
  key: K,
  value: Settings[K],
  database: RevExamDB = db,
): Promise<void> {
  await database.settings.put({ key, value })
}

export async function clearSetting(key: SettingKey, database: RevExamDB = db): Promise<void> {
  await database.settings.delete(key)
}
