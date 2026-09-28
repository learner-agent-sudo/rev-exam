import Dexie, { type EntityTable } from 'dexie'

export interface SettingRow {
  key: string
  value: unknown
}

// All study data lives in the browser's IndexedDB on this device.
// Later build steps add tables for books, passages, questions and answer records.
export class RevExamDB extends Dexie {
  settings!: EntityTable<SettingRow, 'key'>

  constructor(name = 'rev-exam') {
    super(name)
    this.version(1).stores({
      settings: 'key',
    })
  }
}

export const db = new RevExamDB()
