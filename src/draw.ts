import type { Capture } from './lib/acquire'
import { formatSI, snapUp } from './lib/format'
import type { Settings } from './lib/settings'

export interface Colors {
  bg: string
  grid: string
  gridStrong: string
  fg: string
  ch: [string, string]
  accent: string
}

export function readColors(el: Element): Colors {
  const cs = getComputedStyle(el)
  const v = (n: string) => cs.getPropertyValue(n).trim()
  return { bg: v('--chart-bg'), grid: v('--grid'), gridStrong: v('--grid-strong'), fg: v('--chart-fg'), ch: [v('--ch1'), v('--ch2')], accent: v('--accent') }
}

export const DIVS_X = 10
export const DIVS_Y = 8

/** Resizes the canvas backing store to its CSS size and returns a context scaled to CSS pixels. */
export function prepare(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (w === 0 || h === 0) return null
  const bw = Math.round(w * dpr)
  const bh = Math.round(h * dpr)
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw
    canvas.height = bh
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, w, h }
}

function graticule(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, nx: number, ny: number, c: Colors) {
  ctx.lineWidth = 1
  ctx.strokeStyle = c.grid
  ctx.beginPath()
  for (let i = 0; i <= nx; i++) {
    const x = Math.round(x0 + (i * w) / nx) + 0.5
    ctx.moveTo(x, y0)
    ctx.lineTo(x, y0 + h)
  }
  for (let j = 0; j <= ny; j++) {
    const y = Math.round(y0 + (j * h) / ny) + 0.5
    ctx.moveTo(x0, y)
    ctx.lineTo(x0 + w, y)
  }
  ctx.stroke()
  // centre axes with minor ticks
  ctx.strokeStyle = c.gridStrong
  ctx.beginPath()
  const cx = Math.round(x0 + w / 2) + 0.5
  const cy = Math.round(y0 + h / 2) + 0.5
  ctx.moveTo(cx, y0)
  ctx.lineTo(cx, y0 + h)
  ctx.moveTo(x0, cy)
  ctx.lineTo(x0 + w, cy)
  for (let i = 0; i <= nx * 5; i++) {
    const x = Math.round(x0 + (i * w) / (nx * 5)) + 0.5
    ctx.moveTo(x, cy - 3)
    ctx.lineTo(x, cy + 3)
  }
  for (let j = 0; j <= ny * 5; j++) {
    const y = Math.round(y0 + (j * h) / (ny * 5)) + 0.5
    ctx.moveTo(cx - 3, y)
    ctx.lineTo(cx + 3, y)
  }
  ctx.stroke()
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1)
}

export interface ScopeDraw {
  capture: Capture | null
  s: Settings
  colors: Colors
  /** Cursor times relative to the trigger, seconds. */
  cursors: number[]
  hover: { x: number; y: number } | null
}

export function drawScope(ctx: CanvasRenderingContext2D, w: number, h: number, d: ScopeDraw): void {
  const { s, colors: c, capture } = d
  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, w, h)
  graticule(ctx, 0, 0, w, h, DIVS_X, DIVS_Y, c)
  const winSec = s.tdiv * DIVS_X
  const divH = h / DIVS_Y
  const yOf = (v: number, ch: 0 | 1) => {
    const cs = s.ch[ch]
    return h / 2 - ((cs.invert ? -v : v) / cs.vdiv + cs.pos) * divH
  }

  if (capture) {
    const sr = capture.sampleRate
    const n = capture.data[0].length
    const xOfT = (t: number) => (s.trigPos + t / winSec) * w
    for (const ch of [0, 1] as const) {
      if (!s.ch[ch].enabled) continue
      const data = capture.data[ch]
      ctx.strokeStyle = c.ch[ch]
      ctx.fillStyle = c.ch[ch]
      ctx.lineWidth = 1.6
      ctx.lineJoin = 'round'
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, w, h)
      ctx.clip()
      const pxPerSample = w / n
      ctx.beginPath()
      if (pxPerSample < 1) {
        // decimate: min/max per pixel column
        const t0 = capture.t0
        let kPrev = -1
        for (let px = 0; px < w; px++) {
          const k0 = Math.max(0, Math.floor(((px / w - s.trigPos) * winSec - t0) * sr))
          const k1 = Math.min(n, Math.floor((((px + 1) / w - s.trigPos) * winSec - t0) * sr) + 1)
          if (k1 <= k0 || k0 === kPrev) continue
          kPrev = k0
          let lo = Infinity
          let hi = -Infinity
          for (let k = k0; k < k1; k++) {
            const v = data[k]
            if (v < lo) lo = v
            if (v > hi) hi = v
          }
          const ya = yOf(lo, ch)
          const yb = yOf(hi, ch)
          ctx.moveTo(px + 0.5, ya)
          ctx.lineTo(px + 0.5, yb)
        }
        ctx.stroke()
      } else {
        for (let k = 0; k < n; k++) {
          const x = xOfT(capture.t0 + k / sr)
          const y = yOf(data[k], ch)
          if (k === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
        if (pxPerSample > 9) {
          for (let k = 0; k < n; k++) {
            ctx.beginPath()
            ctx.arc(xOfT(capture.t0 + k / sr), yOf(data[k], ch), 2.5, 0, 2 * Math.PI)
            ctx.fill()
          }
        }
      }
      ctx.restore()
    }
  }

  // zero-level markers (left) per channel
  for (const ch of [0, 1] as const) {
    if (!s.ch[ch].enabled) continue
    const y = h / 2 - s.ch[ch].pos * divH
    ctx.fillStyle = c.ch[ch]
    ctx.beginPath()
    ctx.moveTo(0, y - 6)
    ctx.lineTo(10, y)
    ctx.lineTo(0, y + 6)
    ctx.closePath()
    ctx.fill()
    ctx.font = '10px system-ui, sans-serif'
    ctx.fillStyle = c.bg
    ctx.fillText(String(ch + 1), 1, y + 3.5)
  }
  // trigger position (top) and level (right)
  const tx = s.trigPos * w
  ctx.fillStyle = c.accent
  ctx.beginPath()
  ctx.moveTo(tx - 6, 0)
  ctx.lineTo(tx + 6, 0)
  ctx.lineTo(tx, 8)
  ctx.closePath()
  ctx.fill()
  const ty = yOf(s.trigLevel, s.trigSource)
  ctx.beginPath()
  ctx.moveTo(w, ty - 6)
  ctx.lineTo(w - 10, ty)
  ctx.lineTo(w, ty + 6)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = c.accent
  ctx.globalAlpha = 0.35
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(0, Math.round(ty) + 0.5)
  ctx.lineTo(w, Math.round(ty) + 0.5)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.globalAlpha = 1

  // cursors and hover crosshair
  ctx.lineWidth = 1
  ctx.strokeStyle = c.fg
  d.cursors.forEach((t, i) => {
    const x = Math.round((s.trigPos + t / winSec) * w) + 0.5
    ctx.setLineDash(i === 0 ? [6, 3] : [2, 3])
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
    ctx.fillStyle = c.fg
    ctx.font = '11px system-ui, sans-serif'
    ctx.fillText(i === 0 ? 'A' : 'B', x + 3, 24)
  })
  ctx.setLineDash([])
  if (d.hover) {
    ctx.globalAlpha = 0.5
    ctx.beginPath()
    ctx.moveTo(d.hover.x + 0.5, 0)
    ctx.lineTo(d.hover.x + 0.5, h)
    ctx.moveTo(0, d.hover.y + 0.5)
    ctx.lineTo(w, d.hover.y + 0.5)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
}

/** Sample value (volts) of a capture at time t (relative to the trigger), by linear interpolation. */
export function valueAt(cap: Capture, ch: 0 | 1, t: number): number | null {
  const k = (t - cap.t0) * cap.sampleRate
  const d = cap.data[ch]
  if (k < 0 || k > d.length - 1) return null
  const i = Math.floor(k)
  const f = k - i
  return i + 1 < d.length ? d[i] * (1 - f) + d[i + 1] * f : d[i]
}

export interface XYDraw {
  x: Float32Array | null
  y: Float32Array | null
  s: Settings
  colors: Colors
}

export function drawXY(ctx: CanvasRenderingContext2D, w: number, h: number, d: XYDraw): void {
  const { s, colors: c } = d
  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, w, h)
  const size = Math.min(w, h)
  const x0 = (w - size) / 2
  const y0 = (h - size) / 2
  graticule(ctx, x0, y0, size, size, DIVS_Y, DIVS_Y, c)
  if (!d.x || !d.y) return
  const div = size / DIVS_Y
  ctx.save()
  ctx.beginPath()
  ctx.rect(x0, y0, size, size)
  ctx.clip()
  ctx.strokeStyle = c.accent
  ctx.lineWidth = 1.4
  ctx.globalAlpha = 0.85
  ctx.beginPath()
  const sx = (s.ch[0].invert ? -1 : 1) / s.ch[0].vdiv
  const sy = (s.ch[1].invert ? -1 : 1) / s.ch[1].vdiv
  for (let i = 0; i < d.x.length; i++) {
    const px = x0 + size / 2 + d.x[i] * sx * div
    const py = y0 + size / 2 - d.y[i] * sy * div
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()
  ctx.restore()
}

export interface FftDraw {
  specs: [Float64Array | null, Float64Array | null]
  enabled: [boolean, boolean]
  sampleRate: number
  s: Settings
  colors: Colors
  peaks: [{ freq: number; amp: number } | null, { freq: number; amp: number } | null]
}

export const FFT_ML = 46
export const FFT_MB = 18
export const DB_TOP = 0
export const DB_BOTTOM = -120

export function fftAxis(d: Pick<FftDraw, 'sampleRate' | 's'>): { fmin: number; fmax: number } {
  const nyq = d.sampleRate / 2
  const fmax = d.s.fft.fmax > 0 ? Math.min(d.s.fft.fmax, nyq) : nyq
  return { fmin: d.s.fft.scale === 'log' ? 20 : 0, fmax }
}

export function drawFft(ctx: CanvasRenderingContext2D, w: number, h: number, d: FftDraw): void {
  const { s, colors: c } = d
  const ml = FFT_ML
  const mb = FFT_MB
  const pw = w - ml - 6
  const ph = h - mb - 6
  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, w, h)
  ctx.translate(ml, 6)
  const log = s.fft.scale === 'log'
  const { fmin, fmax } = fftAxis(d)
  const xOf = (f: number) => (log ? Math.log(Math.max(f, fmin) / fmin) / Math.log(fmax / fmin) : (f - fmin) / (fmax - fmin)) * pw
  const db = s.fft.unit === 'dbv'
  let top = 1
  if (!db) {
    let m = 0
    d.specs.forEach((sp, i) => {
      if (!sp || !d.enabled[i]) return
      for (let k = 1; k < sp.length; k++) if (sp[k] > m) m = sp[k]
    })
    top = snapUp([0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100], Math.max(m * 1.05, 0.001))
  }
  const yOf = (amp: number) => {
    if (db) {
      const v = 20 * Math.log10(Math.max(amp, 1e-12) / Math.SQRT2)
      return ph * (1 - (v - DB_BOTTOM) / (DB_TOP - DB_BOTTOM))
    }
    return ph * (1 - amp / top)
  }
  // grid
  ctx.lineWidth = 1
  ctx.font = '11px system-ui, sans-serif'
  ctx.fillStyle = c.fg
  ctx.strokeStyle = c.grid
  ctx.textAlign = 'right'
  ctx.beginPath()
  for (let j = 0; j <= 8; j++) {
    const y = Math.round((ph * j) / 8) + 0.5
    ctx.moveTo(0, y)
    ctx.lineTo(pw, y)
  }
  ctx.stroke()
  for (let j = 0; j <= 8; j += 2) {
    const label = db ? `${DB_TOP + ((DB_BOTTOM - DB_TOP) * j) / 8}` : formatSI(top * (1 - j / 8), 'V', 2)
    ctx.fillText(label, -4, (ph * j) / 8 + 4)
  }
  ctx.textAlign = 'center'
  const ticks: number[] = []
  if (log) {
    for (let dec = 10; dec <= fmax; dec *= 10) for (const m of [1, 2, 5]) if (dec * m >= fmin && dec * m <= fmax) ticks.push(dec * m)
  } else {
    const step = snapUp([50, 100, 200, 500, 1000, 2000, 5000], fmax / 8)
    for (let f = 0; f <= fmax; f += step) ticks.push(f)
  }
  ctx.beginPath()
  for (const f of ticks) {
    const x = Math.round(xOf(f)) + 0.5
    ctx.moveTo(x, 0)
    ctx.lineTo(x, ph)
  }
  ctx.stroke()
  for (const f of ticks) if (log ? String(f).startsWith('1') || String(f).startsWith('5') : true) ctx.fillText(formatSI(f, 'Hz', 2), Math.min(Math.max(xOf(f), 16), pw - 16), ph + 13)
  ctx.strokeStyle = c.gridStrong
  ctx.strokeRect(0.5, 0.5, pw - 1, ph - 1)

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, pw, ph)
  ctx.clip()
  const binHz = d.sampleRate / ((d.specs.find((x) => x)?.length ?? 2) * 2 - 2)
  d.specs.forEach((sp, i) => {
    if (!sp || !d.enabled[i]) return
    ctx.strokeStyle = c.ch[i]
    ctx.fillStyle = c.ch[i]
    ctx.lineWidth = 1.4
    ctx.beginPath()
    let started = false
    let px = -1
    let colMax = 0
    const flush = () => {
      if (px < 0) return
      const y = yOf(colMax)
      if (!started) {
        ctx.moveTo(px, y)
        started = true
      } else ctx.lineTo(px, y)
    }
    for (let k = log ? 1 : 0; k < sp.length; k++) {
      const f = k * binHz
      if (f < fmin || f > fmax * 1.001) continue
      const x = Math.round(xOf(f))
      if (x !== px) {
        flush()
        px = x
        colMax = sp[k]
      } else if (sp[k] > colMax) colMax = sp[k]
    }
    flush()
    ctx.stroke()
    const pk = d.peaks[i]
    if (pk && pk.freq >= fmin && pk.freq <= fmax) {
      const x = xOf(pk.freq)
      const y = yOf(pk.amp)
      ctx.beginPath()
      ctx.moveTo(x, y - 3)
      ctx.lineTo(x - 5, y - 11)
      ctx.lineTo(x + 5, y - 11)
      ctx.closePath()
      ctx.fill()
    }
  })
  ctx.restore()
  ctx.textAlign = 'start'
}
