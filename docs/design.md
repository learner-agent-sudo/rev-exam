# Exam Revision Tool — Design (draft)

Status: in progress. Build steps 1–2 done (app shell, book import and reader).
Last updated: 2026-09-28

## 1. Goal

A personal revision tool that turns study material into multiple-choice practice,
and always backs each answer with the **exact passage** from the source.

| Stage | Exam | Source | What the tool does |
|---|---|---|---|
| 1 | CIPP/US (IAPP) | Textbook (EPUB) | Generates questions per the IAPP exam blueprint; shows exact book passages |
| 1b | China bar exam (法考), objective part | Downloaded past papers with answers | Uses past questions as the pool; shows the paper's own explanation (解析) |
| 2 | China bar exam, written part (主观题) | Past written questions + model answers | AI grading and feedback in Chinese |

## 2. Decisions so far

| Topic | Decision |
|---|---|
| Users | Just the owner (single user) |
| Devices | Laptop + Android phone |
| Offline | Yes, for studying. AI features need internet |
| Sync | Yes, between laptop and phone (proposed: Google Drive, see §5) |
| AI provider | Google Gemini, via a Gemini API key (see §8) |
| First exam | CIPP/US |
| Book format | EPUB, opens in a normal e-reader (so likely no DRM) |
| Categories | Official IAPP CIPP/US Body of Knowledge + Exam Blueprint |
| References | Exact passage text from the book, never AI-reworded |
| Question style | Like the real exam: single questions and scenario sets |
| Session types | Timed mock exam and untimed practice |
| China bar pool | Mainly real past questions; AI-created ones later |
| China bar references | Keep scope small: past-paper explanations only, no statute database yet |
| Exam date | None booked; tool is for ongoing revision |
| Code | Written and maintained by Claude, pushed in small pieces |
| Device roles | Laptop: import book, create questions, written answers. Phone: multiple-choice study. Both sync |

## 3. Architecture

- **Installable web app (PWA).** One app for laptop and Android: open the website once,
  "Install", then it works like an app, including offline.
- **No server of our own.** The app is static files, hosted free on GitHub Pages.
- **Data stays with the user.** Book, questions and progress are stored in the browser
  (IndexedDB) on each device, and synced through the user's own Google Drive.
- **Gemini is called directly from the app** using the user's own API key, entered in
  Settings and stored only on the device.

**The GitHub repo is public.** It must never contain the book, extracted passages,
generated questions, past papers or API keys. Only the app's code goes in the repo.

### "Create online, study offline"

Gemini needs internet. So the tool creates a question bank in advance while online.
Practice, mock exams and reading passages then work fully offline.

## 4. CIPP/US pipeline

1. **Import EPUB.** Done in the browser (JSZip + DOMParser). The app splits the book into blocks
   (headings, paragraphs, list items, tables) in reading order. Each block keeps:
   - its original text (whitespace tidied; bold/italic and images are not kept)
   - its location: chapter › section › subsection, from the contents list and the headings
   - the print page number, only when the EPUB includes page markers
   - its position, so the reader can open the surrounding text and highlight it
     (`#/book/read/<book>/<block>?mark=1`; question references will use the same link)
   Copy-protected (DRM) files are detected and refused with a clear message.
2. **Tag passages by exam topic.** Gemini assigns each passage to a Body of Knowledge
   topic (e.g. I.B, II.C). The book's chapters do not map 1:1 to the exam topics.
3. **Generate questions** following the blueprint's question ranges per topic:
   - single questions (4 options, one correct)
   - scenario sets: a fact pattern followed by several questions
   - each question stores: the correct answer, why each option is right or wrong, and
     the IDs of the source passage(s)
4. **Check each question** with a second Gemini pass against its passage. Drop it if the
   answer is not clearly supported or two options could be right. The app also checks
   in code that any quoted text really appears in the passage.
5. **Show references from storage.** The passage shown to the user is always the stored
   book text, so it is exact.

Generation runs in the background with a progress bar, and resumes if interrupted.
The bank starts at a few hundred questions; more can be generated later, targeted at
weak topics.

## 5. Sync (proposed: Google Drive)

- The user signs in with Google once per device. The app keeps its data in a hidden,
  app-only folder in the user's own Drive (`appDataFolder`), which other apps cannot see.
- Each device works offline and syncs when it is online again.
- **No lost progress.** Study history is saved as a list of answer records, and each
  device only ever adds records. Merging two lists never overwrites anything, so
  studying on both devices while offline is safe.
- The question bank and book passages sync too, so the phone never needs to re-import
  the book or re-generate questions.
- One-time setup: create a Google sign-in client ID in Google Cloud Console (Claude will
  give click-by-click steps). Because it is a personal app, Google will show an
  "unverified app" warning at sign-in; this is expected.

Alternative considered: a hosted database (Supabase/Firebase). It adds another account
and service to maintain, with no real benefit for a single user.

## 6. Study experience

- **Practice mode:** after each answer, show:
  - correct answer
  - why each option is right or wrong
  - the exact passage, highlighted
  - "read more" to open the surrounding book text
- **Exam mode:** timed, no feedback until the end. Then a score by topic and full review.
  Default length follows the real exam (90 questions; 75 scored + 15 unscored on the real
  one). Shorter timed sets are also possible.
- **Confidence:** before answering, tap sure / unsure / guess. A lucky guess is
  treated like a wrong answer for review purposes.
- **Wrong-answer notebook** with spaced review (back after 1 day, 3 days, 7 days, ...).
- **Weak-areas session:** shifts the mix toward the lowest-scoring topics.
- **Shuffled options** every time.
- **Flag a question** as wrong or unclear: it leaves the pool.
- **Progress by topic** over time.

## 7. China bar exam (stage 1b, reduced scope)

- Import past papers (format depends on what can be downloaded) into a question pool.
  Parsing PDF/Word papers into clean questions is fiddly; AI can help, with user review.
- Question types: 单选 (single), 多选 (multiple), 不定项 (indefinite). Multi-answer
  questions are all-or-nothing, like the real exam.
- Reference = the explanation (解析) that comes with the paper. No statute database yet.
- Every question is tagged with its year and source.
- Caveats:
  - Pre-2018 (司法考试) papers were officially published. Since 2018 (法考), papers are
    not officially released; online versions are 回忆版 (reconstructed from memory) and
    may contain errors.
  - Older answers may be outdated by the Civil Code (民法典, 2021) and other changes.
- Same study modes as CIPP/US; UI text can switch to Chinese.

## 8. Gemini

- A Google AI Pro / Google One subscription covers the Gemini app and the AI Studio
  website, but **not** API use from other apps. API use is billed separately.
- An API key from Google AI Studio is free to create. The free tier has daily limits,
  and Google may use free-tier inputs to improve its products. A paid tier is available.
- Use a fast, low-cost ("Flash") model for tagging and generation. Exact model names and
  prices change often; confirm at build time.
- Use Gemini's structured (JSON) output so questions come back in a fixed format.

## 9. Stage 2 (later): written answers

- The real written exam is typed on computer, so answers are typed in the app.
- Gemini grades against a model answer / marking points and gives feedback in Chinese.
- Feedback is a study aid, not a prediction of the official score.

## 10. Known limitations and risks

- AI-generated questions can still be wrong despite the check step. Flagging is essential.
- References show chapter/section; page numbers only if the EPUB has them.
- The EPUB reader was tested on 20 public sample EPUBs (W3C EPUB 3 samples) and synthetic
  EPUB 2/3 files, not on the real CIPP/US textbook. Import time in Chrome: under ~1.5 s for
  textbook-sized books on a laptop.
- The IAPP blueprint changes between versions. The tool stores the blueprint as editable
  data so it can be updated.
- Claude can test the app with a public-domain book and simulated Gemini replies, but not
  with the real book, the real API key or the real phone. Expect a round of fixes after
  the first real run.
- Browser storage can be cleared by the user or the system. Drive sync doubles as a backup.

## 11. Build plan (small pieces, pushed one at a time)

Sync moved earlier (owner's decision, 2026-09-28): the phone is for studying, so it needs
the laptop's question bank as soon as practice mode exists.

1. ✅ App shell: installable, works offline, Settings screen for the Gemini key
2. ✅ EPUB import, contents, search and a book reader view
3. Body of Knowledge data and passage tagging
4. Question generation and checking
5. Practice mode with passages (phone-first)
6. Google Drive sync
7. Exam mode with results by topic
8. Revision features: notebook, confidence, spaced review, weak areas
9. China bar exam mode
10. Stage 2: written-answer grading

## 12. Open items

- [ ] Owner gets a Gemini API key from Google AI Studio
- [x] Owner confirms Google Drive for sync
- [ ] Get the official CIPP/US Body of Knowledge 2.6.1 and Exam Blueprint 2.5.0
      (in effect since 1 Sept 2025) from iapp.org, for the full per-topic question ranges
- [ ] Owner finds downloadable China bar past papers (for stage 1b)
