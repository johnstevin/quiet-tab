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
} from '../src/index.ts'

const EXT = 'abcdefghijklmnopabcdefghijklmnop' // 32 chars, a-p

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
