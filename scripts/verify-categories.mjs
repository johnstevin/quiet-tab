import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, '.verify')
const base = 'https://quiet-tab.ccwu.cc'
const context = await chromium.launchPersistentContext(await mkdtemp(join(out, 'category-live-')), {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${root}/dist`, `--load-extension=${root}/dist`],
})
const fixture = process.argv.includes('--fixture')
if (fixture) {
  console.log('FIXTURE MODE: app behaviour only; not a live Unsplash availability test')
  const image = await import('node:fs/promises').then((fs) => fs.readFile(join(root, 'public/images/fallback-bg.png')))
  await context.route('https://images.unsplash.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: image }))
  await context.route(base + '/photos*', (route) => {
    const url = new URL(route.request().url())
    const category = url.searchParams.get('category') ?? 'landscape'
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Array.from({ length: 12 }, (_, i) => ({
      id: `${category}-${i}`, urls: { raw: `https://images.unsplash.com/fixture-${category}-${i}` },
      user: { name: `Fixture ${category} ${i}`, links: { html: 'https://unsplash.com/' } },
      links: { download_location: `https://api.unsplash.com/photos/fixture-${i}/download` },
    }))) })
  })
  await context.route(base + '/download', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
}
const checks = []
const pass = (name) => { checks.push(name); console.log('ok', name) }
try {
  const page = await context.newPage()
  await page.goto('chrome://newtab/')
  const extUrl = page.url()
  assert.ok(extUrl.startsWith('chrome-extension://'))
  await page.waitForSelector('.bg__layer--top.is-visible', { timeout: 40000 })
  const menu = async () => {
    await page.mouse.click(240, 100, { button: 'right' })
    await page.waitForSelector('.menu[data-placed="yes"]')
  }
  const choose = async (category) => {
    await menu()
    await page.locator('.menu__category-toggle').click()
    try {
      await page.locator(`[data-category="${category}"]`).click({ timeout: 5000 })
    } catch (err) {
      await page.screenshot({ path: join(out, 'category-click-failure.png') })
      console.log(await page.locator(`[data-category="${category}"]`).evaluate((el) => {
        const r = el.getBoundingClientRect()
        return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, hit: document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)?.outerHTML.slice(0,300), list: el.closest('.menu__category-list')?.getBoundingClientRect().toJSON() }
      }))
      throw err
    }
  }
  const scope = (id) => id === 'landscape' ? 'unsplash' : `unsplash:${id}`
  const active = async (id) => {
    const end = Date.now() + 40000
    while (Date.now() < end) {
      const state = await page.evaluate(async ({ s, id }) => {
        const bag = await chrome.storage.local.get(null)
        const p = bag[`pool:${s}`]?.photos?.[bag[`index:${s}`] ?? 0]
        return Boolean(bag.settings?.unsplashCategory === id && p &&
          document.querySelector('.credit')?.textContent.includes(p.authorName) &&
          document.querySelector('.bg__layer--top.is-visible') && !document.querySelector('.menu'))
      }, { s: scope(id), id })
      if (state) return
      await page.waitForTimeout(200)
    }
    const bag = await page.evaluate(async () => chrome.storage.local.get(null))
    throw new Error(`category ${id} did not reach screen; keys=${Object.keys(bag)} settings=${JSON.stringify(bag.settings)}`)
  }
  await menu()
  await page.locator('.menu__category-toggle').click()
  const labels = await page.locator('[data-category]').allTextContents()
  assert.equal(labels.length, 23)
  assert.ok(labels.includes('风景') && labels.includes('壁纸') && labels.includes('插画壁纸'))
  pass('all 21 official topics + landscape + all-random listed')
  await page.screenshot({ path: join(out, 'categories-menu.png') })
  await page.getByRole('searchbox', { name: '搜索图片类型' }).fill('壁纸')
  assert.equal(await page.locator('[data-category]').count(), 2)
  pass('Chinese category search finds photography and illustration wallpapers')
  await page.locator('[data-category="wallpapers"]').click()
  await active('wallpapers')
  pass(`${fixture ? 'fixture' : 'live'} wallpaper topic fetched and matching credit displayed`)
  await choose('illustration-wallpapers')
  await active('illustration-wallpapers')
  pass(`${fixture ? 'fixture' : 'live'} illustration topic works through topic photos endpoint`)
  await page.screenshot({ path: join(out, 'categories-illustration.png') })
  const data = await page.evaluate(async () => chrome.storage.local.get(null))
  assert.ok(data['pool:unsplash']?.photos?.length)
  assert.ok(data['pool:unsplash:wallpapers']?.photos?.length)
  assert.ok(data['pool:unsplash:illustration-wallpapers']?.photos?.length)
  assert.equal(data.settings.unsplashCategory, 'illustration-wallpapers')
  pass('category pools and selected preference persisted independently')
  if (fixture) {
    await context.route(base + '/download', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"ok":false}' }))
    await choose('travel')
    await active('travel')
    await page.waitForTimeout(300)
    const failed = await page.evaluate(async () => chrome.storage.local.get('pingedPhotoIds'))
    assert.ok(!(failed.pingedPhotoIds ?? []).includes('travel-0'))
    pass('failed download report is not stored as success')
    await context.unroute(base + '/download')
    await context.route(base + '/download', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
  }

  await choose('landscape')
  await active('landscape')
  // First-ever animals request is held across an A-B-A cycle. Fulfill from a
  // genuine upstream result after later choices, to test commit-time guards.
  let release
  const gate = new Promise((r) => { release = r })
  let seen
  const arrived = new Promise((r) => { seen = r })
  const matcher = (url) => url.origin === base && url.pathname === '/photos' && url.searchParams.get('category') === 'animals'
  let done
  const handled = new Promise((r) => { done = r })
  await context.route(matcher, async (route) => {
    seen()
    await gate
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data['pool:unsplash:wallpapers'].photos.map((p) => ({ id: p.id, urls: { raw: p.url }, user: { name: 'LATE-OLD-REQUEST' }, links: { download_location: p.downloadLocation } }))) })
    done()
  })
  await choose('animals')
  await arrived
  await choose('nature')
  await choose('landscape')
  await active('landscape')
  release()
  await handled
  await context.unroute(matcher)
  await page.waitForTimeout(500)
  assert.ok(!(await page.locator('.credit').textContent()).includes('LATE-OLD-REQUEST'))
  assert.equal((await page.evaluate(async () => (await chrome.storage.local.get('settings')).settings)).unsplashCategory, 'landscape')
  pass('late prior-category response cannot replace current wallpaper or credit')

  await menu()
  await page.locator('.menu__category-toggle').click()
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.waitForTimeout(200)
  const fit = await page.locator('.menu').evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, right: r.right, height: innerHeight, width: innerWidth }
  })
  assert.ok(fit.top >= 9 && fit.bottom <= fit.height - 9 && fit.right <= fit.width - 9)
  assert.equal(await page.locator('[data-category]').count(), 23)
  pass('expanded category menu stays inside resized 1280x720 viewport')
  await page.keyboard.press('Escape')
  const second = await context.newPage()
  await second.goto(extUrl)
  await second.waitForSelector('.bg__layer--top.is-visible')
  await context.setOffline(true)
  await second.reload()
  await second.waitForSelector('.bg__layer--top.is-visible')
  pass('selected-category photo can be restored offline')
  await context.setOffline(false)
  await writeFile(join(out, 'categories-report.json'), JSON.stringify({ mode: fixture ? 'fixture' : 'live', labels, checks }, null, 2))
} finally {
  await context.close()
}
console.log('ALL CATEGORY CHECKS PASSED')
