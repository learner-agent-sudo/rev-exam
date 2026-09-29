import { expect, test, type Page } from '@playwright/test'
import { makeEpub, sampleLawsHandbook } from '../src/book/testing/makeEpub.ts'

async function importLawsBook(page: Page) {
  await page.goto('./#/book')
  const data = await makeEpub(sampleLawsHandbook())
  await page.getByLabel('EPUB file').setInputFiles({ name: 'laws.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(data) })
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toBeVisible()
}

async function answerAndCheckSource(page: Page) {
  await page.locator('.option').first().click()
  await expect(page.locator('.verdict')).toHaveText(/Correct\.|Not quite\. The answer is [A-D]\./)
  await expect(page.locator('.option.correct')).toHaveCount(1)
  await expect(page.locator('figure.source')).toHaveCount(1)
}

test('fill-in-the-blank questions work without AI, with the book sentence as the reference', async ({ page }) => {
  await importLawsBook(page)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Study' }).click()
  await expect(page.getByText('No questions yet.')).toBeVisible()

  await page.getByRole('button', { name: 'Create from my book' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'fill-in-the-blank questions' })).toContainText(/Created \d+ fill-in-the-blank questions\./)

  await page.getByLabel('Questions', { exact: true }).selectOption('cloze')
  await page.getByLabel('Chapter', { exact: true }).selectOption('Chapter 3. Federal Privacy Laws')
  await page.getByRole('link', { name: 'Start practice' }).click()

  await expect(page.getByText('1 / 6')).toBeVisible()
  await expect(page.locator('.stem .blank')).toHaveCount(1)
  await answerAndCheckSource(page)
  const sentence = await page.locator('figure.source mark').textContent()
  expect(sentence).toMatch(/^The .+ was enacted in \d{4}/)

  await page.getByRole('link', { name: 'Read it in the book →' }).click()
  await expect(page.locator('.reader-body .target')).toContainText(sentence!)
  await page.goBack()

  // The session restarts after leaving it; finish a fresh one.
  for (let i = 0; i < 6; i++) {
    await answerAndCheckSource(page)
    await page.getByRole('button', { name: i === 5 ? 'See results' : 'Next question →' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^\d of 6 correct$/)
})

test('exam-style questions from Gemini are checked before they are kept', async ({ page }) => {
  const prompts: string[] = []
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const url = route.request().url()
    if (!url.includes(':generateContent')) {
      return route.fulfill({
        json: { models: [{ name: 'models/gemini-3-flash', displayName: 'Gemini 3 Flash', supportedGenerationMethods: ['generateContent'] }] },
      })
    }
    const prompt: string = route.request().postDataJSON().contents[0].parts[0].text
    prompts.push(prompt)
    const coppa = Number(/\[P(\d+)\] The Children's Online Privacy Protection Act/.exec(prompt)?.[1])
    const reply = prompt.startsWith('Answer each')
      ? { checks: [{ question: 1, answer: 0, ambiguous: false }, { question: 2, answer: 3, ambiguous: false }] }
      : {
          questions: [
            {
              stem: 'A website for young children collects email addresses. Which law most directly applies?',
              options: ["Children's Online Privacy Protection Act", 'Family Educational Rights and Privacy Act', 'Gramm-Leach-Bliley Act', 'Video Privacy Protection Act'],
              correctIndex: 0,
              explanations: ['It protects children under 13 online.', 'It covers education records.', 'It covers financial institutions.', 'It covers video rental records.'],
              sourcePassages: [coppa],
            },
            {
              stem: 'A question the check disagrees with?',
              options: ['One', 'Two', 'Three', 'Four'],
              correctIndex: 1,
              explanations: ['a', 'b', 'c', 'd'],
              sourcePassages: [coppa],
            },
          ],
        }
    return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] }, finishReason: 'STOP' }] } })
  })

  await page.goto('./#/settings')
  await page.getByLabel('API key', { exact: true }).fill('test-key')
  await page.getByRole('button', { name: 'Save and check' }).click()
  await expect(page.getByText('The key works.')).toBeVisible()

  await importLawsBook(page)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Study' }).click()
  await page.getByRole('checkbox', { name: /Chapter 3\. Federal Privacy Laws/ }).check()
  await expect(page.getByText(/1 part, about 2 questions before the check: 2 requests/)).toBeVisible()
  await page.getByRole('button', { name: 'Create questions' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Finished.' })).toHaveText('Finished. 1 question kept, 1 dropped by the check.')
  expect(prompts).toHaveLength(2)
  expect(prompts[0]).toContain('Write 2 multiple-choice questions')
  expect(prompts[1]).toContain('Answer each multiple-choice question')
  await expect(page.getByRole('checkbox', { name: /Chapter 3\. Federal Privacy Laws/ })).toBeDisabled()

  await page.getByLabel('Questions', { exact: true }).selectOption('ai')
  await page.getByRole('link', { name: 'Start practice' }).click()
  await expect(page.locator('.stem')).toHaveText('A website for young children collects email addresses. Which law most directly applies?')
  await page.getByRole('button', { name: /Video Privacy Protection Act/ }).click()
  await expect(page.locator('.verdict')).toHaveText(/Not quite\. The answer is [A-D]\./)
  await expect(page.locator('.option.correct')).toContainText('It protects children under 13 online.')
  await expect(page.locator('.option.wrong')).toContainText('It covers video rental records.')
  await expect(page.locator('figure.source blockquote')).toHaveText(
    "The Children's Online Privacy Protection Act (COPPA) was enacted in 1998 and protects children under 13 years of age.",
  )

  await page.getByRole('button', { name: 'Flag as wrong or unclear' }).click()
  await expect(page.getByRole('button', { name: /Flagged: removed from practice/ })).toBeVisible()
  await page.getByRole('button', { name: 'See results' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('0 of 1 correct')
  await expect(page.locator('.review-answer')).toHaveText("Answer: Children's Online Privacy Protection Act")

  await page.getByRole('link', { name: 'Back to Study' }).click()
  await expect(page.getByText('No questions yet.')).toBeVisible()
})
