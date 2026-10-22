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
  suggestUrl: (query: string) => string
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
    // `client=chrome` rather than `client=firefox`: it returns 15 candidates
    // instead of 10 AND a `google:suggesttype` array, which is what lets the
    // dropdown show a globe for navigation hits and a magnifier for queries
    // instead of guessing. Verified against the live endpoint.
    suggestUrl: (q) =>
      `https://suggestqueries.google.com/complete/search?client=chrome&hl=zh-CN&q=${enc(q)}`,
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
    suggestUrl: (q) => `https://api.bing.com/osjson.aspx?query=${enc(q)}`,
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
    suggestUrl: (q) => `https://duckduckgo.com/ac/?q=${enc(q)}&type=list`,
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
  text: string
  kind: SuggestKind
}

/** Remote suggestions kept per request. */
export const SUGGEST_LIMIT = 6
/** Locally stored history rows shown above the remote suggestions. */
export const HISTORY_LIMIT = 3
/**
 * Hard cap on non-AI rows.
 *
 * The search box sits near the bottom of a centred column. Measured at
 * 1440x900 the bar's underside lands at y=628, and `.stage` lifts 10vh (90px)
 * on focus, leaving ~360px — about nine 37px rows including the AI row. Going
 * beyond that makes the list scroll, which is worse than showing fewer rows.
 */
export const TOTAL_ROWS_MAX = 8

/**
 * Fetch suggestions.
 *
 * Google (`client=chrome`) answers:
 *   [query, [text, ...], [], [], { "google:suggesttype": ["QUERY"|"NAVIGATION", ...] }]
 * Bing and DuckDuckGo answer the plain OpenSearch shape:
 *   [query, [text, ...]]
 *
 * Only Google reports types. For the other two the kind is inferred from the
 * text itself, which is accurate enough: a suggestion that parses as a URL is a
 * navigation hit.
 */
export async function fetchSuggestions(
  engine: Engine,
  query: string,
  signal?: AbortSignal,
): Promise<Suggestion[]> {
  const res = await fetch(engine.suggestUrl(query), {
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  })
  if (!res.ok) throw new Error(`suggest: HTTP ${res.status}`)

  // Google and DuckDuckGo answer with `Content-Type: text/javascript`, so parse
  // the text ourselves instead of relying on res.json() honouring it.
  const data: unknown = JSON.parse(await res.text())
  if (!Array.isArray(data)) return []

  const texts = data[1]
  if (!Array.isArray(texts)) return []

  // The metadata object is the last element, and only Google sends one.
  const tail = data[data.length - 1]
  const reportedTypes =
    tail && typeof tail === 'object' && !Array.isArray(tail)
      ? (tail as Record<string, unknown>)['google:suggesttype']
      : undefined
  const typeList = Array.isArray(reportedTypes) ? reportedTypes : []

  return texts
    .map((text, index): Suggestion | null => {
      if (typeof text !== 'string' || text.length === 0) return null
      const kind: SuggestKind =
        typeList[index] === 'NAVIGATION' ? 'navigation' : asUrl(text) ? 'navigation' : 'query'
      return { text, kind }
    })
    .filter((item): item is Suggestion => item !== null)
    .slice(0, SUGGEST_LIMIT)
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
