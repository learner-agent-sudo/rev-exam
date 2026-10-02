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

/** Opens "Choose chapters instead" if needed and ticks a chapter. */
async function pickChapter(page: Page, name: RegExp) {
  const picker = page.locator('details.chapter-picker')
  await picker.waitFor({ state: 'attached' })
  if ((await picker.getAttribute('open')) === null) await picker.locator('summary').click()
  await page.getByRole('checkbox', { name }).check()
}

test('concept questions work without AI, explain every option and cite the book', async ({ page }) => {
  await importLawsBook(page)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Study' }).click()
  await expect(page.getByText('No questions yet.')).toBeVisible()

  await page.getByRole('button', { name: 'Create from my book' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'concept questions' })).toHaveText(
    'Created 16 concept questions: 10 on definitions, 6 on what laws and agencies do.',
  )

  // Chapter 3 has five sentences saying what a law does.
  await page.getByLabel('Questions', { exact: true }).selectOption('cloze')
  await page.getByLabel('Chapter', { exact: true }).selectOption('Chapter 3. Federal Privacy Laws')
  await page.getByRole('link', { name: 'Start practice' }).click()

  await expect(page.getByText('1 / 5')).toBeVisible()
  await expect(page.locator('.stem')).toHaveText(/^Which law .+\?$/)
  await answerAndCheckSource(page)
  // Every option says what it really is.
  await expect(page.locator('.option .why')).toHaveCount(4)
  const sentence = await page.locator('figure.source mark').textContent()
  expect(sentence).toMatch(/^The .+ was enacted in \d{4}/)

  await page.getByRole('link', { name: 'Read it in the book →' }).click()
  await expect(page.locator('.reader-body .target')).toContainText(sentence!)
  await page.goBack()

  // The session restarts after leaving it; finish a fresh one.
  for (let i = 0; i < 5; i++) {
    await answerAndCheckSource(page)
    await page.getByRole('button', { name: i === 4 ? 'See results' : 'Next question →' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^\d of 5 correct$/)
})

test('definition questions ask about the book’s concepts', async ({ page }) => {
  await importLawsBook(page)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Study' }).click()
  await page.getByRole('button', { name: 'Create from my book' }).click()
  await page.getByLabel('Questions', { exact: true }).selectOption('cloze')
  await page.getByLabel('Chapter', { exact: true }).selectOption('Glossary')
  await page.getByRole('link', { name: 'Start practice' }).click()

  await expect(page.getByText('1 / 4')).toBeVisible()
  await expect(page.locator('.stem')).toHaveText(/^Which (of the following best describes|term does the book describe as) “.+”\?$/)
  await page.locator('.option').first().click()
  await expect(page.locator('.option.correct .why')).toHaveText(/^This is how the book describes “.+”\.$/)
  await expect(page.locator('figure.source figcaption')).toContainText('Glossary')
})

test('exam-style questions from Gemini are checked before they are kept', async ({ page }) => {
  const prompts: string[] = []
  const configs: { thinkingConfig?: unknown }[] = []
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const url = route.request().url()
    if (!url.includes(':generateContent')) {
      return route.fulfill({
        json: { models: [{ name: 'models/gemini-3-flash', displayName: 'Gemini 3 Flash', supportedGenerationMethods: ['generateContent'] }] },
      })
    }
    const prompt: string = route.request().postDataJSON().contents[0].parts[0].text
    prompts.push(prompt)
    configs.push(route.request().postDataJSON().generationConfig)
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
    return route.fulfill({
      json: {
        candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 400, thoughtsTokenCount: 50 },
      },
    })
  })

  await page.goto('./#/settings')
  await page.getByLabel('API key', { exact: true }).fill('test-key')
  await page.getByRole('button', { name: 'Save and check' }).click()
  await expect(page.getByText('The key works.')).toBeVisible()

  await importLawsBook(page)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Study' }).click()
  await pickChapter(page, /Chapter 3\. Federal Privacy Laws/)
  await expect(page.getByText(/1 part, about 2 questions before the check: 2 requests/)).toBeVisible()
  await page.getByRole('button', { name: 'Create for selected chapters' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Finished.' })).toContainText('Finished. 1 question kept, 1 dropped by the check.')
  expect(prompts).toHaveLength(2)
  // Gemini 3 models are asked to think less, which is what makes them fast enough.
  expect(configs.map((c) => c.thinkingConfig)).toEqual([{ thinkingLevel: 'low' }, { thinkingLevel: 'low' }])
  await page.getByText('Details for troubleshooting').click()
  await expect(page.locator('.job-log')).toContainText('Model: gemini-3-flash')
  await expect(page.locator('.job-log li')).toHaveText([
    /Part 1 · Writing questions: \d+\.\d s · tokens 1,200 in, 400 out, 50 thinking$/,
    /Part 1 · Checking questions: \d+\.\d s · tokens 1,200 in, 400 out, 50 thinking$/,
    /Part 1 · kept 1, dropped 1$/,
  ])
  expect(prompts[0]).toContain('Write 2 multiple-choice questions')
  expect(prompts[1]).toContain('Answer each multiple-choice question')
  await page.locator('details.chapter-picker > summary').click()
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

test('long chapter names never make the page wider than the screen', async ({ page }) => {
  await page.goto('./#/book')
  const options = sampleLawsHandbook()
  const longTitle = 'UNIT 1 - INTRODUCTION TO WORLD CULTURES AND GEOGRAPHY AND MANY OTHER LONG WORDS'
  options.chapters[3].body = options.chapters[3].body.replace('Chapter 4. Key Privacy Concepts', longTitle)
  options.toc = options.toc!.map((t) => (t.title === 'Chapter 4. Key Privacy Concepts' ? { ...t, title: longTitle } : t))
  const data = await makeEpub(options)
  await page.getByLabel('EPUB file').setInputFiles({ name: 'long.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(data) })
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toBeVisible()
  await page.goto('./#/study')
  await page.getByRole('button', { name: 'Create from my book' }).click()
  await page.getByLabel('Chapter', { exact: true }).selectOption(longTitle)
  await page.getByRole('link', { name: 'Start practice' }).click()
  await expect(page.locator('.chip-plain')).toHaveText(longTitle)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('shows what Gemini is doing while a slow request runs', async ({ page }) => {
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    if (!route.request().url().includes(':generateContent')) {
      return route.fulfill({
        json: { models: [{ name: 'models/gemini-3-flash', displayName: 'Gemini 3 Flash', supportedGenerationMethods: ['generateContent'] }] },
      })
    }
    await new Promise((resolve) => setTimeout(resolve, 3000))
    return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: '{"questions": []}' }] } }] } })
  })
  await page.goto('./#/settings')
  await page.getByLabel('API key', { exact: true }).fill('test-key')
  await page.getByRole('button', { name: 'Save and check' }).click()
  await expect(page.getByText('The key works.')).toBeVisible()
  await importLawsBook(page)
  await page.goto('./#/study')
  await pickChapter(page, /Chapter 3\. Federal Privacy Laws/)
  await page.getByRole('button', { name: 'Create for selected chapters' }).click()

  await expect(page.locator('.live-step')).toHaveText(/^Writing questions… [1-3] s$/)
  await expect(page.getByRole('status').filter({ hasText: 'Finished.' })).toBeVisible({ timeout: 15_000 })
})

test('when a model’s daily allowance runs out, carries on with another free model', async ({ page }) => {
  const calls: string[] = []
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const url = route.request().url()
    if (!url.includes(':generateContent')) {
      return route.fulfill({
        json: {
          models: ['gemini-3-flash', 'gemini-3.1-flash-lite'].map((id) => ({
            name: `models/${id}`,
            supportedGenerationMethods: ['generateContent'],
          })),
        },
      })
    }
    const model = /models\/([^:]+):/.exec(url)![1]
    calls.push(model)
    if (model === 'gemini-3-flash') {
      return route.fulfill({
        status: 429,
        json: {
          error: {
            code: 429,
            message: 'You exceeded your current quota.',
            details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }],
          },
        },
      })
    }
    const prompt: string = route.request().postDataJSON().contents[0].parts[0].text
    const coppa = Number(/\[P(\d+)\] The Children's Online Privacy Protection Act/.exec(prompt)?.[1])
    const reply = prompt.startsWith('Answer each')
      ? { checks: [{ question: 1, answer: 0, ambiguous: false }] }
      : {
          questions: [
            {
              stem: 'Which law protects children online?',
              options: ['COPPA', 'FERPA', 'GLBA', 'VPPA'],
              correctIndex: 0,
              explanations: ['Yes.', 'No.', 'No.', 'No.'],
              sourcePassages: [coppa],
            },
          ],
        }
    return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] } })
  })

  await page.goto('./#/settings')
  await page.getByLabel('API key', { exact: true }).fill('test-key')
  await page.getByRole('button', { name: 'Save and check' }).click()
  await expect(page.getByLabel('Preferred model')).toHaveValue('gemini-3-flash')
  await importLawsBook(page)
  await page.goto('./#/study')
  await pickChapter(page, /Chapter 3\. Federal Privacy Laws/)
  await page.getByRole('button', { name: 'Create for selected chapters' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Finished.' })).toContainText('Finished. 1 question kept')
  expect(calls).toEqual(['gemini-3-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite'])
  await page.getByText('Details for troubleshooting').click()
  await expect(page.locator('.job-log')).toContainText(
    'daily free limit used up for gemini-3-flash; continuing with gemini-3.1-flash-lite',
  )
  await expect(page.locator('.allowance')).toContainText('used up: gemini-3-flash')

  // A second run skips the used-up model straight away.
  calls.length = 0
  await pickChapter(page, /Chapter 4\. Key Privacy Concepts/)
  await page.getByRole('button', { name: 'Create for selected chapters' }).click()
  // Chapter 4 has no COPPA passage, so the simulated Gemini's draft is rejected: a distinct result.
  await expect(page.getByRole('status').filter({ hasText: 'Finished.' })).toContainText('Finished. 0 questions kept, 2 dropped')
  expect(calls).toEqual(['gemini-3.1-flash-lite'])
})

test('one click creates questions for the whole book, and continues later from where it stopped', async ({ page }) => {
  const calls: string[] = []
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    if (!route.request().url().includes(':generateContent')) {
      return route.fulfill({ json: { models: [{ name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent'] }] } })
    }
    const prompt: string = route.request().postDataJSON().contents[0].parts[0].text
    calls.push(prompt.startsWith('Answer each') ? 'check' : 'write')
    const coppa = Number(/\[P(\d+)\] The Children's Online Privacy Protection Act/.exec(prompt)?.[1])
    const reply = prompt.startsWith('Answer each')
      ? { checks: [{ question: 1, answer: 0, ambiguous: false }] }
      : {
          // Only the chapter with the COPPA passage gets a usable question.
          questions: [
            { stem: 'Which law protects children online?', options: ['COPPA', 'FERPA', 'GLBA', 'VPPA'], correctIndex: 0, explanations: ['Yes.', 'No.', 'No.', 'No.'], sourcePassages: [coppa] },
          ],
        }
    return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] } })
  })
  await page.goto('./#/settings')
  await page.getByLabel('API key', { exact: true }).fill('test-key')
  await page.getByRole('button', { name: 'Save and check' }).click()
  await expect(page.getByText('The key works.')).toBeVisible()
  await importLawsBook(page)
  await page.goto('./#/study')

  // The chapter list starts folded away; one button covers the whole book.
  await expect(page.getByRole('checkbox', { name: /Chapter 3/ })).toBeHidden()
  await expect(page.locator('.whole-book')).toContainText('5 parts, about 10 questions before the check: 10 requests to Gemini.')
  await page.getByRole('button', { name: 'Create for the whole book' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Finished.' })).toContainText('Finished. 1 question kept')
  expect(calls).toEqual(['write', 'write', 'write', 'check', 'write', 'write'])
  await expect(page.locator('details.chapter-picker > summary')).toContainText('1 of 5 chapters done')
  // Parts that produced no questions are offered again, from where it stopped.
  await expect(page.getByRole('button', { name: 'Continue with the rest of the book' })).toBeVisible()
  await expect(page.locator('.whole-book')).toContainText('4 parts')
})
