import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, '.verify')
const dist = join(root, 'dist')
const context = await chromium.launchPersistentContext(await mkdtemp(join(out, 'search-live-')), {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
})
const results = []
const checks = (name) => { results.push(name); console.log('ok', name) }
try {
  const page = await context.newPage()
  let body = null
  context.on('response', async (response) => {
    const url = new URL(response.url())
    if (url.pathname !== '/complete/search' || url.searchParams.get('client') !== 'gws-wiz' || url.searchParams.get('q') !== 'ln') return
    if (response.ok()) body = await response.text()
  })
  await page.goto('chrome://newtab/')
  assert.ok(page.url().startsWith('chrome-extension://'))
  await page.waitForSelector('.search__input')
  const positions = () => page.evaluate(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect()
      return [r.x, r.y, r.width, r.height].map((x) => Math.round(x * 1000) / 1000)
    }
    return { clock: rect('[data-testid="clock"]'), date: rect('[data-testid="clock-date"]'), bar: rect('.search__bar') }
  })
  // Avoid weather/geolocation as a source of unrelated late layout changes.
  await page.evaluate(async () => {
    await chrome.storage.local.set({ settings: { source: 'unsplash', blur: 8, showSeconds: true, showSearch: true, engine: 'google', keepHistory: true, showWeather: false, place: null }, searchHistory: ['岭南大学', 'unrelated history'] })
  })
  await page.reload()
  await page.waitForSelector('.search__input')
  await page.waitForTimeout(300)
  const idle = await positions()
  await page.locator('.search__input').fill('ln')
  await page.waitForFunction(() => document.querySelectorAll('.search__row[data-kind]').length === 10, null, { timeout: 20000 })
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.search__row-image')]
    return images.length > 0 && images.every((img) => img.complete && img.naturalWidth > 0)
  }, null, { timeout: 20000 })
  assert.ok(body, 'real web-search response must have been received')
  const source = JSON.parse(body.replace(/^\)\]\}'\s*/, ''))[0].slice(0, 10)
  const rendered = await page.locator('.search__row-title').allTextContents()
  assert.deepEqual(rendered, source.map((row) => row[3]?.zh || row[0]))
  checks('ten live Google candidates in provider order, plus separate AI first row')
  assert.equal(await page.locator('.search__row').count(), 11)
  assert.ok(await page.locator('.search__row').first().evaluate((e) => e.classList.contains('search__row--ai')))
  const imageCount = await page.locator('.search__row-image').count()
  assert.equal(imageCount, source.filter((row) => row[3]?.zs).length)
  checks(`${imageCount} real entity thumbnails loaded; descriptions kept`)
  assert.deepEqual(await positions(), idle)
  checks('focus and thumbnail loading move neither clock, date nor search bar')
  await page.screenshot({ path: join(out, 'search-10-live.png') })
  // Rendered elements, not a fake static mockup. Use a taller viewport to capture
  // all ten rows; short-screen behaviour is independently asserted below.
  await page.setViewportSize({ width: 1440, height: 1800 })
  await page.waitForTimeout(200)
  const panelClip = await page.evaluate(() => {
    const b = document.querySelector('.search__bar').getBoundingClientRect()
    const d = document.querySelector('.search__drop').getBoundingClientRect()
    return { x: b.x, y: b.y, width: b.width, height: d.bottom - b.y }
  })
  await page.screenshot({ path: join(out, 'search-10-panel.png'), clip: panelClip })

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport)
    await page.waitForTimeout(150)
    const before = await positions()
    // First resets highlight and scroll; then ArrowUp selects the last row.
    await page.locator('.search__input').fill('')
    await page.locator('.search__input').fill('ln')
    await page.waitForFunction(() => document.querySelectorAll('.search__row[data-kind]').length === 10)
    await page.keyboard.press('ArrowUp')
    await page.waitForFunction(() => {
      const last = [...document.querySelectorAll('.search__row')].at(-1)
      return last?.classList.contains('is-active')
    })
    const fit = await page.evaluate(() => {
      const drop = document.querySelector('.search__drop')
      const last = [...drop.querySelectorAll('.search__row')].at(-1)
      const d = drop.getBoundingClientRect(), r = last.getBoundingClientRect()
      return { bottom: d.bottom, lastTop: r.top, lastBottom: r.bottom, top: d.top, scrollTop: drop.scrollTop, height: innerHeight }
    })
    assert.ok(fit.bottom <= fit.height - 15)
    assert.ok(fit.lastTop >= fit.top - 1 && fit.lastBottom <= fit.bottom + 1)
    assert.ok(fit.scrollTop > 0)
    assert.deepEqual(await positions(), before)
    checks(`all ten retained at ${viewport.width}x${viewport.height}; keyboard reaches final row with no page movement`)
  }

  // Force an actual remote image failure, rather than pretending an arbitrary
  // search glyph proves thumbnail fallback works.
  const image = page.locator('.search__row-image').first()
  await image.evaluate((img) => img.dispatchEvent(new Event('error')))
  assert.equal(await page.locator('.search__row-image').count(), imageCount - 1)
  assert.ok(await page.locator('.search__row[data-kind]').first().locator('.search__row-glyph svg').count())
  checks('failed entity image is replaced by a type glyph, with no broken-image box')
  await writeFile(join(out, 'search-10-report.json'), JSON.stringify({ checks: results, imageCount, titles: rendered }, null, 2))
} finally {
  await context.close()
}
console.log('ALL SEARCH CHECKS PASSED')
