export interface Stats {
  min: number
  max: number
  mean: number
  rms: number
  /** RMS with the mean removed. */
  acRms: number
  vpp: number
}

export function stats(x: ArrayLike<number>): Stats {
  const n = x.length
  if (n === 0) return { min: 0, max: 0, mean: 0, rms: 0, acRms: 0, vpp: 0 }
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let sq = 0
  for (let i = 0; i < n; i++) {
    const v = x[i]
    if (v < min) min = v
    if (v > max) max = v
    sum += v
    sq += v * v
  }
  const mean = sum / n
  return { min, max, mean, rms: Math.sqrt(sq / n), acRms: Math.sqrt(Math.max(0, sq / n - mean * mean)), vpp: max - min }
}

/**
 * Schmitt-trigger style level crossings with hysteresis. A rising crossing is reported when the signal reaches
 * `level` after having been below `level - hyst` (mirrored for falling). Positions are fractional sample indices
 * from linear interpolation. Returns the last crossing (or -1); pushes all of them to `out` if given.
 */
export function scanCrossings(x: ArrayLike<number>, level: number, hyst: number, rising: boolean, out?: number[]): number {
  let armed = false
  let last = -1
  const arm = rising ? level - hyst : level + hyst
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    if (rising) {
      if (v < arm) armed = true
      else if (armed && v >= level && i > 0) {
        const a = x[i - 1]
        last = i - 1 + (v === a ? 1 : (level - a) / (v - a))
        out?.push(last)
        armed = false
      }
    } else {
      if (v > arm) armed = true
      else if (armed && v <= level && i > 0) {
        const a = x[i - 1]
        last = i - 1 + (v === a ? 1 : (level - a) / (v - a))
        out?.push(last)
        armed = false
      }
    }
  }
  return last
}

export interface FreqMeasure {
  freq: number
  period: number
  /** High time as a fraction of the period, 0..1. */
  duty: number | null
}

/** Frequency from rising crossings of the mid level (averaged over all whole periods in the record). */
export function measureFrequency(x: ArrayLike<number>, sampleRate: number): FreqMeasure | null {
  const s = stats(x)
  if (s.vpp < 1e-9) return null
  const mid = (s.max + s.min) / 2
  const hyst = s.vpp * 0.1
  const up: number[] = []
  scanCrossings(x, mid, hyst, true, up)
  if (up.length < 2) return null
  const periodSamples = (up[up.length - 1] - up[0]) / (up.length - 1)
  if (periodSamples <= 0) return null
  const down: number[] = []
  scanCrossings(x, mid, hyst, false, down)
  let duty: number | null = null
  const highs: number[] = []
  for (const u of up) {
    const d = down.find((v) => v > u)
    if (d !== undefined) highs.push(d - u)
  }
  if (highs.length > 0) duty = Math.min(1, highs.reduce((a, b) => a + b, 0) / highs.length / periodSamples)
  return { freq: sampleRate / periodSamples, period: periodSamples / sampleRate, duty }
}

/** Phase of `b` relative to `a` in degrees (-180, 180], positive = b lags a, from rising mid-level crossings. */
export function measurePhase(a: ArrayLike<number>, b: ArrayLike<number>): number | null {
  const sa = stats(a)
  const sb = stats(b)
  if (sa.vpp < 1e-9 || sb.vpp < 1e-9) return null
  const ca: number[] = []
  const cb: number[] = []
  scanCrossings(a, (sa.max + sa.min) / 2, sa.vpp * 0.1, true, ca)
  scanCrossings(b, (sb.max + sb.min) / 2, sb.vpp * 0.1, true, cb)
  if (ca.length < 2 || cb.length < 2) return null
  const period = (ca[ca.length - 1] - ca[0]) / (ca.length - 1)
  const periodB = (cb[cb.length - 1] - cb[0]) / (cb.length - 1)
  if (Math.abs(period - periodB) / period > 0.02) return null
  let sx = 0
  let sy = 0
  for (const t of cb) {
    let d = (t - ca[0]) / period
    d -= Math.floor(d)
    sx += Math.cos(2 * Math.PI * d)
    sy += Math.sin(2 * Math.PI * d)
  }
  const deg = (Math.atan2(sy, sx) * 180) / Math.PI
  return deg <= -180 ? deg + 360 : deg
}

// ---------------------------------------------------------------- FFT

export type WindowKind = 'rect' | 'hann' | 'hamming' | 'blackman' | 'flattop'
export const WINDOWS: WindowKind[] = ['rect', 'hann', 'hamming', 'blackman', 'flattop']

const COEFFS: Record<WindowKind, number[]> = {
  rect: [1],
  hann: [0.5, 0.5],
  hamming: [0.54, 0.46],
  blackman: [0.42, 0.5, 0.08],
  flattop: [0.21557895, 0.41663158, 0.277263158, 0.083578947, 0.006947368],
}

const windowCache = new Map<string, Float64Array>()
/** Periodic (DFT-even) cosine-sum window. */
export function makeWindow(kind: WindowKind, n: number): Float64Array {
  const key = `${kind}:${n}`
  const hit = windowCache.get(key)
  if (hit) return hit
  const a = COEFFS[kind]
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let v = 0
    for (let k = 0; k < a.length; k++) v += (k % 2 ? -1 : 1) * a[k] * Math.cos((2 * Math.PI * k * i) / n)
    w[i] = v
  }
  windowCache.set(key, w)
  return w
}

/** In-place iterative radix-2 FFT. `re.length` must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
}

/**
 * Single-sided amplitude spectrum (peak amplitude of a sinusoid in each bin, in the units of `x`).
 * Returns n/2 + 1 bins; bin k is at k * sampleRate / n. Input is the last `n` samples of `x`, zero-padded at the front.
 */
export function amplitudeSpectrum(x: ArrayLike<number>, n: number, kind: WindowKind): Float64Array {
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const w = makeWindow(kind, n)
  const off = x.length - n
  let sw = 0
  for (let i = 0; i < n; i++) {
    const j = off + i
    re[i] = j >= 0 ? x[j] * w[i] : 0
    sw += w[i]
  }
  fft(re, im)
  const out = new Float64Array(n / 2 + 1)
  for (let k = 0; k <= n / 2; k++) {
    const mag = Math.hypot(re[k], im[k]) / sw
    out[k] = k === 0 || k === n / 2 ? mag : 2 * mag
  }
  return out
}

/** Peak amplitude (volts) to dBV of an RMS sinusoid. */
export function toDbvRms(peak: number): number {
  return 20 * Math.log10(Math.max(peak, 1e-12) / Math.SQRT2)
}

export interface Peak {
  freq: number
  amp: number
}

/** Highest spectral peak at or above `minBin`, refined by parabolic interpolation of the log magnitude. */
export function findPeak(spec: ArrayLike<number>, sampleRate: number, minBin = 1): Peak | null {
  const n = (spec.length - 1) * 2
  let k = -1
  let best = 0
  for (let i = Math.max(1, minBin); i < spec.length - 1; i++) {
    if (spec[i] > best && spec[i] >= spec[i - 1] && spec[i] >= spec[i + 1]) {
      best = spec[i]
      k = i
    }
  }
  if (k < 0 || best <= 1e-12) return null
  const a = Math.log(Math.max(spec[k - 1], 1e-15))
  const b = Math.log(spec[k])
  const c = Math.log(Math.max(spec[k + 1], 1e-15))
  const den = a - 2 * b + c
  const d = den === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den))
  const amp = Math.exp(b - 0.25 * (a - c) * d)
  return { freq: ((k + d) * sampleRate) / n, amp }
}

/** Total harmonic distortion (ratio, not percent) from harmonics 2..maxHarmonic of f0, searching ±3 bins around each. */
export function thd(spec: ArrayLike<number>, sampleRate: number, f0: number, maxHarmonic = 10): number | null {
  const n = (spec.length - 1) * 2
  const bin = (f: number) => Math.round((f * n) / sampleRate)
  const peakNear = (f: number) => {
    const c = bin(f)
    let m = 0
    for (let i = Math.max(1, c - 3); i <= Math.min(spec.length - 1, c + 3); i++) m = Math.max(m, spec[i])
    return m
  }
  const fund = peakNear(f0)
  if (fund <= 1e-12) return null
  let sum = 0
  let count = 0
  for (let h = 2; h <= maxHarmonic; h++) {
    if (f0 * h >= sampleRate / 2 - (3 * sampleRate) / n) break
    const a = peakNear(f0 * h)
    sum += a * a
    count++
  }
  return count === 0 ? null : Math.sqrt(sum) / fund
}
