import { useEffect, useMemo, useState } from 'react'
import { isExtensionRuntime } from '../lib/env'
import { matchHistory, readHistory } from '../lib/history'
import { ENGINES, HISTORY_LIMIT, TOTAL_ROWS_MAX, fetchSuggestions } from '../lib/search'
import type { Suggestion } from '../lib/search'
import type { EngineId } from '../lib/types'

/**
 * Debounce in milliseconds.
 *
 * 140ms is short enough that suggestions feel keystroke-driven, but long enough
 * that typing a word does not fire a request per character.
 */
const DEBOUNCE_MS = 140

/**
 * Dropdown rows: local history first, then live suggestions.
 *
 * Ordering follows what a browser address bar does — your own past searches
 * outrank a stranger's guesses at what you meant.
 *
 * Returns an empty list rather than throwing: suggestions are a convenience,
 * and the endpoints are undocumented enough that failures should be invisible.
 */
export function useSuggest(
  query: string,
  engine: EngineId,
  enabled: boolean,
  keepHistory: boolean,
): Suggestion[] {
  const [history, setHistory] = useState<string[]>([])
  const [remote, setRemote] = useState<Suggestion[]>([])

  // Re-read history each time the box opens, so a search made in another tab
  // shows up here without a reload.
  useEffect(() => {
    if (!enabled || !keepHistory) {
      setHistory([])
      return
    }

    let alive = true
    void (async () => {
      const list = await readHistory()
      if (alive) setHistory(list)
    })()

    return () => {
      alive = false
    }
  }, [enabled, keepHistory])

  useEffect(() => {
    const text = query.trim()

    if (!enabled || text.length === 0) {
      setRemote([])
      return
    }

    // The suggestion endpoints send no CORS headers, so they only work from an
    // extension page holding host_permissions. Skip quietly on the dev server
    // instead of filling the console with failed requests.
    if (!isExtensionRuntime()) {
      setRemote([])
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const list = await fetchSuggestions(ENGINES[engine], text, controller.signal)
          if (!controller.signal.aborted) setRemote(list)
        } catch {
          // Aborted, offline, throttled, or the response shape changed.
        }
      })()
    }, DEBOUNCE_MS)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query, engine, enabled])

  return useMemo(() => {
    const matched = matchHistory(history, query, HISTORY_LIMIT)
    const seen = new Set(matched.map((text) => text.toLowerCase()))

    const rows: Suggestion[] = matched.map((text) => ({ text, kind: 'history' }))

    for (const item of remote) {
      if (rows.length >= TOTAL_ROWS_MAX) break
      const key = item.text.toLowerCase()
      // A term that is already a history row would otherwise appear twice.
      if (seen.has(key)) continue
      seen.add(key)
      rows.push(item)
    }

    return rows
  }, [history, remote, query])
}
