// Generates public/icons/{16,48,128}.png.
//
// Shapes are defined as signed distance fields and sampled on a 4x4 grid per
// pixel (16 samples), which gives clean antialiasing with no raster library.
// PNG encoding lives in ./lib/png.mjs — see the rationale there for why we do
// not depend on sharp/canvas.
//
// Run with: npm run assets

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePng, mix } from './lib/png.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'public', 'icons')
const SIZES = [16, 48, 128]

/** Supersampling factor per axis. */
const SS = 4

/* ── signed distance fields ───────────────────────────────────────────────── */

/** Distance to the segment ab, minus radius r — i.e. a capsule. */
function sdCapsule(px, py, ax, ay, bx, by, r) {
  const pax = px - ax
  const pay = py - ay
  const bax = bx - ax
  const bay = by - ay
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)))
  return Math.hypot(pax - bax * h, pay - bay * h) - r
}

function sdRoundedRect(px, py, halfW, halfH, r) {
  const qx = Math.abs(px) - (halfW - r)
  const qy = Math.abs(py) - (halfH - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

/** Hollow circle: |distance to circumference| - halfThickness. */
function sdRing(px, py, radius, thickness) {
  return Math.abs(Math.hypot(px, py) - radius) - thickness / 2
}

/* ── drawing ──────────────────────────────────────────────────────────────── */

/**
 * Paint one icon.
 *
 * Design: a dark rounded plate, a thin white ring, and hands parked at 10:10 —
 * the canonical "this is a clock" pose and the only one that still reads at
 * 16x16. Stroke widths are proportional to the icon but floored in absolute
 * pixels, because at 16px a 5.8% stroke is 0.93px and antialiases into a grey
 * smudge.
 *
 * @param {number} size
 * @returns {Buffer} PNG bytes
 */
function drawIcon(size) {
  const out = Buffer.alloc(size * size * 4)
  const c = size / 2

  const plateHalf = size * 0.5
  const plateRadius = size * 0.225
  const ringRadius = size * 0.315
  const ringThickness = Math.max(size * 0.058, 1.15)

  // 10:10. Hours at 10 -> 300 degrees clockwise from 12; minutes at 10 -> 60.
  // Screen y grows downwards, hence the negated cosine.
  const dir = (deg) => {
    const rad = (deg * Math.PI) / 180
    return [Math.sin(rad), -Math.cos(rad)]
  }
  const [hx, hy] = dir(300)
  const [mx, my] = dir(60)
  const hourLen = size * 0.17
  const minLen = size * 0.235
  const handR = Math.max(size * 0.028, 0.62)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let plateHits = 0
      let inkHits = 0

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x + (sx + 0.5) / SS - c
          const py = y + (sy + 0.5) / SS - c

          if (sdRoundedRect(px, py, plateHalf, plateHalf, plateRadius) < 0) plateHits += 1

          const ink = Math.min(
            sdRing(px, py, ringRadius, ringThickness),
            sdCapsule(px, py, 0, 0, hx * hourLen, hy * hourLen, handR),
            sdCapsule(px, py, 0, 0, mx * minLen, my * minLen, handR),
          )
          if (ink < 0) inkHits += 1
        }
      }

      const samples = SS * SS
      const plateA = plateHits / samples
      const inkA = inkHits / samples

      // Vertical gradient matching the page's own background colour.
      const t = y / Math.max(1, size - 1)
      const baseR = mix(0x25, 0x12, t)
      const baseG = mix(0x2a, 0x15, t)
      const baseB = mix(0x31, 0x1a, t)

      // White ink over the plate, plate over transparency. Ink is masked by the
      // plate so the hands can never spill outside the rounded corners.
      const o = (y * size + x) * 4
      out[o] = Math.round(mix(baseR, 0xff, inkA))
      out[o + 1] = Math.round(mix(baseG, 0xff, inkA))
      out[o + 2] = Math.round(mix(baseB, 0xff, inkA))
      out[o + 3] = Math.round(Math.max(plateA, inkA * plateA) * 255)
    }
  }

  return encodePng(size, size, out)
}

/* ── main ─────────────────────────────────────────────────────────────────── */

await mkdir(OUT_DIR, { recursive: true })
for (const size of SIZES) {
  const png = drawIcon(size)
  await writeFile(join(OUT_DIR, `${size}.png`), png)
  console.log(`[icons] ${size}.png  ${png.length} bytes`)
}
