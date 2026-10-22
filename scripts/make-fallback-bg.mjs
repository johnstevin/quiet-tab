// Generates public/images/fallback-bg.png — the wallpaper shown before (or
// instead of) today's Bing photo.
//
// WHY GENERATED RATHER THAN A REAL PHOTOGRAPH
//
// This layer's entire job is to occupy the ~200ms between first paint and the
// cached/live Bing photo fading in, plus to look decent fully offline. Shipping
// a 700KB JPEG to cover 200ms is poor economics. A procedurally generated
// low-frequency image costs a couple of kilobytes and, once CSS scales it to
// full screen, is indistinguishable from an out-of-focus photograph — the same
// trick as a blurhash/LQIP placeholder.
//
// It also sidesteps third-party licensing entirely: nothing here is derived
// from anyone else's work, so there is no attribution or redistribution
// condition to honour.
//
// Rendered at 512x320 and Gaussian-blurred AT GENERATION TIME, then upscaled
// 3.75x by CSS. Pre-blurring matters: an earlier revision rendered 128x80 and
// let the browser's bilinear filter do the smoothing, which produced visible
// blocky facets along the ridge edges at 8.4x magnification. Blurring in the
// generator also beats a runtime `filter: blur()` — that would cost GPU work on
// every first paint, for a layer that never changes.
//
// Run with: npm run assets

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { blurRgb, clamp01, encodePng, mixRgb, smoothstep } from './lib/png.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'public', 'images')

const W = 512
const H = 320

/** Supersampling per axis, for clean ridge silhouettes before the blur. */
const SS = 2

/** Blur radius in source pixels; 3 box passes approximate a Gaussian. */
const BLUR_RADIUS = 6
const BLUR_PASSES = 3

/* ── palette ──────────────────────────────────────────────────────────────── */

const SKY_TOP = [0x1b, 0x24, 0x31] // deep pre-dawn slate
const SKY_HORIZON = [0xa6, 0xb4, 0xbc] // pale haze at the skyline
const MIST = [0xc6, 0xd0, 0xd6] // fog pooling in the valleys
const DAWN = [0xd8, 0xc0, 0xa6] // faint warm light, low and left

/**
 * Ridge layers, ordered far to near.
 * - `y`     baseline height as a fraction of the canvas
 * - `amp`   silhouette amplitude
 * - `waves` [frequency, phase] pairs; summed with 1/f weighting so low
 *           frequencies dominate and the outline reads as terrain rather than
 *           as a sine wave
 * - `col`   base rock colour (nearer = darker, standard aerial perspective)
 * - `mist`  how strongly fog accumulates against this ridge's crest
 */
const RIDGES = [
  {
    y: 0.5,
    amp: 0.05,
    waves: [
      [1.1, 0.3],
      [2.3, 1.9],
      [3.7, 4.2],
    ],
    col: [0x7f, 0x91, 0x9f],
    mist: 0.72,
  },
  {
    y: 0.6,
    amp: 0.062,
    waves: [
      [0.9, 2.1],
      [2.1, 0.4],
      [4.3, 3.1],
    ],
    col: [0x5d, 0x6e, 0x7e],
    mist: 0.58,
  },
  {
    y: 0.7,
    amp: 0.062,
    waves: [
      [1.3, 1.2],
      [2.7, 2.8],
      [3.1, 0.6],
    ],
    col: [0x3a, 0x47, 0x56],
    mist: 0.32,
  },
  {
    y: 0.81,
    amp: 0.058,
    waves: [
      [1.0, 3.4],
      [1.9, 1.1],
      [3.3, 2.2],
    ],
    col: [0x22, 0x2a, 0x35],
    mist: 0.16,
  },
  {
    y: 0.93,
    amp: 0.05,
    waves: [
      [1.2, 0.8],
      [2.5, 3.6],
      [4.1, 1.5],
    ],
    col: [0x11, 0x15, 0x1c],
    mist: 0.07,
  },
]

/** Height of a ridge's crest at horizontal position u, as a fraction of H. */
function ridgeTop(ridge, u) {
  let sum = 0
  let weight = 0
  for (const [freq, phase] of ridge.waves) {
    const w = 1 / freq
    sum += Math.sin(u * Math.PI * 2 * freq + phase) * w
    weight += w
  }
  return ridge.y - (sum / weight) * ridge.amp
}

/** Colour of a single point, before blurring. Returns [r,g,b] in 0..255. */
function shade(u, v) {
  // Sky: non-linear ramp so the pale band hugs the horizon instead of washing
  // out the whole upper half.
  let col = mixRgb(SKY_TOP, SKY_HORIZON, Math.pow(smoothstep(0, 1, v / 0.55), 0.85))

  // Dawn glow, low and left. Squared falloff keeps it from looking like a
  // flashlight.
  const glow = Math.pow(Math.max(0, 1 - Math.hypot((u - 0.32) * 1.5, (v - 0.46) * 2.6)), 2)
  col = mixRgb(col, DAWN, glow * 0.26)

  // Painter's algorithm, far to near: the last ridge containing this point
  // wins, which is automatically the nearest one.
  for (const ridge of RIDGES) {
    const top = ridgeTop(ridge, u)
    if (v < top) continue

    // Fog is densest right at the crest and thins going down into the rock.
    // A tight band (0.10 of the canvas) keeps the ridges reading as solid
    // terrain; widen it and everything dissolves into uniform grey.
    const depth = (v - top) / 0.1
    const fog = ridge.mist * (1 - smoothstep(0, 1, depth))
    col = mixRgb(ridge.col, MIST, fog)
  }

  return col
}

function render() {
  const rgb = new Float32Array(W * H * 3)

  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let r = 0
      let g = 0
      let b = 0

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const u = (x + (sx + 0.5) / SS) / W
          const v = (y + (sy + 0.5) / SS) / H
          const c = shade(u, v)
          r += c[0]
          g += c[1]
          b += c[2]
        }
      }

      const n = SS * SS
      const o = (y * W + x) * 3
      rgb[o] = r / n
      rgb[o + 1] = g / n
      rgb[o + 2] = b / n
    }
  }

  const soft = blurRgb(rgb, W, H, BLUR_RADIUS, BLUR_PASSES)

  const out = Buffer.alloc(W * H * 4)
  for (let i = 0; i < W * H; i += 1) {
    out[i * 4] = Math.round(clamp01(soft[i * 3] / 255) * 255)
    out[i * 4 + 1] = Math.round(clamp01(soft[i * 3 + 1] / 255) * 255)
    out[i * 4 + 2] = Math.round(clamp01(soft[i * 3 + 2] / 255) * 255)
    out[i * 4 + 3] = 255
  }

  return encodePng(W, H, out)
}

await mkdir(OUT_DIR, { recursive: true })

const png = render()
await writeFile(join(OUT_DIR, 'fallback-bg.png'), png)
console.log(`[fallback-bg] ${W}x${H} -> public/images/fallback-bg.png  ${png.length} bytes`)

await writeFile(
  join(OUT_DIR, 'ATTRIBUTION.txt'),
  [
    'fallback-bg.png',
    '================',
    '',
    'Procedurally generated by scripts/make-fallback-bg.mjs.',
    'Not derived from any photograph or third-party asset.',
    'No attribution required; no redistribution conditions apply.',
    '',
    'Regenerate with:  npm run assets',
    '',
    'NOTE ON THE LIVE WALLPAPER',
    '--------------------------',
    "Bing's daily photos are fetched at runtime and cached locally on the",
    "user's own machine. They are deliberately NOT bundled into this package:",
    "Bing's terms permit use as desktop wallpaper only, which does not cover",
    'redistributing the image inside a software package.',
  ].join('\n'),
  'utf8',
)
console.log('[fallback-bg] ATTRIBUTION.txt written')
