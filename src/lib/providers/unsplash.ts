import { APP_NAME, UNSPLASH_ACCESS_KEY, UNSPLASH_PROXY_URL, usesUnsplashProxy } from '../env'
import type { Photo } from '../types'

/**
 * Unsplash.
 *
 * Authenticated with the Access Key as `Client-ID` — the public, read-only
 * scheme. No OAuth, so the Secret Key is neither used nor needed.
 *
 * RATE LIMIT: a Demo-tier application gets 50 requests/hour. Every list fetch
 * and every download-ping counts. That is why we pull a whole batch at once and
 * cache aggressively rather than requesting one photo at a time.
 */

const API = 'https://api.unsplash.com'

/**
 * Subject matter. Natural landscapes match the visual design and tend to be
 * dark and low-contrast enough for white text to stay readable.
 */
const QUERY = 'landscape,mountain,nature,forest'

/**
 * Width we actually request. Unsplash originals are routinely 4000-6000px wide;
 * asking imgix for 2560 cuts the transfer several-fold with no visible loss at
 * normal display sizes — and the background is blurred by default anyway.
 */
const TARGET_WIDTH = 2560

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
    'Accept-Version': 'v1',
  }
}

/** Only the fields we consume. */
type UnsplashPhoto = {
  id?: string
  urls?: { raw?: string; full?: string; regular?: string }
  description?: string | null
  alt_description?: string | null
  user?: { name?: string; username?: string; links?: { html?: string } }
  links?: { download_location?: string }
}

/** Ask imgix (Unsplash's CDN) for exactly the size and quality we want. */
function sized(raw: string): string {
  try {
    const u = new URL(raw)
    u.searchParams.set('w', String(TARGET_WIDTH))
    u.searchParams.set('q', '80')
    u.searchParams.set('fm', 'jpg')
    u.searchParams.set('fit', 'max')
    return u.toString()
  } catch {
    return raw
  }
}

/**
 * Unsplash's attribution guidelines ask that links back to the site carry UTM
 * parameters identifying the referring application.
 */
function withUtm(url: string): string {
  try {
    const u = new URL(url)
    u.searchParams.set('utm_source', APP_NAME)
    u.searchParams.set('utm_medium', 'referral')
    return u.toString()
  } catch {
    return url
  }
}

export async function fetchUnsplashPhotos(count: number, signal?: AbortSignal): Promise<Photo[]> {
  const clamped = Math.max(1, Math.min(count, 30))
  const viaProxy = usesUnsplashProxy()

  if (!viaProxy && !UNSPLASH_ACCESS_KEY) {
    throw new Error('未配置 Unsplash（需要代理地址或本地 Access Key，见 .env.example）')
  }

  // Proxy: the Worker fixes query/orientation/filter itself, so only `count` is
  // sent. Direct: the same parameters are built here, with the key in a header.
  const url = viaProxy
    ? `${UNSPLASH_PROXY_URL}/photos?count=${clamped}`
    : `${API}/photos/random?count=${clamped}` +
      `&orientation=landscape&content_filter=high&query=${encodeURIComponent(QUERY)}`

  const res = await fetch(url, {
    // Chrome omits Origin on extension GET requests even in cors mode. POST
    // carries the browser-generated Origin, preserving the Worker's checks.
    ...(viaProxy ? { method: 'POST' } : { headers: authHeaders() }),
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  })

  if (res.status === 403) {
    // Unsplash answers 403 (not 429) when the hourly allowance is gone. Through
    // the proxy that allowance is shared by every user, so say so.
    const remaining = res.headers.get('x-ratelimit-remaining')
    throw new Error(
      viaProxy
        ? 'Unsplash 共享配额已用尽（所有用户共用，Demo 版 50 次/小时），稍后再试或切回 Bing'
        : `Unsplash 请求配额已用尽（Demo 版 50 次/小时，剩余 ${remaining ?? '0'}），稍后再试或切回 Bing`,
    )
  }
  if (res.status === 401) throw new Error('Unsplash Access Key 无效或已被撤销')
  if (!res.ok) throw new Error(`Unsplash 接口返回 HTTP ${res.status}`)

  const data: unknown = await res.json()
  const list: UnsplashPhoto[] = Array.isArray(data) ? data : [data as UnsplashPhoto]

  const photos = list.flatMap((p) => {
    const raw = p.urls?.raw ?? p.urls?.full ?? p.urls?.regular
    if (!raw || !p.id) return []
    return [
      {
        id: p.id,
        url: sized(raw),
        title: (p.description ?? p.alt_description ?? '').trim(),
        authorName: p.user?.name ?? p.user?.username ?? '',
        authorUrl: p.user?.links?.html ? withUtm(p.user.links.html) : null,
        source: 'unsplash' as const,
        downloadLocation: p.links?.download_location ?? null,
      },
    ]
  })

  if (photos.length === 0) throw new Error('Unsplash 返回的图片列表为空')
  return photos
}

/**
 * Report that a photo was used.
 *
 * Required by the Unsplash API Guidelines: "When your application performs
 * something similar to a download, you must send a request to the
 * download_location endpoint." It is what keeps a photographer's download count
 * accurate, and complying is a condition of API access.
 *
 * Best effort and deliberately un-awaited by callers — a failed ping must never
 * stop a wallpaper from being shown. Each photo is pinged at most once (see the
 * `pinged` bookkeeping in useWallpaper) because these calls also consume the
 * hourly rate limit.
 */
export async function pingUnsplashDownload(downloadLocation: string): Promise<void> {
  try {
    if (usesUnsplashProxy()) {
      // The Worker holds the key and validates that the target really is an
      // Unsplash download endpoint, so the extension never needs to.
      await fetch(`${UNSPLASH_PROXY_URL}/download`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ downloadLocation }),
        cache: 'no-store',
      })
      return
    }
    if (!UNSPLASH_ACCESS_KEY) return
    await fetch(downloadLocation, { headers: authHeaders(), cache: 'no-store' })
  } catch {
    // Offline or blocked; nothing actionable.
  }
}

/** Link used in the attribution line, as the guidelines require. */
export const UNSPLASH_HOME = withUtm('https://unsplash.com')
