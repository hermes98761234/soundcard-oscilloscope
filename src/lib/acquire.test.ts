import { describe, expect, it } from 'vitest'
import { acquire, type AcqConfig } from './acquire'
import { RingBuffer } from './ring'

const SR = 48000
function fill(f: number, n: number, ch2Phase = 0.25): [RingBuffer, RingBuffer] {
  const a = new RingBuffer(SR)
  const b = new RingBuffer(SR)
  const x = new Float32Array(n)
  const y = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    x[i] = Math.sin((2 * Math.PI * f * i) / SR)
    y[i] = 0.5 * Math.sin(2 * Math.PI * (f * i / SR - ch2Phase))
  }
  a.push(x)
  b.push(y)
  return [a, b]
}
const cfg = (over: Partial<AcqConfig> = {}): AcqConfig => ({
  sampleRate: SR,
  window: 480,
  pre: 240,
  trigSource: 0,
  level: 0,
  slope: 'rising',
  hyst: 0.05,
  chans: [{ scale: 1, offset: 0, ac: false }, { scale: 1, offset: 0, ac: false }],
  ...over,
})

describe('RingBuffer', () => {
  it('wraps and tracks absolute indices', () => {
    const r = new RingBuffer(10)
    r.push([1, 2, 3, 4, 5, 6, 7])
    r.push([8, 9, 10, 11, 12])
    expect(r.total).toBe(12)
    expect(r.oldest).toBe(2)
    const out = new Float32Array(4)
    expect(r.copy(8, out)).toBe(true)
    expect([...out]).toEqual([9, 10, 11, 12])
    expect(r.copy(1, out)).toBe(false)
    expect(r.copy(10, out)).toBe(false)
  })
  it('keeps only the tail of an oversized chunk', () => {
    const r = new RingBuffer(4)
    r.push([1, 2, 3, 4, 5, 6])
    expect(r.at(5)).toBe(6)
    expect(r.at(2)).toBe(3)
    expect(r.oldest).toBe(2)
  })
})

describe('acquire', () => {
  it('centres a rising zero crossing on the trigger point', () => {
    const rings = fill(1000, 24000)
    const res = acquire(rings, cfg(), rings[0].total, -1, false)!
    expect(res.capture.triggered).toBe(true)
    const d = res.capture.data[0]
    // sample at index pre + t0*sr ... the crossing lies at pre - t0*SR in the window
    const x = -res.capture.t0 * SR
    const k = Math.floor(x)
    expect(d[k]).toBeLessThanOrEqual(0.0001)
    expect(d[k + 1]).toBeGreaterThan(0)
    // fractional position lets us recover the exact crossing time
    const frac = -d[k] / (d[k + 1] - d[k])
    expect(k + frac).toBeCloseTo(x, 3)
  })
  it('triggers on a falling edge and at a non-zero level', () => {
    const rings = fill(1000, 24000)
    const f = acquire(rings, cfg({ slope: 'falling' }), rings[0].total, -1, false)!
    const x = -f.capture.t0 * SR
    expect(f.capture.data[0][Math.floor(x)]).toBeGreaterThanOrEqual(0)
    expect(f.capture.data[0][Math.floor(x) + 1]).toBeLessThan(0.1)
    const l = acquire(rings, cfg({ level: 0.5 }), rings[0].total, -1, false)!
    const xl = -l.capture.t0 * SR
    expect(l.capture.data[0][Math.floor(xl)]).toBeLessThanOrEqual(0.5)
    expect(l.capture.data[0][Math.floor(xl) + 1]).toBeGreaterThan(0.5)
  })
  it('is stable: successive captures look the same for a periodic signal', () => {
    const rings = fill(1000, 24000)
    const a = acquire(rings, cfg(), 20000, -1, false)!
    const b = acquire(rings, cfg(), 23000, -1, false)!
    for (let i = 0; i < 480; i += 40) expect(a.capture.data[0][i]).toBeCloseTo(b.capture.data[0][i], 3)
  })
  it('only accepts triggers newer than minTrigAbs', () => {
    const rings = fill(1000, 24000)
    const first = acquire(rings, cfg(), 24000, -1, false)!
    expect(acquire(rings, cfg(), 24000, first.trigAbs, false)).toBeNull()
    const later = acquire(rings, cfg(), 24000 + 0, first.trigAbs - 48, false)!
    expect(later.trigAbs).toBe(first.trigAbs)
  })
  it('returns null without a trigger in normal mode and a free-run window in auto mode', () => {
    const rings = fill(1000, 24000)
    const c = cfg({ level: 2 })
    expect(acquire(rings, c, 24000, -1, false)).toBeNull()
    const fr = acquire(rings, c, 24000, -1, true)!
    expect(fr.capture.triggered).toBe(false)
    expect(fr.capture.data[0].length).toBe(480)
    expect(fr.trigAbs).toBe(-1)
  })
  it('applies calibration scale, offset and AC coupling', () => {
    const rings = fill(1000, 24000)
    const c = cfg({ chans: [{ scale: 2, offset: 0.5, ac: false }, { scale: 1, offset: 0, ac: true }], level: 0.5 })
    const r = acquire(rings, c, 24000, -1, false)!
    const d = r.capture.data[0]
    expect(Math.max(...d)).toBeCloseTo(2.5, 1)
    expect(Math.min(...d)).toBeCloseTo(-1.5, 1)
    const ac = r.capture.data[1]
    expect(ac.reduce((a, b) => a + b, 0) / ac.length).toBeCloseTo(0, 1)
  })
  it('triggers on channel 2 when selected, with a quarter-period offset', () => {
    const rings = fill(1000, 24000, 0.25)
    const r = acquire(rings, cfg({ trigSource: 1, level: 0 }), 24000, -1, false)!
    const x = -r.capture.t0 * SR
    const ch2 = r.capture.data[1]
    expect(ch2[Math.floor(x)]).toBeLessThanOrEqual(0.001)
    expect(ch2[Math.floor(x) + 1]).toBeGreaterThan(0)
  })
  it('returns null when there is not enough data', () => {
    const rings = fill(1000, 100)
    expect(acquire(rings, cfg(), 100, -1, true)).toBeNull()
  })
})
