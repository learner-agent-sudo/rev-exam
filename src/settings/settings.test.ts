import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { RevExamDB } from '../db/db'
import { clearSetting, loadSettings, saveSetting } from './settings'

let database: RevExamDB

afterEach(async () => {
  await database.delete()
})

describe('settings', () => {
  it('saves, loads and clears values', async () => {
    database = new RevExamDB('settings-test')
    expect(await loadSettings(database)).toEqual({})

    await saveSetting('geminiApiKey', 'key-123', database)
    await saveSetting('geminiModel', 'gemini-x-flash', database)
    expect(await loadSettings(database)).toEqual({
      geminiApiKey: 'key-123',
      geminiModel: 'gemini-x-flash',
    })

    await saveSetting('geminiApiKey', 'key-456', database)
    await clearSetting('geminiModel', database)
    expect(await loadSettings(database)).toEqual({ geminiApiKey: 'key-456' })
  })
})
