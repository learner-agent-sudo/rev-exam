# Rev Exam

A personal exam-revision app. It turns a textbook into exam-style multiple-choice
questions and, for every answer, shows the **exact passage** from the book.

First target: IAPP **CIPP/US**. Later: China bar exam (法考). See [docs/design.md](docs/design.md).

## Status

Build steps 1–2 of the plan are done:

- Installs on Android and laptop (Chrome), and opens offline
- Settings: save and check a Gemini API key (stored only on the device)
- Book: import a DRM-free EPUB, browse its contents, search it, and read it with
  chapter/section and print page numbers (when the EPUB has them)
- Questions and study modes arrive in the next steps

## Using it

Open the app at **https://learner-agent-sudo.github.io/rev-exam/** in Chrome, then:

1. Install it: Chrome menu ⋮ → "Install app" / "Add to home screen".
2. Settings → paste a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) → "Save and check".
3. Book → choose your textbook's EPUB file (best done on the laptop).

## What never goes in this repo

This repository is public. Books, extracted passages, generated questions, past papers
and API keys stay on your devices (and, later, your own Google Drive) only.

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # unit tests
npm run test:e2e   # build + browser tests (phone and laptop sizes)
npm run lint
```

`npm run icons` re-renders the PNG app icons from `public/favicon.svg`.
If Playwright's own Chromium isn't installed, set `PW_CHROMIUM_PATH` to a Chromium binary.

Pushes to `main` (or the current development branch) run the tests and publish to GitHub Pages.
