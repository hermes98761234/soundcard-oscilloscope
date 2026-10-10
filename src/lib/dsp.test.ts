import { describe, expect, it } from 'vitest'
import { amplitudeSpectrum, fft, findPeak, makeWindow, measureFrequency, measurePhase, scanCrossings, stats, thd, toDbvRms } from './dsp'
import { waveValue } from './wave'

const SR = 48000
const sine = (f: number, n: number, a = 1, ph = 0, dc = 0) => Float32Array.from({ length: n }, (_, i) => dc + a * Math.sin(2 * Math.PI * (f * i / SR + ph)))

describe('stats', () => {
  it('matches analytic values for a sine', () => {
    const s = stats(sine(1000, 48000, 0.5, 0, 0.1))
    expect(s.vpp).toBeCloseTo(1, 3)
    expect(s.mean).toBeCloseTo(0.1, 4)
    expect(s.acRms).toBeCloseTo(0.5 / Math.SQRT2, 4)
    expect(s.rms).toBeCloseTo(Math.hypot(0.1, 0.5 / Math.SQRT2), 4)
  })
  it('handles an empty record', () => {
    expect(stats([]).vpp).toBe(0)
  })
  it('RMS of a square wave equals its amplitude', () => {
    const x = Float32Array.from({ length: 4800 }, (_, i) => waveValue('square', i / 48) * 2)
    expect(stats(x).rms).toBeCloseTo(2, 6)
  })
})

describe('scanCrossings', () => {
  it('interpolates the crossing position', () => {
    expect(scanCrossings([-1, 1], 0, 0.1, true)).toBeCloseTo(0.5, 9)
    expect(scanCrossings([-1, 3], 0, 0.1, true)).toBeCloseTo(0.25, 9)
    expect(scanCrossings([1, -3], 0, 0.1, false)).toBeCloseTo(0.25, 9)
  })
  it('ignores noise inside the hysteresis band', () => {
    const x = [-1, -0.02, 0.02, -0.03, 0.03, 1, -1, 1]
    const out: number[] = []
    scanCrossings(x, 0, 0.2, true, out)
    expect(out.length).toBe(2)
  })
  it('returns -1 without a crossing', () => {
    expect(scanCrossings([1, 2, 3], 0, 0.1, true)).toBe(-1)
  })
})

describe('measureFrequency', () => {
  it('measures a 1 kHz sine to 0.01%', () => {
    const m = measureFrequency(sine(1000, 12000, 0.7, 0.13), SR)!
    expect(m.freq).toBeCloseTo(1000, 1)
    expect(m.period).toBeCloseTo(0.001, 7)
    expect(m.duty).toBeCloseTo(0.5, 2)
  })
  it('measures an off-grid frequency and an offset signal', () => {
    expect(measureFrequency(sine(441.7, 24000, 0.2, 0, 0.3), SR)!.freq).toBeCloseTo(441.7, 0)
  })
  it('measures the duty cycle of a pulse train', () => {
    const x = Float32Array.from({ length: 24000 }, (_, i) => ((i % 480) / 480 < 0.25 ? 1 : 0))
    const m = measureFrequency(x, SR)!
    expect(m.freq).toBeCloseTo(100, 3)
    expect(m.duty).toBeCloseTo(0.25, 2)
  })
  it('returns null for DC or a single edge', () => {
    expect(measureFrequency(new Float32Array(1000).fill(0.5), SR)).toBeNull()
    expect(measureFrequency(sine(10, 2000), SR)).toBeNull()
  })
})

describe('measurePhase', () => {
  it('reports the lag of the second channel', () => {
    const a = sine(1000, 12000)
    expect(measurePhase(a, sine(1000, 12000, 0.5, -0.25))).toBeCloseTo(90, 0)
    expect(measurePhase(a, sine(1000, 12000, 0.5, 0.125))).toBeCloseTo(-45, 0)
  })
  it('is null for different frequencies', () => {
    expect(measurePhase(sine(1000, 12000), sine(1300, 12000))).toBeNull()
  })
})

describe('fft', () => {
  it('transforms an impulse to a flat spectrum', () => {
    const re = new Float64Array(8)
    const im = new Float64Array(8)
    re[0] = 1
    fft(re, im)
    for (let k = 0; k < 8; k++) {
      expect(re[k]).toBeCloseTo(1, 12)
      expect(im[k]).toBeCloseTo(0, 12)
    }
  })
  it('puts a cosine in the right bin', () => {
    const n = 64
    const re = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 5 * i) / n))
    const im = new Float64Array(n)
    fft(re, im)
    expect(re[5]).toBeCloseTo(n / 2, 9)
    expect(re[n - 5]).toBeCloseTo(n / 2, 9)
    expect(Math.abs(re[6])).toBeLessThan(1e-9)
  })
})

describe('amplitude spectrum', () => {
  const n = 8192
  // exactly 100 cycles in the record -> bin 100
  const f = (100 * SR) / n
  it.each(['rect', 'hann', 'hamming', 'blackman', 'flattop'] as const)('reads a 0.5 V sine as 0.5 V with the %s window', (win) => {
    const spec = amplitudeSpectrum(sine(f, n, 0.5), n, win)
    const peak = findPeak(spec, SR)!
    expect(peak.amp).toBeCloseTo(0.5, 2)
    expect(peak.freq).toBeCloseTo(f, 1)
  })
  it('interpolates an off-bin frequency within a fraction of a bin', () => {
    const spec = amplitudeSpectrum(sine(1234.5, n, 0.8), n, 'hann')
    const peak = findPeak(spec, SR)!
    expect(Math.abs(peak.freq - 1234.5)).toBeLessThan(0.6)
    expect(peak.amp).toBeCloseTo(0.8, 1)
  })
  it('measures DC in bin 0', () => {
    expect(amplitudeSpectrum(new Float32Array(n).fill(0.25), n, 'rect')[0]).toBeCloseTo(0.25, 9)
  })
  it('window sums match the textbook coherent gains', () => {
    const sum = (k: Parameters<typeof makeWindow>[0]) => makeWindow(k, 1024).reduce((a, b) => a + b, 0) / 1024
    expect(sum('rect')).toBeCloseTo(1, 12)
    expect(sum('hann')).toBeCloseTo(0.5, 12)
    expect(sum('hamming')).toBeCloseTo(0.54, 12)
    expect(sum('blackman')).toBeCloseTo(0.42, 12)
    expect(sum('flattop')).toBeCloseTo(0.21557895, 8)
  })
  it('converts amplitude to dBV RMS', () => {
    expect(toDbvRms(Math.SQRT2)).toBeCloseTo(0, 9)
    expect(toDbvRms(1)).toBeCloseTo(-3.0103, 3)
  })
})

describe('thd', () => {
  it('finds 10% distortion from a third harmonic', () => {
    const n = 16384
    const f0 = (200 * SR) / n
    const x = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * f0 * i) / SR) + 0.1 * Math.sin((2 * Math.PI * 3 * f0 * i) / SR))
    const spec = amplitudeSpectrum(x, n, 'hann')
    expect(thd(spec, SR, f0)!).toBeCloseTo(0.1, 3)
  })
  it('is tiny for a pure sine', () => {
    const n = 16384
    const f0 = (200 * SR) / n
    expect(thd(amplitudeSpectrum(sine(f0, n), n, 'blackman'), SR, f0)!).toBeLessThan(1e-4)
  })
  it('square wave THD is close to the textbook 48.3%', () => {
    const n = 16384
    const f0 = (100 * SR) / n
    const x = Float32Array.from({ length: n }, (_, i) => waveValue('square', (f0 * i) / SR))
    // odd harmonics only: sqrt(sum 1/k^2 for odd k=3..9) with harmonics up to 10
    const expected = Math.sqrt(1 / 9 + 1 / 25 + 1 / 49 + 1 / 81)
    expect(thd(amplitudeSpectrum(x, n, 'hann'), SR, f0, 10)!).toBeCloseTo(expected, 2)
  })
})
