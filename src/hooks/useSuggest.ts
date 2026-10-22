import { isExtensionRuntime } from '../lib/env'
import { ENGINES, fetchSuggestions } from '../lib/search'
import { useEffect, useState } from 'react'
import type { EngineId } from '../lib/types'

/**
 * Debounce in milliseconds.
 *
 * 140ms is short enough that suggestions feel keystroke-driven, but long enough
 * that typing a word does not fire a request per character.
 */
const DEBOUNCE_MS = 140

/**
 * Live search suggestions for `query`.
 *
 * Returns an empty list rather than throwing: suggestions are a convenience,
 * and the endpoints are undocumented enough that failures should be invisible.
 */
export function useSuggest(query: string, engine: EngineId, enabled: boolean): string[] {
  const [items, setItems] = useState<string[]>([])

  useEffect(() => {
    const text = query.trim()

    if (!enabled || text.length === 0) {
      setItems([])
      return
    }

    // The suggestion endpoints send no CORS headers, so they only work from an
    // extension page holding host_permissions. Skip quietly on the dev server
    // instead of filling the console with failed requests.
    if (!isExtensionRuntime()) {
      setItems([])
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const list = await fetchSuggestions(ENGINES[engine], text, controller.signal)
          if (!controller.signal.aborted) setItems(list)
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

  return items
}
