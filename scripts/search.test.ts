import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ENGINES, SUGGEST_LIMIT, fetchSuggestions, mergeSuggestions, parseSuggestions } from '../src/lib/search.ts'

const image = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:example&s=10'
const richRows = Array.from({ length: 12 }, (_, i) => [
  `term ${i}`, 46, [512], { zh: `Title ${i}`, zi: 'University', zs: image },
])
const richBody = ")]}'\n" + JSON.stringify([richRows, {}])

test('web JSON returns ten ordered candidates with real entity metadata', () => {
  const rows = parseSuggestions(richBody)
  assert.equal(SUGGEST_LIMIT, 10)
  assert.equal(rows.length, 10)
  assert.equal(rows[0]?.text, 'term 0')
  assert.equal(rows[9]?.text, 'term 9')
  assert.equal(rows[0]?.imageUrl, image)
  assert.equal(rows[0]?.title, 'Title 0')
  assert.equal(rows[0]?.description, 'University')
})

test('plain OpenSearch fallbacks also keep ten results and navigation types', () => {
  const rows = parseSuggestions(JSON.stringify(['term', ['https://github.com/', ...Array.from({ length: 11 }, (_, i) => `term ${i}`)]]))
  assert.equal(rows.length, 10)
  assert.equal(rows[0]?.kind, 'navigation')
  assert.equal(rows[1]?.imageUrl, undefined)
})

test('provider HTML is plain text; JSONP and malformed responses are not executed', () => {
  const rows = parseSuggestions(JSON.stringify([[['<b>term</b>', 0, [], { zh: '<b>Title</b>', zi: '<script>text</script>' }]]]))
  assert.equal(rows[0]?.text, 'term')
  assert.equal(rows[0]?.title, 'Title')
  assert.equal(rows[0]?.description, 'text')
  assert.throws(() => parseSuggestions('window.google.ac.h([])'), SyntaxError)
  assert.throws(() => parseSuggestions('<html>blocked</html>'), SyntaxError)
  assert.deepEqual(parseSuggestions('{"unexpected":true}'), [])
})

test('unsafe thumbnails are rejected; descriptions remain available', () => {
  for (const url of ['javascript:alert(1)', 'http://encrypted-tbn0.gstatic.com/images', 'https://encrypted-tbn0.gstatic.com.evil.example/x', 'https://example.com/x', 'https://user:pass@encrypted-tbn0.gstatic.com/images', 'https://encrypted-tbn0.gstatic.com:8443/images']) {
    const rows = parseSuggestions(JSON.stringify([[['term', 46, [], { zs: url, zi: 'Description' }]]]))
    assert.equal(rows[0]?.imageUrl, undefined, url)
    assert.equal(rows[0]?.description, 'Description')
  }
})

test('history does not reduce ten remote rows or change Google order', () => {
  const rows = parseSuggestions(richBody)
  const merged = mergeSuggestions(rows, ['term 5', 'unrelated history'])
  assert.equal(merged.length, 10)
  assert.deepEqual(merged.map((r) => r.text), rows.map((r) => r.text))
  assert.equal(merged[5]?.kind, 'history')
  assert.equal(merged[5]?.imageUrl, image)
  assert.equal(mergeSuggestions([], ['one', 'two', 'three', 'four']).length, 3)
})

test('Google prefers web data; failure falls back to the omnibox without images', async () => {
  const original = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('client=gws-wiz')) return new Response('blocked', { status: 503 })
    return new Response(JSON.stringify(['term', Array.from({ length: 15 }, (_, i) => `term ${i}`)]))
  }
  try {
    const rows = await fetchSuggestions(ENGINES.google, 'term')
    assert.equal(rows.length, 10)
    assert.ok(calls[0]?.includes('client=gws-wiz'))
    assert.ok(calls[1]?.includes('client=chrome'))
    assert.equal(calls.length, 2)
  } finally {
    globalThis.fetch = original
  }
})
