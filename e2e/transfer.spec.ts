import { devices, expect, test, type Page } from '@playwright/test'
import { makeEpub, sampleLawsHandbook } from '../src/book/testing/makeEpub.ts'

const TITLE = 'Sample Privacy Handbook with Laws'

/** Presses "Save transfer file" in Settings and keeps the download, as if moved to the other device. */
async function saveTransferFile(page: Page, device: string): Promise<string> {
  await page.goto('./#/settings')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save transfer file' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^rev-exam-\d{4}-\d\d-\d\d-\d{4}\.json\.gz$/)
  const path = test.info().outputPath(`${device}-${download.suggestedFilename()}`)
  await download.saveAs(path)
  return path
}

async function loadTransferFile(page: Page, path: string) {
  await page.goto('./#/settings')
  await page.getByLabel('Transfer file').setInputFiles(path)
}

const transferStatus = (page: Page) => page.locator('#transfer').getByRole('status')

async function answer(page: Page, count: number) {
  await page.goto('./#/study')
  await page.getByRole('link', { name: 'Start practice' }).click()
  for (let i = 0; i < count; i++) {
    if (i) await page.getByRole('button', { name: 'Next question →' }).click()
    await page.locator('.option').first().click()
    await expect(page.locator('.verdict')).toBeVisible()
  }
}

test('questions and answers move between a laptop and a phone with a file', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'laptop', 'One run plays both devices')

  // Laptop: import the book, make questions, answer one and flag it.
  await page.goto('./#/book')
  const epub = Buffer.from(await makeEpub(sampleLawsHandbook()))
  await page.getByLabel('EPUB file').setInputFiles({ name: 'laws.epub', mimeType: 'application/epub+zip', buffer: epub })
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toBeVisible()
  await page.goto('./#/study')
  await page.getByRole('button', { name: 'Create from my book' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'concept questions' })).toContainText('Created 16')
  await answer(page, 1)
  await page.getByRole('button', { name: 'Flag as wrong or unclear' }).click()

  const fromLaptop = await saveTransferFile(page, 'laptop')
  await expect(transferStatus(page)).toHaveText(
    /^Saved rev-exam-.+\.json\.gz \(\d+ KB\) with 1 book, 16 questions and 1 answer\. Look for it in your Downloads\.$/,
  )

  // Phone: a separate browser with nothing in it.
  const phoneContext = await browser.newContext({ ...devices['Pixel 7'], baseURL: testInfo.project.use.baseURL })
  const phone = await phoneContext.newPage()
  await phone.goto('./')
  await phone.getByRole('link', { name: 'Copy from another device' }).click()
  await expect(phone.getByRole('heading', { name: 'Move to another device' })).toBeInViewport()
  await phone.getByLabel('Transfer file').setInputFiles(fromLaptop)
  await expect(transferStatus(phone)).toHaveText(`Added the book “${TITLE}”, 16 new questions and 1 answer.`)

  // The book can be read and practised on the phone, and the flagged question stays out of practice.
  await phone.goto('./#/book')
  await expect(phone.getByRole('heading', { name: TITLE })).toBeVisible()
  await phone.goto('./#/study')
  await expect(phone.locator('.chip').first()).toHaveText('15 questions')
  await answer(phone, 2)
  await expect(phone.locator('figure.source')).toHaveCount(1)

  // Back to the laptop with the phone's practice; loading the same file twice adds nothing.
  const fromPhone = await saveTransferFile(phone, 'phone')
  await loadTransferFile(page, fromPhone)
  await expect(transferStatus(page)).toHaveText('Added 2 answers.')
  await loadTransferFile(page, fromPhone)
  await expect(transferStatus(page)).toHaveText('Nothing new: this device already had everything in the file.')

  // The wrong kind of file is refused with a plain explanation.
  await phone.getByLabel('Transfer file').setInputFiles({ name: 'laws.epub', mimeType: 'application/epub+zip', buffer: epub })
  await expect(phone.locator('#transfer').getByRole('alert')).toHaveText(/^This is not a Rev Exam transfer file\./)

  await phoneContext.close()
})
