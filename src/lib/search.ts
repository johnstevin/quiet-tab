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
  /** Compact label for the segmented control in the context menu. */
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
    suggestUrl: (q) =>
      `https://suggestqueries.google.com/complete/search?client=firefox&q=${enc(q)}`,
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
 * Maximum suggestions rendered in the dropdown.
 *
 * Six, not the ten the endpoints return. The search box sits at the bottom of a
 * centred column, so there is only ~190px of viewport beneath it; eight rows
 * plus the AI row overflowed the fold. Six fits once `.stage` lifts on focus,
 * and the dropdown carries a max-height as a backstop for short windows.
 */
export const SUGGEST_LIMIT = 6

/**
 * Fetch suggestions.
 *
 * All three providers answer with the OpenSearch array shape
 *   [query, [suggestion, ...], ...]
 * confirmed against each endpoint, so one parser covers them all.
 */
export async function fetchSuggestions(
  engine: Engine,
  query: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const res = await fetch(engine.suggestUrl(query), {
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  })
  if (!res.ok) throw new Error(`suggest: HTTP ${res.status}`)

  // Google and DuckDuckGo answer with `Content-Type: text/javascript`, so parse
  // the text ourselves instead of relying on res.json() honouring it.
  const data: unknown = JSON.parse(await res.text())
  if (!Array.isArray(data)) return []

  const list = data[1]
  if (!Array.isArray(list)) return []

  return list
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
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
