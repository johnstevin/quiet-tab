// Pixel-level proof that the clock does not move.
//
// Hand-waving ("looks fine to me") is not evidence. This script drives a real
// Chromium, forces the clock through every second boundary where digit widths
// change, and asserts that the bounding rectangles are bit-identical to three
// decimal places.
//
//   npm run verify        static-server mode: the pixel assertions
//   npm run verify:ext    extension mode: CSP, storage, cache, offline
//
// Determinism comes from two choices:
//   * the browser context is pinned to UTC, so the machine's timezone cannot
//     change what the clock displays;
//   * Playwright's virtual clock (page.clock) replaces Date and the timer
//     queue, so we land exactly on 23:59:58 instead of waiting for midnight.

import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const OUT = join(ROOT, '.verify')

const MODE = process.argv.includes('--mode=extension') ? 'extension' : 'static'

/* ═══════════════════════════════════════════════════════════════════════════
   Test matrix
   Every case starts at X.500 — mid-second, deliberately. The app schedules its
   next tick at `1000 - (Date.now() % 1000) + 8`ms, so starting mid-second makes
   each clock.runFor(1000) advance the display by exactly one second: the first
   timer fires 508ms in, and the following one is 1000ms later, beyond the
   window. Starting on a whole second would make the first runFor(1000) fire
   nothing (the timer would sit at +1008ms).
   ═══════════════════════════════════════════════════════════════════════════ */

const CASES = [
  // Width extremes. "1" is the narrowest glyph in Inter (0.407em) and "4" the
  // widest (0.646em) — a 59% spread. If anything is going to shift, these do it.
  { label: 'all-ones    11:11:11', start: '2026-10-22T11:11:11.500Z', ticks: 3 },
  { label: 'all-zeros   00:00:00', start: '2026-10-22T00:00:00.500Z', ticks: 3 },
  { label: 'widest "4"  14:44:44', start: '2026-10-22T14:44:44.500Z', ticks: 3 },

  // Single-digit -> double-digit transitions in the seconds column.
  { label: 'sec 09->10', start: '2026-10-22T10:13:09.500Z', ticks: 2 },
  { label: 'sec 19->20', start: '2026-10-22T10:13:19.500Z', ticks: 2 },

  // Carries: every digit to the left changes at once.
  { label: 'min carry   10:13:59', start: '2026-10-22T10:13:58.500Z', ticks: 3 },
  { label: 'hour carry  09:59:59', start: '2026-10-22T09:59:58.500Z', ticks: 3 },
  // Also exercises the date line changing underneath the clock.
  { label: 'day carry   23:59:58', start: '2026-10-22T23:59:58.500Z', ticks: 3 },
]

/* ═══════════════════════════════════════════════════════════════════════════
   Zero-dependency static server
   ═══════════════════════════════════════════════════════════════════════════ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

function startServer(rootDir) {
  return new Promise((done) => {
    const server = createServer(async (req, res) => {
      try {
        const path = decodeURIComponent((req.url || '/').split('?')[0])
        const rel = path === '/' ? '/newtab.html' : path
        // Strip traversal attempts before joining.
        const safe = normalize(rel).replace(/^(\.\.[\\/])+/, '')
        const file = join(rootDir, safe)
        const body = await readFile(file)
        res.writeHead(200, {
          'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        })
        res.end(body)
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not found')
      }
    })
    server.listen(0, '127.0.0.1', () => done(server))
  })
}

/* ═══════════════════════════════════════════════════════════════════════════
   In-page probes
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Snapshot the clock's geometry.
 * Three decimal places on purpose: sub-pixel creep of 0.01px is still a bug,
 * and rounding to integers would hide exactly the class of defect we are
 * hunting.
 */
const MEASURE = () => {
  const round = (n) => Math.round(n * 1000) / 1000
  const clock = document.querySelector('[data-testid="clock"]')
  const dateEl = document.querySelector('[data-testid="clock-date"]')
  if (!clock || !dateEl) throw new Error('clock elements not found')

  const r = clock.getBoundingClientRect()
  const d = dateEl.getBoundingClientRect()

  return {
    text: (clock.textContent || '').trim(),
    date: (dateEl.textContent || '').trim(),
    row: {
      x: round(r.x),
      y: round(r.y),
      w: round(r.width),
      h: round(r.height),
      right: round(r.right),
      bottom: round(r.bottom),
    },
    // Positive means a glyph is wider than the slot that holds it.
    overflow: round(clock.scrollWidth - clock.clientWidth),
    slotCount: clock.children.length,
    slots: Array.from(clock.children).map((el) => {
      const s = el.getBoundingClientRect()
      return { ch: (el.textContent || '').trim(), x: round(s.x), w: round(s.w ?? s.width) }
    }),
    // Only `y` matters for the date: its width legitimately changes with the
    // text ("10月22日星期四" vs "1月1日星期四"), but it must never move
    // vertically, because that is the layout shift users actually notice.
    dateY: round(d.y),
  }
}

/**
 * Does the font problem actually exist, and does `tnum` actually fix it?
 *
 * Measures "000000" against "111111" twice: once with proportional figures and
 * once with tabular. The first pair MUST differ (otherwise this whole project
 * is solving a non-problem) and the second MUST match (otherwise Inter's tnum
 * feature was stripped by Fontsource's subsetting pipeline).
 */
const FONT_PROBE = () => {
  const round = (n) => Math.round(n * 1000) / 1000
  const measure = (tabular, text) => {
    const el = document.createElement('span')
    el.style.cssText = [
      'position:absolute',
      'left:-99999px',
      'top:0',
      'font-family:InterVar',
      'font-weight:200',
      'font-size:200px',
      'line-height:1',
      'white-space:pre',
      `font-variant-numeric:${tabular ? 'tabular-nums' : 'proportional-nums'}`,
      `font-feature-settings:'tnum' ${tabular ? 1 : 0}`,
      'font-optical-sizing:none',
      'font-kerning:none',
    ].join(';')
    el.textContent = text
    document.body.appendChild(el)
    const w = el.getBoundingClientRect().width
    el.remove()
    return round(w)
  }

  return {
    fontLoaded: document.fonts.check('200 200px InterVar'),
    proportionalZeros: measure(false, '000000'),
    proportionalOnes: measure(false, '111111'),
    tabularZeros: measure(true, '000000'),
    tabularOnes: measure(true, '111111'),
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Assertions
   ═══════════════════════════════════════════════════════════════════════════ */

const failures = []
const notes = []

function fail(msg) {
  failures.push(msg)
  console.log(`  FAIL  ${msg}`)
}
function pass(msg) {
  console.log(`  ok    ${msg}`)
}

/* ═══════════════════════════════════════════════════════════════════════════
   Settings UI checks (static mode)

   These need no network: the context menu is pure UI, and the bundled wallpaper
   layer is present on the dev server too. Two things are proven here.

   1. BLUR MUST NOT MOVE THE BACKGROUND. The layers are object-fit:cover, so if
      the overscan tracked the blur radius, resizing them would re-derive the
      cover scale and the photo would zoom and drift while dragging the slider.
      We sweep the full range and assert the layer's rectangle is byte-identical
      at every value — only the filter may change.

   2. HIDING THE SECONDS MUST NOT REINTRODUCE JITTER. The row legitimately gets
      narrower, but it must then stay just as immovable while running.
   ═══════════════════════════════════════════════════════════════════════════ */

const LAYER_PROBE = () => {
  const round = (n) => Math.round(n * 1000) / 1000
  const layer = document.querySelector('.bg__layer')
  const holder = document.querySelector('.bg')
  if (!layer || !holder) throw new Error('background layers not found')
  const r = layer.getBoundingClientRect()
  return {
    rect: { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) },
    filter: getComputedStyle(layer).filter,
    mode: holder.getAttribute('data-blur'),
    viewport: { w: window.innerWidth, h: window.innerHeight },
  }
}

async function runUiChecks(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    timezoneId: 'UTC',
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()

  const consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

  // A time whose seconds and minutes both roll over during the sweep.
  await page.clock.install({ time: new Date('2026-10-22T09:59:58.500Z') })
  await page.goto(url, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForSelector('.bg__layer')

  /* ── blur sweep ───────────────────────────────────────────────────────────── */
  const openMenu = async () => {
    await page.mouse.click(220, 170, { button: 'right' })
    await page.waitForSelector('.menu[data-placed="yes"]', { timeout: 6000 })
  }

  await openMenu()
  const menuOpened = (await page.locator('.menu').count()) === 1

  /**
   * Objective containment check.
   *
   * Squinting at a screenshot cannot reliably tell whether the slider track
   * pokes out past a translucent rounded panel. Enumerate every descendant and
   * compare rectangles instead.
   */
  const containment = await page.evaluate(() => {
    const round = (n) => Math.round(n * 100) / 100
    const menu = document.querySelector('.menu')
    if (!menu) throw new Error('.menu not found')
    const box = menu.getBoundingClientRect()
    const escapees = []

    for (const el of menu.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      // Half a pixel of slack absorbs sub-pixel rounding.
      const over = {
        left: round(box.left - r.left),
        right: round(r.right - box.right),
        top: round(box.top - r.top),
        bottom: round(r.bottom - box.bottom),
      }
      const worst = Math.max(over.left, over.right, over.top, over.bottom)
      if (worst > 0.5) {
        escapees.push({
          cls: typeof el.className === 'string' ? el.className : String(el.className),
          tag: el.tagName.toLowerCase(),
          over,
        })
      }
    }

    return {
      box: { w: round(box.width), h: round(box.height) },
      escapees,
      overflowX: round(menu.scrollWidth - menu.clientWidth),
      overflowY: round(menu.scrollHeight - menu.clientHeight),
    }
  })

  const blurSweep = []
  for (const value of [0, 1, 8, 17, 26, 33, 40, 8]) {
    await page.locator('.menu__slider').fill(String(value))
    // Let the style recalc land.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))
    blurSweep.push({ value, ...(await page.evaluate(LAYER_PROBE)) })
  }

  /* ── seconds toggle ──────────────────────────────────────────────────────── */
  const secondsLabels = await page.$$eval('.menu__item .menu__text', (els) =>
    els.map((e) => e.textContent.trim()),
  )

  const withSeconds = [await page.evaluate(MEASURE)]
  for (let i = 0; i < 2; i += 1) {
    await page.clock.runFor(1000)
    withSeconds.push(await page.evaluate(MEASURE))
  }

  // Toggle it off. This item deliberately keeps the menu open.
  await page.locator('.menu__item', { hasText: '显示秒' }).first().click()
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))

  const menuStillOpen = (await page.locator('.menu[data-placed="yes"]').count()) === 1

  const withoutSeconds = [await page.evaluate(MEASURE)]
  for (let i = 0; i < 3; i += 1) {
    await page.clock.runFor(1000)
    withoutSeconds.push(await page.evaluate(MEASURE))
  }

  const storedOff = await page.evaluate(() => {
    const raw = localStorage.getItem('settings')
    return raw ? JSON.parse(raw).showSeconds : null
  })

  // Capture while the menu is still open and seconds are still hidden, so the
  // artefact actually shows the state its filename claims.
  await page.screenshot({ path: join(OUT, 'menu-no-seconds.png') })

  // Back on, and confirm it recovers.
  await page.locator('.menu__item', { hasText: '显示秒' }).first().click()
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))
  const restored = await page.evaluate(MEASURE)

  await page.screenshot({ path: join(OUT, 'menu-open.png') })

  await page.keyboard.press('Escape')
  const menuClosed = (await page.locator('.menu').count()) === 0

  /* ── search box ──────────────────────────────────────────────────────────── */

  const searchBar = await page.evaluate(() => {
    const bar = document.querySelector('.search__bar')
    const input = document.querySelector('.search__input')
    if (!bar || !input) return null
    const r = bar.getBoundingClientRect()
    const cs = getComputedStyle(bar)
    // Report both properties separately. `||` would be wrong here: the string
    // "none" is truthy, so it would short-circuit before ever looking at the
    // prefixed alias.
    return {
      width: Math.round(r.width),
      height: Math.round(r.height),
      radius: cs.borderTopLeftRadius,
      backdrop: cs.backdropFilter,
      backdropWebkit: cs.webkitBackdropFilter ?? 'unsupported',
      placeholder: input.getAttribute('placeholder'),
    }
  })

  // Spotlight behaviour: a printable key anywhere should hand over to the box.
  await page.mouse.click(1240, 780)
  await page.keyboard.press('g')
  await page.waitForTimeout(150)
  const spotlight = await page.evaluate(() => ({
    focused: document.activeElement?.classList.contains('search__input') ?? false,
    value: document.querySelector('.search__input')?.value ?? '',
  }))

  // The AI row depends only on there being a query, so it shows even here where
  // the suggestion endpoints are unreachable (no CORS off-extension).
  await page.locator('.search__input').fill('chrome extension')
  await page.waitForTimeout(260)
  const aiRow = await page.evaluate(() => {
    const row = document.querySelector('.search__row--ai')
    return {
      present: Boolean(row),
      text: row?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    }
  })

  // Bing exposes no AI-Mode equivalent, so the row must disappear for it. This
  // is the negative half of the assertion — without it, a row that is always
  // rendered would pass the test above.
  await openMenu()
  await page.locator('.menu__segment-item', { hasText: 'Bing' }).first().click()
  await page.keyboard.press('Escape')
  await page.locator('.search__input').fill('chrome extension')
  await page.waitForTimeout(260)
  const bingProbe = await page.evaluate(() => ({
    aiRow: Boolean(document.querySelector('.search__row--ai')),
    placeholder: document.querySelector('.search__input')?.getAttribute('placeholder') ?? null,
    // Read the engine from storage, not the DOM: the segmented control only
    // exists while the menu is open, and we closed it to type in the box.
    engine: JSON.parse(localStorage.getItem('settings') ?? '{}').engine ?? null,
  }))

  await openMenu()
  await page.locator('.menu__segment-item', { hasText: 'Google' }).first().click()
  await page.keyboard.press('Escape')
  await page.locator('.search__input').fill('chrome ext')
  await page.waitForTimeout(260)
  await page.screenshot({ path: join(OUT, 'search-open.png') })

  // Visibility toggles.
  await page.locator('.search__input').fill('')
  await openMenu()
  await page.locator('.menu__item', { hasText: '搜索框' }).first().click()
  await page.waitForTimeout(160)
  const searchHidden = (await page.locator('.search').count()) === 0
  await page.locator('.menu__item', { hasText: '搜索框' }).first().click()
  await page.waitForTimeout(160)
  const searchRestored = (await page.locator('.search').count()) === 1

  const menuLabels = await page.$$eval('.menu__item .menu__text', (els) =>
    els.map((e) => e.textContent.trim()),
  )
  const segments = await page.$$eval('.menu__segment-item', (els) =>
    els.map((e) => e.textContent.trim()),
  )

  await page.keyboard.press('Escape')

  /* ── weather, end to end ─────────────────────────────────────────────────── */
  // This is a REAL network check. Open-Meteo answers with
  // `Access-Control-Allow-Origin: *`, so unlike the wallpaper providers and the
  // suggestion endpoints it works outside the extension — which means the whole
  // weather path can be exercised here instead of only in extension mode.
  //
  // A city is injected rather than relying on geolocation, which headless
  // Chromium denies by default.
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('settings') ?? '{}')
    stored.place = { name: '西雅图 · 华盛顿州·美国', lat: 47.60621, lon: -122.33207 }
    stored.showWeather = true
    stored.engine = 'google'
    localStorage.setItem('settings', JSON.stringify(stored))
  })
  await page.reload({ waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)

  let weather = null
  try {
    await page.waitForSelector('.weather__temp', { timeout: 25_000 })
    weather = await page.evaluate(() => {
      const block = document.querySelector('.weather')
      const icon = document.querySelector('.weather__icon')
      return {
        text: block?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
        temp: document.querySelector('.weather__temp')?.textContent?.trim() ?? null,
        title: block?.getAttribute('title') ?? null,
        // Confirms the SVG actually drew something rather than rendering empty.
        iconShapes: icon ? icon.querySelectorAll('path, circle, line').length : 0,
      }
    })
    await page.screenshot({ path: join(OUT, 'with-weather.png') })
  } catch {
    weather = { error: '天气行在 25s 内未出现' }
  }

  await context.close()

  return {
    menuOpened,
    menuStillOpen,
    menuClosed,
    containment,
    blurSweep,
    secondsLabels,
    withSeconds,
    withoutSeconds,
    storedOff,
    restored,
    searchBar,
    spotlight,
    aiRow,
    bingProbe,
    searchHidden,
    searchRestored,
    menuLabels,
    segments,
    weather,
    consoleErrors,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Static mode — the pixel assertions
   ═══════════════════════════════════════════════════════════════════════════ */

async function runStatic() {
  if (!existsSync(join(DIST, 'newtab.html'))) {
    throw new Error('dist/newtab.html missing — run `npm run build` first')
  }

  const server = await startServer(DIST)
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}/newtab.html`
  console.log(`serving dist/ at ${url}\n`)

  const browser = await chromium.launch()
  const frames = []
  let fontProbe = null
  let ui = null

  try {
    for (const testCase of CASES) {
      // A fresh context per case so the virtual clock starts clean.
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        timezoneId: 'UTC',
        deviceScaleFactor: 1,
      })
      const page = await context.newPage()

      const consoleErrors = []
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text())
      })
      page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

      // MUST precede goto: the first render reads Date() synchronously, and
      // that very first frame is part of what we are validating.
      await page.clock.install({ time: new Date(testCase.start) })
      await page.goto(url, { waitUntil: 'load' })

      await page.evaluate(() => document.fonts.ready)
      await page.waitForSelector('[data-testid="clock"]')

      if (!fontProbe) fontProbe = await page.evaluate(FONT_PROBE)

      const series = [await page.evaluate(MEASURE)]
      for (let i = 0; i < testCase.ticks; i += 1) {
        await page.clock.runFor(1000)
        series.push(await page.evaluate(MEASURE))
      }

      // Throttle-recovery: jump 10 minutes the way a backgrounded tab would.
      await page.clock.fastForward('10:00')
      const afterJump = await page.evaluate(MEASURE)

      frames.push({ case: testCase.label, series, afterJump, consoleErrors })

      if (testCase.label.startsWith('sec 09->10')) {
        await mkdir(OUT, { recursive: true })
        await page.screenshot({ path: join(OUT, 'clock.png') })
      }

      await context.close()
    }

    ui = await runUiChecks(browser, url)
  } finally {
    await browser.close()
    server.close()
  }

  /* ── font self-check ─────────────────────────────────────────────────────── */
  console.log('FONT')
  if (!fontProbe.fontLoaded) {
    fail('InterVar did not load — every measurement below is meaningless')
  } else {
    pass('InterVar loaded')
  }

  const spread = Math.abs(fontProbe.proportionalZeros - fontProbe.proportionalOnes)
  if (spread < 0.5) {
    fail(
      `proportional "000000" (${fontProbe.proportionalZeros}px) and "111111" ` +
        `(${fontProbe.proportionalOnes}px) are the same width — the probe is broken, ` +
        'so a passing result below would prove nothing',
    )
  } else {
    pass(
      `problem reproduced: proportional digits differ by ${spread.toFixed(1)}px ` +
        `at 200px (000000=${fontProbe.proportionalZeros} vs 111111=${fontProbe.proportionalOnes})`,
    )
  }

  if (fontProbe.tabularZeros !== fontProbe.tabularOnes) {
    notes.push(
      `Inter's tnum feature did NOT equalise digit widths ` +
        `(${fontProbe.tabularZeros} vs ${fontProbe.tabularOnes}). Defence 1 is ` +
        'inactive; the fixed-slot layout below is carrying the result alone.',
    )
    console.log(`  note  tnum ineffective (${fontProbe.tabularZeros} vs ${fontProbe.tabularOnes})`)
  } else {
    pass(`tnum works: tabular "000000" == "111111" == ${fontProbe.tabularZeros}px`)
  }

  /* ── geometry: the actual point ──────────────────────────────────────────── */
  const all = frames.flatMap((f) => [...f.series, f.afterJump].map((m) => ({ ...m, case: f.case })))
  const ref = all[0]

  console.log('\nGEOMETRY')
  console.log(`  ${all.length} frames across ${CASES.length} cases`)

  for (const key of ['x', 'y', 'w', 'h', 'right', 'bottom']) {
    const bad = all.filter((m) => m.row[key] !== ref.row[key])
    if (bad.length) {
      const worst = bad.reduce(
        (acc, m) => (Math.abs(m.row[key] - ref.row[key]) > Math.abs(acc.row[key] - ref.row[key]) ? m : acc),
        bad[0],
      )
      fail(
        `row.${key} moved in ${bad.length}/${all.length} frames; worst: ` +
          `"${worst.text}" (${worst.case}) ${worst.row[key]} vs expected ${ref.row[key]} ` +
          `(delta ${(worst.row[key] - ref.row[key]).toFixed(3)}px)`,
      )
    } else {
      pass(`row.${key} constant at ${ref.row[key]}px across all ${all.length} frames`)
    }
  }

  const wrongCount = all.filter((m) => m.slotCount !== 8)
  if (wrongCount.length) fail(`expected 8 slots, saw ${wrongCount[0].slotCount}`)
  else pass('8 fixed slots present in every frame')

  for (let i = 0; i < 8; i += 1) {
    const bad = all.filter((m) => m.slots[i].x !== ref.slots[i].x || m.slots[i].w !== ref.slots[i].w)
    if (bad.length) {
      const b = bad[0]
      fail(
        `slot[${i}] moved: "${b.slots[i].ch}" at x=${b.slots[i].x} w=${b.slots[i].w} ` +
          `(expected x=${ref.slots[i].x} w=${ref.slots[i].w}) in "${b.text}"`,
      )
    }
  }
  if (!failures.some((f) => f.startsWith('slot['))) {
    pass(
      `all 8 slots pinned — digit slots ${ref.slots[0].w}px, colon slots ${ref.slots[2].w}px, ` +
        'identical in every frame',
    )
  }

  const overflowing = all.filter((m) => m.overflow > 0)
  if (overflowing.length) {
    const w = overflowing.reduce((a, m) => (m.overflow > a.overflow ? m : a), overflowing[0])
    fail(`glyph overflows its slot by ${w.overflow}px in "${w.text}" — raise --digit-slot`)
  } else {
    pass('no glyph overflows its slot (widest case 14:44:44 included)')
  }

  const dateMoved = all.filter((m) => m.dateY !== ref.dateY)
  if (dateMoved.length) {
    fail(`date line moved vertically: ${dateMoved[0].dateY} vs ${ref.dateY} — layout shift`)
  } else {
    pass(`date line pinned at y=${ref.dateY}px (no CLS from the clock above it)`)
  }

  /* ── behaviour ───────────────────────────────────────────────────────────── */
  console.log('\nBEHAVIOUR')
  const ticked = frames.filter((f) => {
    const seen = new Set(f.series.map((m) => m.text))
    return seen.size === f.series.length
  })
  if (ticked.length === frames.length) {
    pass(`clock advanced exactly one second per tick in all ${frames.length} cases`)
  } else {
    const stuck = frames.find((f) => new Set(f.series.map((m) => m.text)).size !== f.series.length)
    fail(`clock did not advance cleanly in "${stuck.case}": ${stuck.series.map((m) => m.text).join(' -> ')}`)
  }

  const dayCarry = frames.find((f) => f.case.includes('day carry'))
  const dates = [...new Set(dayCarry.series.map((m) => m.date))]
  if (dates.length === 2) pass(`date rolled over: ${dates.join(' -> ')}`)
  else fail(`expected a date rollover across midnight, saw: ${dates.join(', ')}`)

  // 10 minutes forward from the last tick of each case must land exactly.
  const jumpOk = frames.every((f) => {
    const before = f.series[f.series.length - 1].text
    const [h, m, s] = before.split(':').map(Number)
    const t = (h * 3600 + m * 60 + s + 600) % 86400
    const expect = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60]
      .map((n) => String(n).padStart(2, '0'))
      .join(':')
    return f.afterJump.text === expect
  })
  if (jumpOk) pass('after a 10-minute jump (throttled-tab simulation) the time is exact, no drift')
  else {
    const b = frames.find((f) => {
      const before = f.series[f.series.length - 1].text
      const [h, m, s] = before.split(':').map(Number)
      const t = (h * 3600 + m * 60 + s + 600) % 86400
      const expect = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60]
        .map((n) => String(n).padStart(2, '0'))
        .join(':')
      return f.afterJump.text !== expect
    })
    fail(`10-minute jump drifted in "${b.case}": ${b.series.at(-1).text} + 10min = ${b.afterJump.text}`)
  }

  const noisy = frames.filter((f) => f.consoleErrors.length)
  if (noisy.length) fail(`console errors in "${noisy[0].case}": ${noisy[0].consoleErrors[0]}`)
  else pass('no console errors or uncaught exceptions')

  /* ── settings UI ─────────────────────────────────────────────────────────── */
  console.log('\nSETTINGS UI')

  if (ui.menuOpened) pass('right-click opens the in-page context menu')
  else fail('right-click did not open the context menu')

  if (ui.containment.escapees.length === 0) {
    pass(
      `every control sits inside the ${ui.containment.box.w}x${ui.containment.box.h} panel ` +
        '(no element escapes its rounded bounds)',
    )
  } else {
    const e = ui.containment.escapees[0]
    const side = Object.entries(e.over).reduce((a, b) => (b[1] > a[1] ? b : a))
    fail(
      `"${e.cls || e.tag}" overflows the menu panel by ${side[1]}px on the ${side[0]} ` +
        `(${ui.containment.escapees.length} element(s) affected)`,
    )
  }

  if (ui.containment.overflowX <= 0 && ui.containment.overflowY <= 0) {
    pass('menu panel has no clipped or scrollable content')
  } else {
    fail(
      `menu content overflows: x=${ui.containment.overflowX}px y=${ui.containment.overflowY}px`,
    )
  }

  const sweepValues = ui.blurSweep.map((s) => s.value).join('/')
  const blurRef = ui.blurSweep[0].rect
  const drifted = ui.blurSweep.filter(
    (s) =>
      s.rect.x !== blurRef.x ||
      s.rect.y !== blurRef.y ||
      s.rect.w !== blurRef.w ||
      s.rect.h !== blurRef.h,
  )
  if (drifted.length) {
    const worst = drifted[0]
    fail(
      `background layer MOVED when blur became ${worst.value}px: ` +
        `${JSON.stringify(worst.rect)} vs ${JSON.stringify(blurRef)} — ` +
        'the overscan must be constant, not derived from the radius',
    )
  } else {
    pass(
      `background geometry identical across blur ${sweepValues}px ` +
        `(pinned at ${blurRef.w}x${blurRef.h} @ ${blurRef.x},${blurRef.y})`,
    )
  }

  const first = ui.blurSweep[0]
  if (first.rect.w > first.viewport.w && first.rect.h > first.viewport.h) {
    pass(
      `constant overscan in place: layer ${first.rect.w}x${first.rect.h} vs ` +
        `${first.viewport.w}x${first.viewport.h} viewport, so blurred edges stay off-screen`,
    )
  } else {
    fail(`layer ${first.rect.w}x${first.rect.h} does not exceed the viewport — blur edges will show`)
  }

  const wrongFilter = ui.blurSweep.filter(
    (s) => s.filter !== (s.value > 0 ? `blur(${s.value}px)` : 'none'),
  )
  if (wrongFilter.length) {
    const w = wrongFilter[0]
    fail(`blur ${w.value}px produced filter "${w.filter}" (mode=${w.mode})`)
  } else {
    pass('filter tracks the slider exactly, and blur 0 removes the filter altogether')
  }

  if (ui.secondsLabels.includes('显示秒')) pass('"显示秒" present in the menu')
  else fail(`"显示秒" missing from the menu (saw: ${ui.secondsLabels.join(', ')})`)

  const onSlots = ui.withSeconds[0].slotCount
  const offSlots = ui.withoutSeconds[0].slotCount
  if (onSlots === 8 && offSlots === 5) {
    pass(
      `seconds on -> 8 slots "${ui.withSeconds[0].text}" (${ui.withSeconds[0].row.w}px), ` +
        `off -> 5 slots "${ui.withoutSeconds[0].text}" (${ui.withoutSeconds[0].row.w}px)`,
    )
  } else {
    fail(`slot counts wrong: on=${onSlots} off=${offSlots} (expected 8 and 5)`)
  }

  const offRef = ui.withoutSeconds[0].row
  const offMoved = ui.withoutSeconds.filter(
    (m) => m.row.x !== offRef.x || m.row.y !== offRef.y || m.row.w !== offRef.w,
  )
  if (offMoved.length) {
    fail(
      `clock jittered with seconds hidden: ${JSON.stringify(offMoved[0].row)} ` +
        `vs ${JSON.stringify(offRef)}`,
    )
  } else {
    pass(
      `seconds-hidden clock is equally immovable across ${ui.withoutSeconds.length} frames ` +
        `(${ui.withoutSeconds.map((m) => m.text).join(' -> ')})`,
    )
  }

  if (ui.storedOff === false) pass('"显示秒" persisted to storage')
  else fail(`"显示秒" was not persisted (stored value: ${ui.storedOff})`)

  if (ui.menuStillOpen) pass('live settings keep the menu open; navigation closes it')
  else notes.push('menu closed after toggling 显示秒 — it is meant to stay open')

  if (ui.restored.slotCount === 8) pass('toggling seconds back on restores all 8 slots')
  else fail(`restoring seconds produced ${ui.restored.slotCount} slots`)

  if (ui.menuClosed) pass('Escape dismisses the menu')
  else fail('Escape did not dismiss the menu')

  /* ── search + weather ────────────────────────────────────────────────────── */
  console.log('\nSEARCH & WEATHER')

  const expectedMenu = ['上一张', '下一张', 'Unsplash', 'Bing 每日', '搜索框', '天气', '显示秒', '天气位置']
  const absent = expectedMenu.filter((label) => !ui.menuLabels.includes(label))
  if (absent.length === 0) pass(`menu exposes all ${expectedMenu.length} expected entries`)
  else fail(`menu is missing: ${absent.join(', ')}`)

  if (ui.segments.join('/') === 'Google/Bing/DDG') {
    pass('engine segmented control offers Google / Bing / DDG')
  } else {
    fail(`engine segments are ${ui.segments.join('/')}, expected Google/Bing/DDG`)
  }

  if (!ui.searchBar) {
    fail('search box did not render')
  } else {
    const { width, height, radius, placeholder } = ui.searchBar
    if (radius === `${Math.round(height / 2)}px` || parseFloat(radius) >= height / 2 - 1) {
      pass(`search bar is a full pill (${width}x${height}, radius ${radius})`)
    } else {
      fail(`search bar radius ${radius} does not make a pill at height ${height}`)
    }
    if (ui.searchBar.backdrop.includes('blur')) {
      pass(`frosted glass active (standard property): ${ui.searchBar.backdrop}`)
    } else if (ui.searchBar.backdropWebkit.includes('blur')) {
      notes.push(
        'backdrop blur only survives as -webkit-backdrop-filter; the standard ' +
          'property was stripped by the CSS minifier',
      )
    } else {
      fail(
        `search bar has no backdrop blur ` +
          `(standard="${ui.searchBar.backdrop}" webkit="${ui.searchBar.backdropWebkit}")`,
      )
    }
    if (placeholder?.includes('Google')) pass(`placeholder names the engine: "${placeholder}"`)
    else fail(`placeholder does not name the engine: "${placeholder}"`)
  }

  if (ui.spotlight.focused && ui.spotlight.value === 'g') {
    pass('typing anywhere hands the keystroke to the search box (Spotlight-style)')
  } else {
    fail(
      `printable key did not reach the search box ` +
        `(focused=${ui.spotlight.focused} value="${ui.spotlight.value}")`,
    )
  }

  if (ui.aiRow.present && ui.aiRow.text?.includes('chrome extension')) {
    pass(`AI-mode handoff row present for Google: "${ui.aiRow.text}"`)
  } else {
    fail(`AI-mode row missing or wrong for Google (${JSON.stringify(ui.aiRow)})`)
  }

  // The negative half: without this, a permanently rendered row would pass.
  if (ui.bingProbe.engine === 'bing' && ui.bingProbe.aiRow === false) {
    pass('AI-mode row correctly absent for Bing, which has no equivalent')
  } else {
    fail(
      `Bing should expose no AI-mode row ` +
        `(engine=${ui.bingProbe.engine} aiRow=${ui.bingProbe.aiRow})`,
    )
  }

  if (ui.bingProbe.placeholder?.includes('Bing')) {
    pass('placeholder follows the selected engine')
  } else {
    fail(`placeholder did not follow the engine switch: "${ui.bingProbe.placeholder}"`)
  }

  if (ui.searchHidden && ui.searchRestored) {
    pass('"搜索框" toggle removes and restores the search box')
  } else {
    fail(`search toggle broken (hidden=${ui.searchHidden} restored=${ui.searchRestored})`)
  }

  if (ui.weather?.error) {
    fail(`weather: ${ui.weather.error}`)
  } else if (ui.weather) {
    const { temp, text, title, iconShapes } = ui.weather
    if (/^-?\d+°$/.test(temp ?? '')) pass(`weather fetched live from Open-Meteo: "${text}"`)
    else fail(`weather temperature looks wrong: "${temp}"`)

    if (iconShapes > 0) pass(`weather icon drew ${iconShapes} SVG primitive(s)`)
    else fail('weather icon rendered empty')

    if (title && /体感/.test(title) && /湿度/.test(title)) {
      pass(`extra readings kept in the tooltip: "${title}"`)
    } else {
      fail(`weather tooltip missing details: "${title}"`)
    }
  }

  if (ui.consoleErrors.length) fail(`uncaught error during UI checks: ${ui.consoleErrors[0]}`)

  await mkdir(OUT, { recursive: true })
  await writeFile(
    join(OUT, 'clock-report.json'),
    JSON.stringify({ mode: 'static', fontProbe, frames, ui, failures, notes }, null, 2),
    'utf8',
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Extension mode — CSP, storage, cache, offline
   Separate on purpose: a Node static server proves nothing about how Chrome
   treats a real chrome-extension:// page.
   ═══════════════════════════════════════════════════════════════════════════ */

async function runExtension() {
  if (!existsSync(join(DIST, 'manifest.json'))) {
    throw new Error('dist/manifest.json missing — run `npm run build` first')
  }

  const profile = join(OUT, 'chrome-profile')
  await mkdir(profile, { recursive: true })

  // Extensions require a persistent context and a full (non-headless-shell)
  // browser. The viewport is pinned so the right-click coordinates below land
  // somewhere predictable.
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    timezoneId: 'UTC',
    viewport: { width: 1440, height: 900 },
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--window-size=1460,1000',
    ],
  })

  const cspViolations = []
  const consoleErrors = []
  const hits = { bing: 0, unsplashApi: 0, unsplashImg: 0 }

  context.on('request', (req) => {
    const u = req.url()
    if (u.includes('bing.com')) hits.bing += 1
    else if (u.includes('api.unsplash.com')) hits.unsplashApi += 1
    else if (u.includes('images.unsplash.com')) hits.unsplashImg += 1
  })

  /** Wait until a real photo has faded in on top of the bundled fallback. */
  const waitForPhoto = (page, timeout = 40_000) =>
    page.waitForSelector('.bg__layer--top.is-visible', { timeout })

  /** Everything we care about, read straight out of the live page. */
  const readState = (page) =>
    page.evaluate(async () => {
      const bag = await chrome.storage.local.get(null)
      const names = await caches.keys()
      const entries = names.length
        ? (await (await caches.open(names[0])).keys()).map((r) => r.url)
        : []
      const top = document.querySelector('.bg__layer--top')
      const base = document.querySelector('.bg__layer')
      const credit = document.querySelector('.credit')
      return {
        settings: bag.settings ?? null,
        pools: Object.fromEntries(
          Object.entries(bag)
            .filter(([k]) => k.startsWith('pool:'))
            .map(([k, v]) => [k, v?.photos?.length ?? 0]),
        ),
        indexes: Object.fromEntries(Object.entries(bag).filter(([k]) => k.startsWith('index:'))),
        pinged: (bag.pingedPhotoIds ?? []).length,
        cacheEntries: entries.length,
        photoVisible: top?.classList.contains('is-visible') ?? false,
        photoSrc: top?.getAttribute('src') ?? null,
        layerFilter: base ? getComputedStyle(base).filter : null,
        layerWidth: base ? Math.round(base.getBoundingClientRect().width) : 0,
        viewportWidth: window.innerWidth,
        creditText: credit?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      }
    })

  /** Right-click somewhere empty and return the menu's item labels. */
  const openMenu = async (page) => {
    await page.mouse.click(240, 180, { button: 'right' })
    await page.waitForSelector('.menu[data-placed="yes"]', { timeout: 6000 })
    return page.$$eval('.menu__item .menu__text', (els) => els.map((e) => e.textContent.trim()))
  }

  const clickMenuItem = async (page, label) => {
    await page.locator('.menu__item', { hasText: label }).first().click()
    await page.waitForSelector('.menu', { state: 'detached', timeout: 5000 }).catch(() => {})
  }

  try {
    const page = context.pages()[0] ?? (await context.newPage())
    page.on('console', (m) => {
      const t = m.text()
      if (/content security policy|refused to (load|execute)/i.test(t)) cspViolations.push(t)
      else if (m.type() === 'error') consoleErrors.push(t)
    })
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

    // Our override means chrome://newtab resolves to the extension page, which
    // also tells us the generated extension id.
    await page.goto('chrome://newtab/', { waitUntil: 'load', timeout: 30_000 })
    const extUrl = page.url()
    console.log(`EXTENSION\n  resolved new tab -> ${extUrl}`)

    if (!extUrl.startsWith('chrome-extension://')) {
      fail(`chrome://newtab did not resolve to the extension (got ${extUrl})`)
      return
    }
    pass('chrome_url_overrides.newtab is active')

    await page.waitForSelector('[data-testid="clock"]', { timeout: 15_000 })
    const shot = await page.evaluate(MEASURE)
    pass(`clock rendered: ${shot.text}  ${shot.date}`)

    /* ── default source: Unsplash ──────────────────────────────────────────── */
    try {
      await waitForPhoto(page)
      pass('a real photo faded in over the bundled fallback')
    } catch {
      fail('no photo appeared within 40s — the wallpaper pipeline did not complete')
    }

    let state = await readState(page)

    // On a first run nothing has been written to `settings` yet — useSettings
    // only persists once the user expresses a preference, so storage stays
    // clean. The effective default is therefore proven by WHICH pool got
    // created, not by reading a key that is legitimately absent.
    const unsplashPool = state.pools['pool:unsplash'] ?? 0
    const bingPoolOnFirstRun = state.pools['pool:bing'] ?? 0
    const storedSource = state.settings?.source ?? null

    if (storedSource === null && unsplashPool > 0 && bingPoolOnFirstRun === 0) {
      pass('default source is Unsplash (no preference stored, Unsplash pool built)')
    } else if (storedSource === 'unsplash') {
      pass('source is Unsplash (explicitly stored)')
    } else {
      fail(
        `expected Unsplash to be the effective default ` +
          `(stored=${storedSource} unsplashPool=${unsplashPool} bingPool=${bingPoolOnFirstRun})`,
      )
    }

    if (unsplashPool > 1) pass(`Unsplash pool holds ${unsplashPool} photos (enables prev/next)`)
    else fail(`Unsplash pool holds only ${unsplashPool} photo(s)`)

    if (hits.unsplashApi > 0) pass(`api.unsplash.com called ${hits.unsplashApi}x on first run`)
    else fail('api.unsplash.com was never called')

    /* ── attribution (Unsplash API Terms) ──────────────────────────────────── */
    if (state.creditText && /Unsplash/.test(state.creditText)) {
      pass(`attribution rendered: "${state.creditText}"`)
    } else {
      fail(`attribution missing — required by Unsplash API Terms (got ${state.creditText})`)
    }

    // The ping is fire-and-forget and races the photo's fade-in, so poll for it
    // rather than sampling once. This is a hard requirement of the Unsplash API
    // Guidelines, not a nicety, so it is a failure rather than a note.
    try {
      await page.waitForFunction(
        async () => {
          const bag = await chrome.storage.local.get('pingedPhotoIds')
          return (bag.pingedPhotoIds ?? []).length > 0
        },
        null,
        { timeout: 15_000 },
      )
      const pinged = await page.evaluate(async () => {
        const bag = await chrome.storage.local.get('pingedPhotoIds')
        return (bag.pingedPhotoIds ?? []).length
      })
      pass(`download_location pinged for ${pinged} photo(s) — Unsplash requirement met`)
    } catch {
      fail('download_location was never pinged — required by the Unsplash API Guidelines')
    }

    /* ── live search suggestions ───────────────────────────────────────────── */
    // Only testable here: all three suggestion endpoints send no CORS headers,
    // so they work solely from an extension page holding host_permissions.
    let suggestHits = 0
    const countSuggest = (req) => {
      const u = req.url()
      if (u.includes('suggestqueries.google.com') || u.includes('/complete/search')) {
        suggestHits += 1
      }
    }
    context.on('request', countSuggest)

    await page.locator('.search__input').fill('chrome ext')
    try {
      await page.waitForSelector('.search__row:not(.search__row--ai)', { timeout: 12_000 })
    } catch {
      /* asserted below */
    }

    const suggest = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.search__row:not(.search__row--ai)'))
      return {
        count: rows.length,
        first: rows[0]?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
        // The completion is wrapped in <b>; the typed prefix is not.
        bolded: rows[0]?.querySelector('b')?.textContent ?? null,
        aiRowStillLast: Boolean(document.querySelector('.search__row--ai')),
      }
    })
    context.off('request', countSuggest)

    if (suggest.count > 0) {
      pass(`live suggestions: ${suggest.count} rows, first = "${suggest.first}"`)
    } else {
      fail('no search suggestions appeared — endpoint blocked or host_permissions wrong')
    }

    if (suggestHits > 0) pass(`suggestion endpoint called ${suggestHits}x while typing`)
    else fail('no request reached the suggestion endpoint')

    if (suggest.bolded) {
      pass(`completion is emphasised, typed prefix is not (bold part: "${suggest.bolded}")`)
    } else {
      notes.push('suggestion rows rendered without a bolded completion')
    }

    if (suggest.aiRowStillLast) pass('AI-mode row sits below the suggestions')
    else fail('AI-mode row vanished once suggestions arrived')

    // The dropdown must fit on screen. An earlier revision rendered 8
    // suggestions and the list was clipped by the fold — invisible in a code
    // review, obvious in a screenshot, and now caught here.
    const dropFit = await page.evaluate(() => {
      const drop = document.querySelector('.search__drop')
      if (!drop) return null
      const r = drop.getBoundingClientRect()
      return {
        rows: drop.querySelectorAll('.search__row').length,
        bottom: Math.round(r.bottom),
        viewport: window.innerHeight,
        overshoot: Math.round(r.bottom - window.innerHeight),
        needsScroll: Math.round(drop.scrollHeight - drop.clientHeight),
        lifted: getComputedStyle(document.querySelector('.stage')).transform,
      }
    })

    if (!dropFit) {
      fail('suggestion dropdown not found when measuring fit')
    } else if (dropFit.overshoot > 0) {
      fail(
        `suggestion dropdown is clipped by ${dropFit.overshoot}px ` +
          `(${dropFit.rows} rows, bottom ${dropFit.bottom} vs viewport ${dropFit.viewport})`,
      )
    } else {
      pass(
        `dropdown fits on screen: ${dropFit.rows} rows, bottom ${dropFit.bottom} of ` +
          `${dropFit.viewport}px, no internal scroll needed (${dropFit.needsScroll}px)`,
      )
    }

    if (dropFit && dropFit.lifted !== 'none') {
      pass(`column lifts to make room on focus (transform ${dropFit.lifted})`)
    } else {
      notes.push('stage did not lift on focus — dropdown relies on fitting unaided')
    }

    await page.screenshot({ path: join(OUT, 'extension-suggest.png') })
    await page.locator('.search__input').fill('')
    await page.keyboard.press('Escape')

    /* ── blur ──────────────────────────────────────────────────────────────── */
    if (state.layerFilter === 'blur(8px)') pass('default blur is 8px and applied to the layer')
    else fail(`expected filter blur(8px), got "${state.layerFilter}"`)

    if (state.layerWidth > state.viewportWidth) {
      pass(
        `blur overscan active: layer is ${state.layerWidth}px vs ${state.viewportWidth}px ` +
          'viewport, so the feathered edge stays off-screen',
      )
    } else {
      fail(`layer (${state.layerWidth}px) is not wider than the viewport — blur edges will show`)
    }

    /* ── context menu ──────────────────────────────────────────────────────── */
    const labels = await openMenu(page)
    const expected = ['上一张', '下一张', 'Unsplash', 'Bing 每日']
    const missing = expected.filter((l) => !labels.includes(l))
    if (missing.length === 0) pass(`context menu opened with: ${labels.join(' / ')}`)
    else fail(`context menu missing items: ${missing.join(', ')}`)

    const sliderCount = await page.locator('.menu__slider').count()
    if (sliderCount === 1) pass('blur slider present in the menu')
    else fail(`expected 1 blur slider, found ${sliderCount}`)

    /* ── next / prev ───────────────────────────────────────────────────────── */
    const indexBefore = state.indexes['index:unsplash'] ?? 0
    const srcBefore = state.photoSrc

    await clickMenuItem(page, '下一张')
    await page.waitForFunction(
      (prev) => {
        const el = document.querySelector('.bg__layer--top')
        return Boolean(el) && el.getAttribute('src') !== prev
      },
      srcBefore,
      { timeout: 40_000 },
    )
    state = await readState(page)
    const indexAfterNext = state.indexes['index:unsplash'] ?? 0
    if (indexAfterNext === indexBefore + 1) {
      pass(`"下一张" advanced index ${indexBefore} -> ${indexAfterNext} and swapped the photo`)
    } else {
      fail(`"下一张" left index at ${indexAfterNext} (expected ${indexBefore + 1})`)
    }
    if (state.creditText && state.creditText !== null) {
      pass(`attribution followed the new photo: "${state.creditText}"`)
    }

    await openMenu(page)
    await clickMenuItem(page, '上一张')
    await page.waitForTimeout(2500)
    state = await readState(page)
    if ((state.indexes['index:unsplash'] ?? -1) === indexBefore) {
      pass(`"上一张" returned to index ${indexBefore}`)
    } else {
      fail(`"上一张" landed on index ${state.indexes['index:unsplash']} (expected ${indexBefore})`)
    }

    /* ── blur slider ───────────────────────────────────────────────────────── */
    await openMenu(page)
    await page.locator('.menu__slider').fill('26')
    await page.waitForTimeout(400)
    state = await readState(page)
    if (state.layerFilter === 'blur(26px)' && state.settings?.blur === 26) {
      pass('blur slider -> filter blur(26px), persisted to storage')
    } else {
      fail(`slider set 26 but filter is "${state.layerFilter}" / stored ${state.settings?.blur}`)
    }

    // Put it back so the screenshot reflects the shipped default.
    await page.locator('.menu__slider').fill('8')
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')

    /* ── source switch -> Bing ─────────────────────────────────────────────── */
    hits.bing = 0
    await openMenu(page)
    await clickMenuItem(page, 'Bing 每日')
    await page.waitForTimeout(9000)
    state = await readState(page)

    if (state.settings?.source === 'bing') pass('switched source to Bing')
    else fail(`source should be bing, got "${state.settings?.source}"`)

    const bingPool = state.pools['pool:bing'] ?? 0
    if (bingPool > 1) pass(`Bing pool holds ${bingPool} photos (8 past days)`)
    else fail(`Bing pool holds only ${bingPool} photo(s)`)

    if (hits.bing > 0) pass(`bing.com called ${hits.bing}x after the switch`)
    else fail('bing.com was never called after switching source')

    if (state.creditText === null) {
      pass('attribution hidden for Bing (not required, keeps the page clean)')
    } else {
      fail(`attribution should be hidden for Bing, got "${state.creditText}"`)
    }

    /* ── switch back, then confirm a fresh tab hits no network ─────────────── */
    await openMenu(page)
    await clickMenuItem(page, 'Unsplash')
    await page.waitForTimeout(6000)

    hits.unsplashApi = 0
    hits.unsplashImg = 0
    hits.bing = 0
    const second = await context.newPage()
    await second.goto(extUrl, { waitUntil: 'load' })
    await second.waitForSelector('[data-testid="clock"]')
    await second.waitForTimeout(5000)
    const netTotal = hits.unsplashApi + hits.unsplashImg + hits.bing
    if (netTotal === 0) {
      pass('a second tab made 0 network requests — pool + byte cache both hit')
    } else {
      fail(
        `second tab made ${netTotal} requests ` +
          `(api=${hits.unsplashApi} img=${hits.unsplashImg} bing=${hits.bing})`,
      )
    }

    state = await readState(second)
    if (state.cacheEntries > 0 && state.cacheEntries <= 12) {
      pass(`Cache Storage holds ${state.cacheEntries} image(s), within the 12 cap`)
    } else {
      fail(`Cache Storage holds ${state.cacheEntries} entries — prune cap is 12`)
    }

    /* ── offline ───────────────────────────────────────────────────────────── */
    await context.setOffline(true)
    const third = await context.newPage()
    await third.goto(extUrl, { waitUntil: 'load' })
    await third.waitForSelector('[data-testid="clock"]')
    await third.waitForTimeout(3000)
    const offline = await readState(third)
    if (offline.photoVisible) pass('offline: cached photo still displayed')
    else notes.push('offline: fell back to the bundled wallpaper (acceptable, not ideal)')
    await context.setOffline(false)

    /* ── hygiene ───────────────────────────────────────────────────────────── */
    if (cspViolations.length) fail(`CSP violation: ${cspViolations[0]}`)
    else pass('zero CSP violations')

    if (consoleErrors.length) notes.push(`console errors: ${consoleErrors.slice(0, 3).join(' | ')}`)
    else pass('no console errors')

    await page.bringToFront()
    await page.waitForTimeout(600)
    await page.screenshot({ path: join(OUT, 'extension.png') })
    await openMenu(page)
    await page.screenshot({ path: join(OUT, 'extension-menu.png') })
    await page.keyboard.press('Escape')

    await writeFile(
      join(OUT, 'extension-report.json'),
      JSON.stringify(
        { mode: 'extension', extUrl, state, hits, cspViolations, consoleErrors, failures, notes },
        null,
        2,
      ),
      'utf8',
    )
  } finally {
    await context.close()
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */

console.log(`\nquiet-tab verification — ${MODE} mode\n${'='.repeat(46)}\n`)

try {
  if (MODE === 'extension') await runExtension()
  else await runStatic()
} catch (err) {
  console.error(`\nABORTED: ${err instanceof Error ? err.message : err}`)
  process.exit(2)
}

console.log(`\n${'='.repeat(46)}`)
if (notes.length) {
  console.log('\nNOTES (not failures):')
  for (const n of notes) console.log(`  - ${n}`)
}
if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S):`)
  for (const f of failures) console.log(`  - ${f}`)
  console.log('\nreport: .verify/')
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
console.log('report: .verify/')
