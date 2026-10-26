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
        } catch (err) {
          if (controller.signal.aborted) return

          // Self-diagnosing. A CORS error here means exactly one thing — Chrome
          // did not apply the host permission to this request — and the only
          // way to tell that apart from an ordinary network failure is to ask.
          //
          // Note the `/*`: a match pattern's path segment is required, and
          // `https://host/` matches ONLY the root path. An earlier manifest
          // used that form and the suggestion endpoints were refused in Chrome
          // while still working under Playwright's bundled Chromium.
          let permissionNote = '\n  host 权限：无法查询（非扩展环境）'
          try {
            if (typeof chrome !== 'undefined' && chrome.permissions) {
              const origin = `${new URL(ENGINES[engine].suggestUrls[0]!(text)).origin}/*`
              const held = await chrome.permissions.contains({ origins: [origin] })
              permissionNote = held
                ? `\n  host 权限：已授予 ${origin} —— 问题不在权限，` +
                  '请检查网络是否能访问该域名。'
                : `\n  host 权限：未授予 ${origin}\n` +
                  '  → 在 chrome://extensions 把本扩展「移除」后重新「加载已解压的扩展程序」。' +
                  '对已安装的未打包扩展，新增或改动的 host_permissions 不会随「刷新」生效。'
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
