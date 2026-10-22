import type { Photo } from '../types'

/**
 * Bing daily wallpaper.
 *
 * No API key required, which is why it remains the fallback source when no
 * Unsplash key is configured.
 *
 * `uhd=1` plus explicit dimensions makes Bing hand back a 3840x2160 asset
 * directly, so there is no second request to upgrade resolution.
 */

const ORIGIN = 'https://www.bing.com'

/** Bing returns at most 8 past days in a single call. */
export const BING_MAX = 8

function endpoint(count: number): string {
  const n = Math.max(1, Math.min(count, BING_MAX))
  return (
    `${ORIGIN}/HPImageArchive.aspx?format=js&idx=0&n=${n}` +
    '&mkt=zh-CN&uhd=1&uhdwidth=3840&uhdheight=2160'
  )
}

/** Only the fields we consume; Bing returns considerably more. */
type BingPayload = {
  images?: Array<{
    url?: string
    title?: string
    copyright?: string
    startdate?: string
    hsh?: string
  }>
}

/**
 * Bing packs photographer and agency into a single copyright string, e.g.
 * `"静水映斑斓, 内藏山国立公园, 韩国 (© Getty Images)"`. The useful credit is
 * the parenthesised tail; fall back to the whole string if the shape differs.
 */
function extractCredit(copyright: string): string {
  const match = copyright.match(/\(([^)]*)\)\s*$/)
  return (match?.[1] ?? copyright).replace(/^©\s*/, '').trim()
}

/** Strip the trailing ", 地点, 国家 (© ...)" so the title stays short. */
function extractTitle(raw: string, copyright: string): string {
  if (raw) return raw
  return copyright.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

export async function fetchBingPhotos(count: number, signal?: AbortSignal): Promise<Photo[]> {
  const res = await fetch(endpoint(count), {
    // We do our own day-scoped caching; don't let the HTTP cache serve
    // yesterday's JSON.
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  })
  if (!res.ok) throw new Error(`Bing 接口返回 HTTP ${res.status}`)

  const data = (await res.json()) as BingPayload
  const images = data.images ?? []
  if (images.length === 0) throw new Error('Bing 返回的图片列表为空')

  return images.flatMap((img) => {
    if (!img.url) return []
    // The `url` field is host-relative, e.g. "/th?id=OHR.Foo_UHD.jpg&rf=...".
    // Same host as our host_permissions entry, so no extra permission needed.
    const url = img.url.startsWith('http') ? img.url : `${ORIGIN}${img.url}`
    const copyright = img.copyright ?? ''
    return [
      {
        id: img.hsh || img.startdate || url,
        url,
        title: extractTitle(img.title ?? '', copyright),
        authorName: extractCredit(copyright),
        authorUrl: null,
        source: 'bing' as const,
        // Bing imposes no usage-reporting requirement.
        downloadLocation: null,
      },
    ]
  })
}
