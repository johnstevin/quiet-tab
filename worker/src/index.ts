/**
 * Unsplash proxy for the Quiet Tab extension.
 *
 * WHY THIS EXISTS
 *   Unsplash's API Guidelines require the Access Key to stay confidential, which
 *   "may require using a proxy if accessing the API client-side". A key baked
 *   into a published extension is readable by anyone. Here it lives only in a
 *   Worker secret.
 *
 * WHAT IT IS NOT
 *   Not an open proxy. Exactly two operations are exposed, with fixed upstream
 *   hosts and an allow-list of query parameters. Anything else is a 404.
 *
 * RATE LIMIT REALITY
 *   One Demo-tier Unsplash application allows 50 requests/hour, shared by EVERY
 *   user of the extension. Caching the photo list at the edge is therefore not
 *   an optimisation, it is what keeps the service alive.
 *
 * NOTE: this entry module must export ONLY the default handler. Helpers live in
 * ./lib.ts; see the comment there for why.
 */

import {
  BATCH_BUCKETS,
  BATCH_TTL_S,
  buildPhotosUrl,
  clampCount,
  isOriginAllowed,
  isValidDownloadLocation,
} from './lib.ts'

interface Env {
  /** Secret. Set with `wrangler secret put UNSPLASH_ACCESS_KEY`. */
  UNSPLASH_ACCESS_KEY: string
  /** Comma-separated chrome-extension IDs allowed to call. Empty = any extension. */
  ALLOWED_EXTENSION_IDS?: string
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    // The response depends on the Origin header, so caches must not mix them.
    vary: 'Origin',
  }
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } })
}

async function handlePhotos(
  url: URL,
  env: Env,
  ctx: ExecutionContext,
  cors: Record<string, string>,
): Promise<Response> {
  const count = clampCount(url.searchParams.get('count'))
  // Which cache slot. Random per call so successive users see different photos
  // while still sharing at most BATCH_BUCKETS upstream fetches per TTL window.
  const bucket = Math.floor(Math.random() * BATCH_BUCKETS)

  const cacheKey = new Request(`https://cache.quiet-tab.invalid/photos/${count}/${bucket}`)
  const cache = caches.default
  const hit = await cache.match(cacheKey)
  if (hit) {
    const res = new Response(hit.body, hit)
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
    res.headers.set('x-proxy-cache', 'HIT')
    return res
  }

  const upstream = await fetch(buildPhotosUrl(count), {
    headers: {
      Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}`,
      'Accept-Version': 'v1',
    },
  })

  // Pass upstream status through (403 = hourly quota gone), but never the key and
  // never upstream headers wholesale. Only the rate-limit counters, which are
  // useful to the client and not sensitive.
  const passHeaders: Record<string, string> = { ...JSON_HEADERS, ...cors, 'x-proxy-cache': 'MISS' }
  for (const h of ['x-ratelimit-limit', 'x-ratelimit-remaining']) {
    const v = upstream.headers.get(h)
    if (v) passHeaders[h] = v
  }

  const body = await upstream.text()

  if (upstream.ok) {
    const cached = new Response(body, {
      status: 200,
      headers: { ...JSON_HEADERS, 'cache-control': `public, max-age=${BATCH_TTL_S}` },
    })
    ctx.waitUntil(cache.put(cacheKey, cached))
  }

  return new Response(body, { status: upstream.status, headers: passHeaders })
}

async function handleDownload(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, 400, cors)
  }

  const target =
    payload && typeof payload === 'object' && 'downloadLocation' in payload
      ? (payload as { downloadLocation: unknown }).downloadLocation
      : null

  if (typeof target !== 'string' || !isValidDownloadLocation(target)) {
    return json({ error: 'invalid_download_location' }, 400, cors)
  }

  const upstream = await fetch(target, {
    headers: {
      Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}`,
      'Accept-Version': 'v1',
    },
  })
  // The body is irrelevant (the call only records the download). Do not relay it.
  return json({ ok: upstream.ok }, upstream.ok ? 200 : 502, cors)
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // Health check needs no origin and leaks nothing.
    if (url.pathname === '/health') return json({ ok: true }, 200)

    const origin = request.headers.get('origin')
    if (!isOriginAllowed(origin, env.ALLOWED_EXTENSION_IDS)) {
      return json({ error: 'forbidden_origin' }, 403)
    }
    const cors = corsHeaders(origin as string)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    if (!env.UNSPLASH_ACCESS_KEY) return json({ error: 'not_configured' }, 500, cors)

    if (url.pathname === '/photos' && request.method === 'GET') {
      return handlePhotos(url, env, ctx, cors)
    }
    if (url.pathname === '/download' && request.method === 'POST') {
      return handleDownload(request, env, cors)
    }
    return json({ error: 'not_found' }, 404, cors)
  },
}
