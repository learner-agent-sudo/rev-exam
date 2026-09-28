import { expect, test, type Page } from '@playwright/test'
import { makeEpub, sampleHandbook } from '../src/book/testing/makeEpub.ts'

async function importEpub(page: Page, data: Uint8Array, name = 'handbook.epub') {
  await page.getByLabel('EPUB file').setInputFiles({ name, mimeType: 'application/epub+zip', buffer: Buffer.from(data) })
}

async function importSample(page: Page) {
  await page.goto('./#/book')
  await importEpub(page, await makeEpub(sampleHandbook()))
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toContainText(
    'Imported “Sample Privacy Handbook”: 2 chapters',
  )
}

test('imports a book and reads it by contents', async ({ page }) => {
  await importSample(page)
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toContainText('with print page numbers')
  const card = page.getByRole('region', { name: 'Sample Privacy Handbook' })
  await expect(card.getByRole('heading', { name: 'Sample Privacy Handbook' })).toBeVisible()

  await card.getByRole('link', { name: 'Fair Information Practices' }).click()
  const reader = page.locator('.reader-body')
  await expect(reader.getByRole('heading', { name: 'Fair Information Practices' })).toBeVisible()
  await expect(reader.getByText('Notice: tell people what is collected.')).toBeVisible()
  await expect(reader.getByText('p. 2')).toBeVisible()
  await expect(page.locator('.crumbs')).toHaveText('Chapter 1. Foundations of Privacy › Fair Information Practices')

  await page.getByRole('link', { name: 'Next →' }).click()
  await expect(reader.getByRole('heading', { name: 'Chapter 2. Enforcement' })).toBeVisible()
  await expect(reader.getByRole('cell', { name: 'Consumer protection' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Next →' })).toHaveCount(0)

  await page.getByRole('link', { name: '← Contents' }).click()
  await expect(page.getByRole('link', { name: 'Continue reading' })).toBeVisible()

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }).click()
  await expect(page.getByText('Imported “Sample Privacy Handbook”.')).toBeVisible()
})

test('finds a passage and shows it highlighted in the book', async ({ page }) => {
  await importSample(page)
  await page.getByLabel('Search the book').fill('trade commission')
  await page.getByRole('button', { name: 'Search' }).click()

  await expect(page.getByText('1 matching passage.')).toBeVisible()
  const hit = page.locator('ol.hits a')
  await expect(hit).toContainText('Chapter 2. Enforcement')
  await expect(hit.locator('mark')).toHaveText('Trade Commission')
  await hit.click()

  const target = page.locator('.reader-body .target')
  await expect(target).toHaveText('The Federal Trade Commission brings actions against unfair or deceptive practices.')
  await expect(target).toBeInViewport()

  await page.getByRole('link', { name: '← Search results' }).click()
  await expect(page.getByLabel('Search the book')).toHaveValue('trade commission')
  await expect(page.locator('ol.hits a')).toHaveCount(1)
})

test('keeps the book readable offline and can delete it', async ({ page, context }) => {
  await importSample(page)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await context.route('**/*', (route) => route.abort())
  await context.setOffline(true)

  await page.reload()
  await page.getByRole('link', { name: 'Start reading' }).click()
  await expect(page.locator('.reader-body').getByText('Privacy law protects personal information about individuals.')).toBeVisible()

  await page.getByRole('link', { name: '← Contents' }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete book' }).click()
  await expect(page.getByRole('heading', { name: 'Import your book' })).toBeVisible()
})

test('explains why a book cannot be imported', async ({ page }) => {
  await page.goto('./#/book')
  await importEpub(page, await makeEpub({ chapters: [{ file: 'a.xhtml', body: '<p>Locked</p>' }], encrypted: ['a.xhtml'] }))
  await expect(page.getByRole('alert')).toContainText('copy-protected (DRM)')

  await importEpub(page, new TextEncoder().encode('not an epub'), 'notes.txt')
  await expect(page.getByRole('alert')).toContainText("isn't a valid EPUB")
})
