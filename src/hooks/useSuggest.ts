import { useEffect, useMemo, useState } from 'react'
import { isExtensionRuntime } from '../lib/env'
import { matchHistory, readHistory } from '../lib/history'
import { ENGINES, HISTORY_LIMIT, fetchSuggestions, mergeSuggestions } from '../lib/search'
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
 * Dropdown rows: ten remote results in provider order, annotated with history.
 * Empty input or unavailable suggestions fall back to locally matched history.
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
  const [remote, setRemote] = useState<{ query: string; engine: EngineId; rows: Suggestion[] } | null>(null)

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
      setRemote(null)
      return
    }

    // The suggestion endpoints send no CORS headers, so they only work from an
    // extension page holding host_permissions. Skip quietly on the dev server
    // instead of filling the console with failed requests.
    if (!isExtensionRuntime()) {
      setRemote(null)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const list = await fetchSuggestions(ENGINES[engine], text, controller.signal)
          if (!controller.signal.aborted) setRemote({ query: text, engine, rows: list })
        } catch (err) {
          if (controller.signal.aborted) return

          // Report permission state as evidence, not as a proven root cause.
          // Chrome ignores the path component for host permissions; network
          // policy, redirects and provider changes can still reject a request.
          let permissionNote = '\n  host 权限：无法查询（非扩展环境）'
          try {
            if (typeof chrome !== 'undefined' && chrome.permissions) {
              const origin = `${new URL(ENGINES[engine].suggestUrls[0]!(text)).origin}/*`
              const held = await chrome.permissions.contains({ origins: [origin] })
              permissionNote = held
                ? `\n  host 权限：已授予 ${origin}；请检查 Network 中的响应、重定向和网络策略。`
                : `\n  host 权限：未授予 ${origin}；请在扩展详情检查网站访问权限并按 Chrome 提示授权。`
            }
          } catch {
            /* keep the default note */
          }

          console.warn(
            '[quiet-tab] 搜索建议请求失败：',
            err instanceof Error ? err.message : err,
            '\n  已尝试的端点：\n    ' +
              ENGINES[engine].suggestUrls.map((build) => build(text)).join('\n    '),
            permissionNote,
          )
        }
      })()
    }, DEBOUNCE_MS)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query, engine, enabled])

  return useMemo(() => {
    const matched = keepHistory ? matchHistory(history, query, HISTORY_LIMIT) : []
    const current = enabled && remote?.query === query.trim() && remote.engine === engine
      ? remote.rows : []
    // A new input or engine must never display the previous request's rows.
    return mergeSuggestions(current, matched)
  }, [history, remote, query, engine, enabled, keepHistory])
}
