import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const SIZE = 1024
const SS = 2 // supersampling factor
const W = SIZE * SS

const canvas = new Uint8Array(W * W * 4)

function blend(x, y, [r, g, b], alpha) {
  if (x < 0 || y < 0 || x >= W || y >= W || alpha <= 0) return
  const i = (y * W + x) * 4
  const a = Math.min(1, alpha)
  canvas[i] = Math.round(canvas[i] * (1 - a) + r * a)
  canvas[i + 1] = Math.round(canvas[i + 1] * (1 - a) + g * a)
  canvas[i + 2] = Math.round(canvas[i + 2] * (1 - a) + b * a)
  canvas[i + 3] = Math.max(canvas[i + 3], Math.round(255 * a))
}

function hex(value) {
  return [
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5, 7), 16),
  ]
}

const TOP = hex('#4a6fe8')
const MID = hex('#2248d1')
const BOTTOM = hex('#0035be')
const WHITE = hex('#ffffff')

/** Signed distance to a rounded rectangle, used for cheap anti-aliasing. */
function roundRectSdf(px, py, cx, cy, hw, hh, radius) {
  const qx = Math.abs(px - cx) - (hw - radius)
  const qy = Math.abs(py - cy) - (hh - radius)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  const inside = Math.min(Math.max(qx, qy), 0)
  return outside + inside - radius
}

function fillRoundRect(x0, y0, x1, y1, radius, colorAt) {
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const hw = (x1 - x0) / 2
  const hh = (y1 - y0) / 2
  for (let y = Math.floor(y0) - 2; y <= Math.ceil(y1) + 2; y += 1) {
    for (let x = Math.floor(x0) - 2; x <= Math.ceil(x1) + 2; x += 1) {
      const distance = roundRectSdf(x + 0.5, y + 0.5, cx, cy, hw, hh, radius)
      const alpha = Math.min(1, Math.max(0, 0.5 - distance))
      if (alpha > 0) blend(x, y, colorAt(x, y), alpha)
    }
  }
}

// Background: rounded square with a diagonal gradient.
fillRoundRect(0, 0, W, W, W * 0.22, (x, y) => {
  const t = (x / W) * 0.35 + (y / W) * 0.65
  if (t < 0.5) {
    const k = t / 0.5
    return [
      Math.round(TOP[0] + (MID[0] - TOP[0]) * k),
      Math.round(TOP[1] + (MID[1] - TOP[1]) * k),
      Math.round(TOP[2] + (MID[2] - TOP[2]) * k),
    ]
  }
  const k = (t - 0.5) / 0.5
  return [
    Math.round(MID[0] + (BOTTOM[0] - MID[0]) * k),
    Math.round(MID[1] + (BOTTOM[1] - MID[1]) * k),
    Math.round(MID[2] + (BOTTOM[2] - MID[2]) * k),
  ]
})

// Ledger card in the 24 unit design space, scaled to the canvas.
const u = W / 24
const px = (value) => value * u

// White card body.
fillRoundRect(px(5.4), px(3.6), px(18.6), px(20.4), px(1.6), () => WHITE)
// Spine bar carved out in the brand colour.
fillRoundRect(px(5.4), px(3.6), px(8.3), px(20.4), px(1.2), () => MID)
// Ruled lines.
fillRoundRect(px(10), px(8.1), px(16.2), px(9.3), px(0.6), () => MID)
fillRoundRect(px(10), px(11.4), px(16.2), px(12.6), px(0.6), () => MID)
fillRoundRect(px(10), px(14.7), px(13.6), px(15.9), px(0.6), () => MID)

// Downsample to the target size.
const out = Buffer.alloc(SIZE * (SIZE * 4 + 1))
let cursor = 0
for (let y = 0; y < SIZE; y += 1) {
  out[cursor] = 0
  cursor += 1
  for (let x = 0; x < SIZE; x += 1) {
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    for (let sy = 0; sy < SS; sy += 1) {
      for (let sx = 0; sx < SS; sx += 1) {
        const i = ((y * SS + sy) * W + (x * SS + sx)) * 4
        r += canvas[i]
        g += canvas[i + 1]
        b += canvas[i + 2]
        a += canvas[i + 3]
      }
    }
    const count = SS * SS
    out[cursor] = Math.round(r / count)
    out[cursor + 1] = Math.round(g / count)
    out[cursor + 2] = Math.round(b / count)
    out[cursor + 3] = Math.round(a / count)
    cursor += 4
  }
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([length, body, crc])
}

const crcTable = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[i]) & 0xff]
  }
  return crc ^ -1
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // colour type RGBA
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(out, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync('src-tauri/icons', { recursive: true })
writeFileSync('src-tauri/icons/source.png', png)
console.log(`wrote src-tauri/icons/source.png (${png.length} bytes)`)
