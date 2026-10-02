// Free Gemini allowances are per model, per day, and reset at midnight Pacific time.
// This keeps a local count of requests made today and which models have run out, so the
// app can say when the limit resets and skip used-up models instead of wasting requests.
// Stored per device in localStorage (question creation happens on one device).

const KEY = 'rev-exam:gemini-usage'
const PACIFIC = 'America/Los_Angeles'

interface Usage {
  /** Pacific date the counts belong to, "YYYY-MM-DD". */
  day: string
  requests: Record<string, number>
  usedUp: string[]
}

/** The Pacific-time date, "YYYY-MM-DD", for a moment in time. */
export function pacificDay(now: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: PACIFIC, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** The next midnight in Pacific time after `now` (when free daily limits reset). */
export function nextPacificReset(now: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC,
    hourCycle: 'h23',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(now)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const sinceMidnight = (get('hour') * 3600 + get('minute') * 60 + get('second')) * 1000 + (now % 1000)
  return now - sinceMidnight + 24 * 3600 * 1000
}

function read(now: number): Usage {
  const today = pacificDay(now)
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Usage | null
    if (stored && stored.day === today) return stored
  } catch {
    // Unavailable or damaged storage: start counting afresh.
  }
  return { day: today, requests: {}, usedUp: [] }
}

function write(usage: Usage) {
  try {
    localStorage.setItem(KEY, JSON.stringify(usage))
  } catch {
    // Counting is a convenience; never let it break question creation.
  }
}

export function recordRequest(model: string, now = Date.now()) {
  const usage = read(now)
  usage.requests[model] = (usage.requests[model] ?? 0) + 1
  write(usage)
}

export function markUsedUp(model: string, now = Date.now()) {
  const usage = read(now)
  if (!usage.usedUp.includes(model)) usage.usedUp.push(model)
  write(usage)
}

export interface TodayUsage {
  requests: Record<string, number>
  usedUp: string[]
  resetsAt: number
}

export function todayUsage(now = Date.now()): TodayUsage {
  const usage = read(now)
  return { requests: usage.requests, usedUp: usage.usedUp, resetsAt: nextPacificReset(now) }
}
