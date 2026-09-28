import { expect, test, type Page } from '@playwright/test'

const GEMINI = 'https://generativelanguage.googleapis.com/**'

async function mockGemini(page: Page, status: number, body: unknown) {
  const keys: (string | null)[] = []
  await page.route(GEMINI, async (route) => {
    keys.push(await route.request().headerValue('x-goog-api-key'))
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  return keys
}

test('moves between screens', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('the exact passage')

  const nav = page.getByRole('navigation', { name: 'Main' })
  for (const [label, heading] of [
    ['Book', 'Book'],
    ['Study', 'Study'],
    ['Settings', 'Settings'],
  ]) {
    await nav.getByRole('link', { name: label }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading)
    await expect(nav.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
  }
})

test('saves and checks a Gemini key, then remembers it', async ({ page }) => {
  const keys = await mockGemini(page, 200, {
    models: [
      { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3-flash', displayName: 'Gemini 3 Flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3-pro', displayName: 'Gemini 3 Pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    ],
  })

  await page.goto('./#/settings')
  await page.getByLabel('API key', { exact: true }).fill('  test-key-123  ')
  await page.getByRole('button', { name: 'Save and check' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'The key works' })).toHaveText('The key works. 3 models available.')
  await expect(page.getByLabel('Model')).toHaveValue('gemini-3-flash')
  expect(keys).toEqual(['test-key-123'])

  await page.getByLabel('Model').selectOption('gemini-3-pro')
  await page.reload()
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('test-key-123')
  await expect(page.getByLabel('Model')).toHaveValue('gemini-3-pro')

  await page.goto('./#/')
  await expect(page.getByText('Key saved on this device.')).toBeVisible()

  await page.goto('./#/settings')
  await page.getByRole('button', { name: 'Remove key' }).click()
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Model')).toHaveCount(0)
})

test('explains a rejected key', async ({ page }) => {
  await mockGemini(page, 400, {
    error: { code: 400, message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] },
  })
  await page.goto('./#/settings')
  await page.getByLabel('API key', { exact: true }).fill('wrong')
  await page.getByRole('button', { name: 'Save and check' }).click()
  await expect(page.getByRole('alert')).toContainText('Google rejected this API key')
})

test('opens with no network once it has loaded', async ({ page, context }) => {
  await page.goto('./')
  await page.evaluate(() => navigator.serviceWorker.ready)

  // Block every network request (including the service worker's own), so only cached files can load.
  await context.route('**/*', (route) => route.abort())
  await context.setOffline(true)

  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('the exact passage')
  await expect(page.getByText('Offline', { exact: true })).toBeVisible()

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings')
})
