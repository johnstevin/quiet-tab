import type { EngineId } from './types'

/**
 * Search engines and their suggestion endpoints.
 *
 * NOTE ON THE SUGGESTION APIS: all three are undocumented endpoints that
 * browsers use for their own address bars. They are not supported public APIs —
 * the shapes were verified by hand, but the providers can change or throttle
 * them without notice, so every caller treats a failure as "no suggestions"
 * rather than an error worth showing.
 *
 * They also send no CORS headers, which is why suggestions only work inside the
 * extension (where host_permissions apply) and never on the dev server.
 */

export type Engine = {
  id: EngineId
  label: string
  /** Compact label for the engine picker and the context menu. */
  short: string
  /** Placeholder shown in the input. */
  placeholder: string
  url: (query: string) => string
  /** Hand off to the engine's conversational mode, where one exists. */
  aiUrl: ((query: string) => string) | null
  /**
   * Suggestion endpoints, tried in order until one returns rows.
   *
   * Prefer Google's web-search payload (entities and thumbnails), then the
   * omnibox payload, then plain OpenSearch. These are undocumented endpoints,
   * so a refusal or format change must not break ordinary search.
   */
  suggestUrls: Array<(query: string) => string>
}

const enc = encodeURIComponent

export const ENGINES: Record<EngineId, Engine> = {
  google: {
    id: 'google',
    label: 'Google',
    short: 'Google',
    placeholder: '搜索 Google 或输入网址',
    url: (q) => `https://www.google.com/search?q=${enc(q)}`,
    // udm=50 is Google's canonical AI Mode flag (udm=14 is classic web-only
    // results). Cross-checked against several independent sources.
    //
    // IMPORTANT: this is a HANDOFF, not a reimplementation. Google's AI Mode is
    // a server-side feature of its own result page with no public API, so an
    // extension cannot render AI answers itself.
    aiUrl: (q) => `https://www.google.com/search?udm=50&q=${enc(q)}`,
    suggestUrls: [
      // Web-search data includes entity thumbnails/titles/descriptions and ten
      // results. xssi=t returns JSON, not executable JSONP; oe prevents mojibake.
      (q) => `https://suggestqueries.google.com/complete/search?client=gws-wiz&hl=zh-CN&xssi=t&oe=utf-8&q=${enc(q)}`,
      (q) => `https://suggestqueries.google.com/complete/search?client=chrome&hl=zh-CN&oe=utf-8&q=${enc(q)}`,
      (q) => `https://suggestqueries.google.com/complete/search?client=firefox&hl=zh-CN&oe=utf-8&q=${enc(q)}`,
    ],
  },

  bing: {
    id: 'bing',
    label: 'Bing',
    short: 'Bing',
    placeholder: '搜索 Bing 或输入网址',
    url: (q) => `https://www.bing.com/search?q=${enc(q)}`,
    // Bing's Copilot has no stable query-string entry point equivalent to
    // udm=50, so no AI handoff is offered rather than guessing at a URL.
    aiUrl: null,
    suggestUrls: [(q) => `https://api.bing.com/osjson.aspx?query=${enc(q)}`],
  },

  duckduckgo: {
    id: 'duckduckgo',
    label: 'DuckDuckGo',
    short: 'DDG',
    placeholder: '搜索 DuckDuckGo 或输入网址',
    url: (q) => `https://duckduckgo.com/?q=${enc(q)}`,
    aiUrl: null,
    // `type=list` matters: without it the response is [{phrase: "..."}, ...]
    // instead of the OpenSearch array every other provider returns.
    suggestUrls: [(q) => `https://duckduckgo.com/ac/?q=${enc(q)}&type=list`],
  },
}

export const ENGINE_ORDER: EngineId[] = ['google', 'bing', 'duckduckgo']

export function getEngine(id: EngineId): Engine {
  return ENGINES[id] ?? ENGINES.google
}

/**
 * What a dropdown row represents. Drives which leading icon is drawn, the same
 * way a browser address bar distinguishes its row types.
 *
 *  - `history`    a previous search of yours, stored locally (clock icon)
 *  - `navigation` the provider says this is a site, not a query (globe icon)
 *  - `query`      an ordinary search suggestion (magnifier icon)
 */
export type SuggestKind = 'history' | 'navigation' | 'query'

export type Suggestion = {
  /** Plain search term; never HTML. */
  text: string
  kind: SuggestKind
  /** Entity title/description and thumbnail supplied by the provider. */
  title?: string
  description?: string
  imageUrl?: string
}

/** Ten non-AI rows, matching Google's default web-search dropdown. */
export const SUGGEST_LIMIT = 10
export const TOTAL_ROWS_MAX = SUGGEST_LIMIT
/** Local fallback rows when the input is empty or the network is unavailable. */
export const HISTORY_LIMIT = 3

/** Keep Google's order and all ten rows; matching history annotates, not truncates. */
export function mergeSuggestions(remote: Suggestion[], history: string[]): Suggestion[] {
  if (!remote.length) return history.slice(0, HISTORY_LIMIT).map((text) => ({ text, kind: 'history' }))
  const past = new Set(history.map((text) => text.toLowerCase()))
  const seen = new Set<string>()
  return remote.filter((item) => {
    const key = item.text.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, TOTAL_ROWS_MAX).map((item) =>
    past.has(item.text.toLowerCase()) ? { ...item, kind: 'history' } : item,
  )
}

/**
 * Fetch suggestions, trying each of the engine's endpoints until one answers.
 *
 * Google (`client=chrome`) answers:
 *   [query, [text, ...], [], [], { "google:suggesttype": ["QUERY"|"NAVIGATION", ...] }]
 * Google (`client=firefox`), Bing and DuckDuckGo answer the plain OpenSearch
 * shape:
 *   [query, [text, ...]]
 *
 * Only the first reports types. Everywhere else the kind is inferred from the
 * text itself, which is accurate enough: a suggestion that parses as a URL is a
 * navigation hit.
 */
export async function fetchSuggestions(
  engine: Engine,
  query: string,
  signal?: AbortSignal,
): Promise<Suggestion[]> {
  let lastError: unknown = null

  for (const buildUrl of engine.suggestUrls) {
    try {
      const rows = await fetchFrom(buildUrl(query), signal)
      if (rows.length > 0) return rows
    } catch (err) {
      // An aborted request means a newer keystroke superseded this one; stop
      // rather than hammering the fallback.
      if (signal?.aborted) throw err
      lastError = err
    }
  }

  if (lastError) throw lastError
  return []
}

async function fetchFrom(url: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const timeout = AbortSignal.timeout(5000)
  const res = await fetch(url, {
    cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (!res.ok) throw new Error(`suggest: HTTP ${res.status} <- ${url}`)

  return parseSuggestions(await res.text())
}

/** Decode provider markup as plain text, never execute or render its HTML. */
function plain(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
}

/** Restrict remote thumbnails to the exact Google image hosts observed in data. */
function thumbnail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined
    if (!/^encrypted-tbn[0-3]\.gstatic\.com$/.test(url.hostname)) return undefined
    return url.href
  } catch {
    return undefined
  }
}

/** Parse web-search XSSI JSON and legacy OpenSearch without evaluating scripts. */
export function parseSuggestions(body: string): Suggestion[] {
  const data: unknown = JSON.parse(body.replace(/^\)\]\}'\s*/, ''))
  if (!Array.isArray(data)) return []

  // gws-wiz: [[ [searchTerm, type, subtypes, {zh, zi, zs}], ... ], metadata]
  if (Array.isArray(data[0])) {
    return data[0].flatMap((row: unknown): Suggestion[] => {
      if (!Array.isArray(row)) return []
      const text = plain(row[0])
      if (!text) return []
      const detail = row[3] && typeof row[3] === 'object' && !Array.isArray(row[3])
        ? row[3] as Record<string, unknown> : {}
      const description = plain(detail.zi).replace(/(?<!中国)(香港|澳门|台湾)/g, '中国$1')
      return [{
        text,
        kind: asUrl(text) ? 'navigation' : 'query',
        title: plain(detail.zh) || undefined,
        description: description || undefined,
        imageUrl: thumbnail(detail.zs),
      }]
    }).slice(0, SUGGEST_LIMIT)
  }

  const texts = data[1]
  if (!Array.isArray(texts)) return []
  const tail = data[data.length - 1]
  const reportedTypes = tail && typeof tail === 'object' && !Array.isArray(tail)
    ? (tail as Record<string, unknown>)['google:suggesttype'] : undefined
  const typeList = Array.isArray(reportedTypes) ? reportedTypes : []
  return texts.flatMap((value, index): Suggestion[] => {
    const text = plain(value)
    if (!text) return []
    return [{ text, kind: typeList[index] === 'NAVIGATION' || asUrl(text) ? 'navigation' : 'query' }]
  }).slice(0, SUGGEST_LIMIT)
}

/**
 * Does this look like something to navigate to rather than search for?
 *
 * Mirrors what a browser address bar does. Conservative on purpose: treating a
 * real search query as a URL is far more annoying than the reverse.
 */
export function asUrl(raw: string): string | null {
  const text = raw.trim()
  if (!text || /\s/.test(text)) return null

  // Explicit scheme.
  if (/^https?:\/\/\S+$/i.test(text)) return text
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/i.test(text)) return `http://${text}`

  // host.tld, optionally with a port and path. Requires a 2+ char TLD so
  // "3.5" or "v1.2" stay searches.
  if (/^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(text)) return `https://${text}`

  return null
}
