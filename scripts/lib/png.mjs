// Minimal PNG writer. Shared by make-icons.mjs and make-fallback-bg.mjs.
//
// A PNG is just: 8-byte signature, IHDR, zlib-deflated scanlines in IDAT, IEND.
// node:zlib does the compression, so there is no reason to pull in a native
// image library (sharp/canvas are tens of megabytes of platform binaries) for a
// project whose entire shipped payload is a clock.

import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([len, typeAndData, crc])
}

/**
 * Encode 8-bit RGBA pixels as a PNG.
 *
 * @param {number} w
 * @param {number} h
 * @param {Buffer} rgba length must be w * h * 4
 * @returns {Buffer}
 */
export function encodePng(w, h, rgba) {
  if (rgba.length !== w * h * 4) {
    throw new Error(`encodePng: expected ${w * h * 4} bytes, got ${rgba.length}`)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type 6 = truecolour + alpha
  ihdr[10] = 0 // compression: deflate
  ihdr[11] = 0 // filter method: adaptive
  ihdr[12] = 0 // interlace: none

  // Filter byte 0 (None) per scanline. These images are tiny, so the ratio we
  // give up by not using Paeth is irrelevant next to the clarity.
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Linear interpolation. */
export function mix(a, b, t) {
  return a + (b - a) * t
}

/** Per-channel lerp between two [r,g,b] triples. */
export function mixRgb(a, b, t) {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]
}

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Smooth Hermite ramp, the classic GLSL smoothstep. */
export function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/**
 * Separable box blur over a planar Float32 RGB buffer, in place-ish.
 *
 * Three passes of a box blur is the standard cheap approximation of a Gaussian
 * (central limit theorem): visually indistinguishable here, and O(n) per pass
 * instead of O(n*r) thanks to the running-sum sliding window.
 *
 * @param {Float32Array} src length w*h*3
 * @param {number} w
 * @param {number} h
 * @param {number} radius
 * @param {number} passes
 * @returns {Float32Array}
 */
export function blurRgb(src, w, h, radius, passes = 3) {
  let buf = src
  let tmp = new Float32Array(buf.length)

  for (let p = 0; p < passes; p += 1) {
    // Horizontal
    for (let y = 0; y < h; y += 1) {
      for (let c = 0; c < 3; c += 1) {
        let sum = 0
        const row = y * w
        // Prime the window, clamping at the left edge.
        for (let i = -radius; i <= radius; i += 1) {
          sum += buf[(row + Math.min(w - 1, Math.max(0, i))) * 3 + c]
        }
        const span = radius * 2 + 1
        for (let x = 0; x < w; x += 1) {
          tmp[(row + x) * 3 + c] = sum / span
          const out = Math.min(w - 1, Math.max(0, x - radius))
          const inc = Math.min(w - 1, Math.max(0, x + radius + 1))
          sum += buf[(row + inc) * 3 + c] - buf[(row + out) * 3 + c]
        }
      }
    }
    ;[buf, tmp] = [tmp, buf]

    // Vertical
    for (let x = 0; x < w; x += 1) {
      for (let c = 0; c < 3; c += 1) {
        let sum = 0
        for (let i = -radius; i <= radius; i += 1) {
          sum += buf[(Math.min(h - 1, Math.max(0, i)) * w + x) * 3 + c]
        }
        const span = radius * 2 + 1
        for (let y = 0; y < h; y += 1) {
          tmp[(y * w + x) * 3 + c] = sum / span
          const out = Math.min(h - 1, Math.max(0, y - radius))
          const inc = Math.min(h - 1, Math.max(0, y + radius + 1))
          sum += buf[(inc * w + x) * 3 + c] - buf[(out * w + x) * 3 + c]
        }
      }
    }
    ;[buf, tmp] = [tmp, buf]
  }

  return buf
}
