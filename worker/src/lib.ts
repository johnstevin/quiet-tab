/**
 * Pure helpers for the Unsplash proxy.
 *
 * Kept OUT of src/index.ts on purpose: the Workers runtime rejects an entry
 * module that exports anything besides handlers and classes ("Incorrect type
 * for map entry ... not of type 'function or ExportedHandler'"). Exporting these
 * helpers from the entry file type-checked fine and passed every unit test, then
 * crashed the moment `wrangler dev` loaded it. Tests import from here instead.
 */

const UPSTREAM = 'https://api.unsplash.com'
const UPSTREAM_HOST = 'api.unsplash.com'

/** Seconds a shared photo batch stays cached at the edge. */
export const BATCH_TTL_S = 30 * 60
/** Distinct cache slots, so one shared response does not mean one shared photo set forever. */
export const BATCH_BUCKETS = 6
/** Query the extension may ask for. Fixed so callers cannot steer the proxy. */
export const FIXED_QUERY = 'landscape,mountain,nature,forest'
export const MAX_COUNT = 30

/** Extension origin check. `chrome-extension://<32 chars a-p>`. */
export function parseExtensionId(origin: string | null): string | null {
  if (!origin) return null
  const m = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin)
  return m ? m[1]! : null
}

export function isOriginAllowed(origin: string | null, allowList: string | undefined): boolean {
  const id = parseExtensionId(origin)
  if (!id) return false
  const allowed = (allowList ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  // An empty list means "any Chrome extension", needed while the extension ID
  // is not yet known (unpacked builds get a machine-specific ID).
  return allowed.length === 0 || allowed.includes(id)
}

export function clampCount(raw: string | null): number {
  const n = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(n)) return 12
  return Math.min(Math.max(n, 1), MAX_COUNT)
}

/**
 * The only download-tracking URLs we will forward: Unsplash's own
 * `/photos/<id>/download` endpoint over https. Rejects every other host, which
 * is what stops this from being used as an SSRF / open relay.
 */
export function isValidDownloadLocation(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  return (
    u.protocol === 'https:' &&
    u.hostname === UPSTREAM_HOST &&
    u.port === '' &&
    u.username === '' &&
    u.password === '' &&
    /^\/photos\/[A-Za-z0-9_-]{6,32}\/download$/.test(u.pathname)
  )
}

/** Build the upstream URL for a photo batch. Every parameter is fixed or clamped. */
export function buildPhotosUrl(count: number): string {
  const u = new URL('/photos/random', UPSTREAM)
  u.searchParams.set('count', String(count))
  u.searchParams.set('orientation', 'landscape')
  u.searchParams.set('content_filter', 'high')
  u.searchParams.set('query', FIXED_QUERY)
  return u.toString()
}
