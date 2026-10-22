// Subsets Noto Sans SC down to the ~21 glyphs the date line actually needs,
// producing public/fonts/noto-sans-sc-date.woff2.
//
// WHY BOTHER
//
// The date reads "10月22日星期四". Before this, the digits came from Inter and
// the CJK fell through to whatever the OS provides — Microsoft YaHei on
// Windows, PingFang SC on macOS. Two problems: the digit and CJK shapes came
// from unrelated typefaces, and the result looked different on every machine.
//
// Noto Sans SC covers both, but the full variable font is 17.7 MB — absurd for
// twenty-odd characters. harfbuzz's subsetter cuts it to a few kilobytes while
// KEEPING the wght axis live, so the weight stays adjustable in CSS without
// regenerating anything.
//
// The 17.7 MB source is cached in .fontcache/ (gitignored) and downloaded on
// demand; only the small subset is committed.
//
// Run with: npm run assets

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import subsetFont from 'subset-font'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_DIR = join(ROOT, '.fontcache')
const OUT_DIR = join(ROOT, 'public', 'fonts')

const SOURCE_URL =
  'https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf'
const LICENSE_URL = 'https://github.com/google/fonts/raw/main/ofl/notosanssc/OFL.txt'
const SOURCE_FILE = join(CACHE_DIR, 'NotoSansSC-wght.ttf')

/**
 * Every character the date line can ever render.
 *
 *   0-9              day and month numbers
 *   年月日            unit markers (年 included for a future "2026年" format)
 *   星期              the "day of week" prefix
 *   一二三四五六       weekday numerals (星期日 reuses 日 above)
 *
 * Keep this in sync with `snapshot()` in src/lib/time.ts — if the format gains
 * a character that is not listed here, it will silently fall back to a system
 * font and look wrong.
 */
const GLYPHS = '0123456789年月日星期一二三四五六'

/**
 * Keep the weight axis as a RANGE rather than pinning it to 500. Costs a
 * negligible amount for 21 glyphs and means the design can be re-tuned by
 * editing one CSS value instead of re-running this script.
 */
const WEIGHT_RANGE = { min: 300, max: 700 }

async function ensureSource() {
  if (existsSync(SOURCE_FILE)) {
    const { size } = await stat(SOURCE_FILE)
    if (size > 1_000_000) {
      console.log(`[date-font] using cached source (${(size / 1e6).toFixed(1)} MB)`)
      return
    }
  }

  await mkdir(CACHE_DIR, { recursive: true })
  console.log('[date-font] downloading Noto Sans SC variable (~18 MB, one time)...')

  const res = await fetch(SOURCE_URL)
  if (!res.ok) throw new Error(`source font download failed: HTTP ${res.status}`)
  await writeFile(SOURCE_FILE, Buffer.from(await res.arrayBuffer()))

  const { size } = await stat(SOURCE_FILE)
  if (size < 1_000_000) throw new Error(`downloaded font is only ${size} bytes — not a real TTF`)
  console.log(`[date-font] cached ${(size / 1e6).toFixed(1)} MB -> .fontcache/`)
}

async function ensureLicense() {
  const dest = join(OUT_DIR, 'NotoSansSC-OFL-LICENSE.txt')
  if (existsSync(dest)) return
  const res = await fetch(LICENSE_URL)
  if (!res.ok) {
    console.warn(`[date-font] could not fetch OFL text (HTTP ${res.status})`)
    return
  }
  // OFL-1.1 requires the licence and copyright notice to travel with any
  // redistributed copy — including a subset.
  await writeFile(dest, await res.text(), 'utf8')
  console.log('[date-font] NotoSansSC-OFL-LICENSE.txt -> public/fonts/')
}

await mkdir(OUT_DIR, { recursive: true })
await ensureSource()

const source = await readFile(SOURCE_FILE)
const subset = await subsetFont(source, GLYPHS, {
  targetFormat: 'woff2',
  variationAxes: { wght: WEIGHT_RANGE },
})

const dest = join(OUT_DIR, 'noto-sans-sc-date.woff2')
await writeFile(dest, subset)

const ratio = ((1 - subset.length / source.length) * 100).toFixed(3)
console.log(
  `[date-font] ${GLYPHS.length} glyphs, wght ${WEIGHT_RANGE.min}-${WEIGHT_RANGE.max} -> ` +
    `noto-sans-sc-date.woff2  ${subset.length} bytes  (-${ratio}% vs source)`,
)

await ensureLicense()
