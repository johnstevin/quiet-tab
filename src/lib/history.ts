import { getItem, setItem } from './storage'

/**
 * Local search history.
 *
 * This is OURS, not Google's. Google shows your account search history in its
 * own dropdown and exposes no API for it, so the clock-icon rows here are
 * populated from searches made through this extension only. Everything stays in
 * chrome.storage.local on this machine — nothing is uploaded anywhere.
 *
 * Can be switched off (and wiped) from the context menu; when off, nothing is
 * recorded at all rather than recorded-but-hidden.
 */

const KEY = 'searchHistory'

/** Entries retained. Beyond this the oldest fall off. */
const MAX_ENTRIES = 50

export async function readHistory(): Promise<string[]> {
  const raw = await getItem<unknown>(KEY)
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

/**
 * Record a search, most-recent-first.
 *
 * Re-searching an existing term moves it to the front rather than duplicating,
 * which is what makes the list useful instead of a log.
 */
export async function pushHistory(query: string): Promise<void> {
  const text = query.trim()
  if (!text) return

  const current = await readHistory()
  const deduped = current.filter((item) => item.toLowerCase() !== text.toLowerCase())
  await setItem(KEY, [text, ...deduped].slice(0, MAX_ENTRIES))
}

export async function clearHistory(): Promise<void> {
  await setItem(KEY, [])
}

/**
 * History entries matching `query`, best match first.
 *
 * Prefix matches rank above substring matches — typing "git" should surface
 * "github actions" before "install git", mirroring address-bar behaviour. An
 * empty query returns the most recent entries, so focusing an empty box shows
 * where you have been.
 */
export function matchHistory(history: string[], query: string, limit: number): string[] {
  const text = query.trim().toLowerCase()
  if (!text) return history.slice(0, limit)

  const prefix: string[] = []
  const contains: string[] = []

  for (const entry of history) {
    const lower = entry.toLowerCase()
    // Skip an entry identical to what is already typed — it would be a no-op row.
    if (lower === text) continue
    if (lower.startsWith(text)) prefix.push(entry)
    else if (lower.includes(text)) contains.push(entry)
  }

  return [...prefix, ...contains].slice(0, limit)
}
