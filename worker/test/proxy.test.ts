import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BATCH_BUCKETS,
  FIXED_QUERY,
  MAX_COUNT,
  buildPhotosUrl,
  clampCount,
  isOriginAllowed,
  isValidDownloadLocation,
  parseExtensionId,
} from '../src/lib.ts'

import worker from '../src/index.ts'

import { UNSPLASH_CATEGORIES, getUnsplashCategory, wallpaperScope } from '../../src/lib/unsplashCategories.ts'

const EXT = 'abcdefghijklmnopabcdefghijklmnop' // 32 chars, a-p

test('all 21 official topics are present and categories are isolated', () => {
  assert.equal(UNSPLASH_CATEGORIES.length, 23)
  assert.equal(UNSPLASH_CATEGORIES.filter((c) => c.topic).length, 21)
  assert.equal(new Set(UNSPLASH_CATEGORIES.map((c) => c.id)).size, 23)
  for (const c of UNSPLASH_CATEGORIES) {
    const url = new URL(buildPhotosUrl(12, c.id, 3))
    assert.equal(url.origin, 'https://api.unsplash.com')
    if (c.topic) {
      assert.equal(url.pathname, `/topics/${c.topic}/photos`)
      assert.equal(url.searchParams.get('page'), '4')
      assert.equal(url.searchParams.get('per_page'), '12')
      assert.equal(url.searchParams.has('query'), false)
    } else assert.equal(url.pathname, '/photos/random')
  }
  assert.equal(new URL(buildPhotosUrl(12, 'all')).searchParams.has('query'), false)
  assert.equal(getUnsplashCategory('https://evil.example').id, 'landscape')
  assert.equal(wallpaperScope('unsplash', 'landscape'), 'unsplash')
  assert.equal(wallpaperScope('unsplash', 'wallpapers'), 'unsplash:wallpapers')
  assert.equal(wallpaperScope('bing', 'wallpapers'), 'bing')
})

test('photo POST requires Origin and shares the fixed upstream and edge cache', async () => {
  const oldFetch = globalThis.fetch
  const oldCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches')
  const calls: string[] = []
  const stored: Promise<unknown>[] = []
  const entries = new Map<string, Response>()
  const oldRandom = Math.random
  Math.random = () => 0
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: { default: {
      match: async (request: Request) => entries.get(request.url)?.clone(),
      put: async (request: Request, response: Response) => { entries.set(request.url, response.clone()) },
    } },
  })
  globalThis.fetch = async (input, init) => {
    calls.push(String(input))
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Client-ID TEST-ONLY-KEY')
    return new Response(JSON.stringify([{ id: 'sample123' }]), { status: 200 })
  }
  const env = { UNSPLASH_ACCESS_KEY: 'TEST-ONLY-KEY' }
  const ctx = { waitUntil: (p: Promise<unknown>) => stored.push(p) } as ExecutionContext
  const url = 'https://proxy.example/photos?count=3'
  try {
    for (const origin of [null, 'https://example.com']) {
      const r = await worker.fetch(new Request(url, {
        method: 'POST', ...(origin ? { headers: { Origin: origin } } : {}),
      }), env, ctx)
      assert.equal(r.status, 403)
    }
    assert.equal(calls.length, 0, 'rejected requests must not call Unsplash')
    const request = () => new Request(url, { method: 'POST', headers: { Origin: `chrome-extension://${EXT}` } })
    const first = await worker.fetch(request(), env, ctx)
    assert.equal(first.status, 200)
    assert.equal(first.headers.get('x-proxy-cache'), 'MISS')
    assert.equal((await first.text()).includes(env.UNSPLASH_ACCESS_KEY), false)
    assert.equal(calls[0], buildPhotosUrl(3))
    await Promise.all(stored)
    const second = await worker.fetch(request(), env, ctx)
    assert.equal(second.headers.get('x-proxy-cache'), 'HIT')
    assert.equal(calls.length, 1, 'POST photo reads must use the same edge cache')
    const different = await worker.fetch(new Request(url + '&category=wallpapers', {
      method: 'POST', headers: { Origin: `chrome-extension://${EXT}` },
    }), env, ctx)
    assert.equal(different.headers.get('x-proxy-cache'), 'MISS')
    assert.equal(calls.length, 2, 'another category must not reuse the landscape batch')
    assert.ok(calls[1]?.includes('/topics/bo8jQKTaE0Y/photos'))
  } finally {
    globalThis.fetch = oldFetch
    Math.random = oldRandom
    if (oldCaches) Object.defineProperty(globalThis, 'caches', oldCaches)
    else delete (globalThis as { caches?: unknown }).caches
  }
})

test('parseExtensionId accepts only chrome-extension origins with a 32-char a-p id', () => {
  assert.equal(parseExtensionId(`chrome-extension://${EXT}`), EXT)
  assert.equal(parseExtensionId(null), null)
  assert.equal(parseExtensionId('https://evil.example'), null)
  assert.equal(parseExtensionId('http://localhost:5173'), null)
  assert.equal(parseExtensionId(`chrome-extension://${EXT}/`), null) // trailing slash is not an Origin
  assert.equal(parseExtensionId('chrome-extension://short'), null)
  assert.equal(parseExtensionId(`chrome-extension://${'z'.repeat(32)}`), null) // z is outside a-p
})

test('isOriginAllowed: empty allow-list admits any extension but never a web page', () => {
  assert.equal(isOriginAllowed(`chrome-extension://${EXT}`, undefined), true)
  assert.equal(isOriginAllowed(`chrome-extension://${EXT}`, ''), true)
  assert.equal(isOriginAllowed('https://evil.example', undefined), false)
  assert.equal(isOriginAllowed(null, undefined), false)
})

test('isOriginAllowed: a non-empty allow-list is enforced exactly', () => {
  const other = 'p'.repeat(32)
  assert.equal(isOriginAllowed(`chrome-extension://${EXT}`, EXT), true)
  assert.equal(isOriginAllowed(`chrome-extension://${EXT}`, ` ${other} , ${EXT} `), true)
  assert.equal(isOriginAllowed(`chrome-extension://${EXT}`, other), false)
})

test('clampCount bounds the batch size', () => {
  assert.equal(clampCount(null), 12)
  assert.equal(clampCount('abc'), 12)
  assert.equal(clampCount('0'), 1)
  assert.equal(clampCount('-5'), 1)
  assert.equal(clampCount('12'), 12)
  assert.equal(clampCount('999'), MAX_COUNT)
})

test('isValidDownloadLocation accepts only Unsplash download endpoints', () => {
  assert.equal(isValidDownloadLocation('https://api.unsplash.com/photos/AbC123_-xyz/download'), true)
  assert.equal(
    isValidDownloadLocation('https://api.unsplash.com/photos/AbC123_-xyz/download?ixid=abc'),
    true,
    'a query string (ixid) is legitimate and must survive',
  )
})

test('isValidDownloadLocation accepts the exact download_location from Unsplash docs', () => {
  // Copied verbatim from
  // https://help.unsplash.com/api-guidelines/guideline-triggering-a-download
  // The guideline requires every query parameter (ixid) to be kept, so rejecting
  // a genuine value would silently break download tracking for every photo.
  const official =
    'https://api.unsplash.com/photos/LBI7cgq3pbM/download?ixid=MnwxMTc4ODl8MHwxfHNlYXJjaHwxfHxwdXBweXxlbnwwfHx8fDE2MTc3NTA2MTM'
  assert.equal(isValidDownloadLocation(official), true)
  // The forwarded string must be unchanged, query included.
  assert.equal(new URL(official).search, '?ixid=MnwxMTc4ODl8MHwxfHNlYXJjaHwxfHxwdXBweXxlbnwwfHx8fDE2MTc3NTA2MTM')
})

test('isValidDownloadLocation blocks SSRF and open-relay attempts', () => {
  const bad = [
    'http://api.unsplash.com/photos/AbC123xyz/download', // not https
    'https://evil.example/photos/AbC123xyz/download', // wrong host
    'https://api.unsplash.com.evil.example/photos/AbC123xyz/download', // suffix trick
    'https://evilunsplash.com/photos/AbC123xyz/download', // endsWith("unsplash.com") bypass
    'https://notapi.unsplash.com/photos/AbC123xyz/download', // sibling subdomain, not the API host
    'https://images.unsplash.com/photos/AbC123xyz/download', // real Unsplash host, wrong service
    'https://evil.example/@api.unsplash.com/photos/AbC123xyz/download',
    'https://api.unsplash.com@evil.example/photos/AbC123xyz/download', // userinfo trick
    'https://user:pass@api.unsplash.com/photos/AbC123xyz/download',
    'https://api.unsplash.com:8443/photos/AbC123xyz/download', // port
    'https://api.unsplash.com/me', // other endpoint
    'https://api.unsplash.com/photos/AbC123xyz', // not /download
    'https://api.unsplash.com/photos/../me/download', // traversal
    'https://api.unsplash.com/photos/x/download', // id too short
    'https://169.254.169.254/latest/meta-data/', // cloud metadata
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
    '',
  ]
  for (const url of bad) {
    assert.equal(isValidDownloadLocation(url), false, `must reject: ${url}`)
  }
})

test('buildPhotosUrl fixes every parameter and cannot be steered by the caller', () => {
  const u = new URL(buildPhotosUrl(12))
  assert.equal(u.origin, 'https://api.unsplash.com')
  assert.equal(u.pathname, '/photos/random')
  assert.equal(u.searchParams.get('count'), '12')
  assert.equal(u.searchParams.get('query'), FIXED_QUERY)
  assert.equal(u.searchParams.get('content_filter'), 'high')
  assert.equal(u.searchParams.get('orientation'), 'landscape')
  assert.deepEqual([...u.searchParams.keys()].sort(), ['content_filter', 'count', 'orientation', 'query'])
})

test('the access key is never part of any URL the worker builds', () => {
  const sentinel = 'SECRET-SENTINEL-KEY'
  assert.equal(buildPhotosUrl(3).includes(sentinel), false)
  assert.ok(BATCH_BUCKETS >= 1)
})
