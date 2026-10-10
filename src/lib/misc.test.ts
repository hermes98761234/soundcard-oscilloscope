import { describe, expect, it } from 'vitest'
import { formatSI, nearestIndex, snapUp, TIMEBASES, VOLTS_DIV } from './format'
import { autoset, calibrateScale } from './scope'
import { defaultSettings, loadSettings, sanitizeSettings, windowSamples } from './settings'
import { noise, waveValue } from './wave'

describe('formatSI', () => {
  it('uses engineering prefixes', () => {
    expect(formatSI(0.00125, 's')).toBe('1.25 ms')
    expect(formatSI(1000, 'Hz')).toBe('1 kHz')
    expect(formatSI(2.5e-5, 's')).toBe('25 µs')
    expect(formatSI(0.5, 'V')).toBe('500 mV')
    expect(formatSI(-1.5, 'V')).toBe('-1.5 V')
    expect(formatSI(0, 'V')).toBe('0 V')
    expect(formatSI(NaN, 'V')).toBe('—')
    expect(formatSI(999.9999, 'Hz')).toBe('1 kHz')
  })
})

describe('sequences', () => {
  it('snaps and finds nearest', () => {
    expect(snapUp(VOLTS_DIV, 0.11)).toBe(0.2)
    expect(snapUp(VOLTS_DIV, 0.1)).toBe(0.1)
    expect(snapUp(VOLTS_DIV, 1e6)).toBe(50)
    expect(TIMEBASES[nearestIndex(TIMEBASES, 0.0009)]).toBe(1e-3)
  })
})

describe('waves', () => {
  it('matches Web Audio oscillator conventions', () => {
    expect(waveValue('sine', 0.25)).toBeCloseTo(1, 12)
    expect(waveValue('square', 0.1)).toBe(1)
    expect(waveValue('square', 0.6)).toBe(-1)
    expect(waveValue('triangle', 0.25)).toBe(1)
    expect(waveValue('triangle', 0.75)).toBe(-1)
    expect(waveValue('sawtooth', 0)).toBe(0)
    expect(waveValue('sawtooth', 0.5 - 1e-9)).toBeCloseTo(1, 6)
    expect(waveValue('sine', 1.25)).toBeCloseTo(1, 9)
  })
  it('noise is zero-mean', () => {
    let s = 0
    for (let i = 0; i < 20000; i++) s += noise()
    expect(Math.abs(s / 20000)).toBeLessThan(0.05)
  })
})

describe('autoset and calibration', () => {
  it('fits the signal on screen', () => {
    const r = autoset([{ vpp: 1.2, freq: 1000 }, { vpp: 0, freq: null }])
    expect(r.vdiv).toEqual([0.2, null])
    expect(r.tdiv).toBe(0.5e-3)
  })
  it('scales the full-scale voltage to a known reference', () => {
    expect(calibrateScale(1, 0.8, 2)).toBeCloseTo(2.5, 12)
    expect(calibrateScale(1, 0, 2)).toBeNull()
  })
})

describe('settings', () => {
  it('has sensible defaults', () => {
    const d = defaultSettings()
    expect(d.source).toBe('demo')
    expect(windowSamples(1e-3, 48000)).toBe(480)
  })
  it('rejects garbage from storage', () => {
    const s = sanitizeSettings({ lang: 'xx', tdiv: 'a', ch: [{ vdiv: -5, probe: 7, pos: 99 }], gen: { freq: 1e9, on: true }, trigMode: 'single' })
    expect(s.lang).toBe('en')
    expect(s.tdiv).toBe(defaultSettings().tdiv)
    expect(s.ch[0].probe).toBe(1)
    expect(s.ch[0].pos).toBe(4)
    expect(s.ch[0].vdiv).toBe(0.001)
    expect(s.gen.freq).toBe(24000)
    expect(s.gen.on).toBe(false)
    expect(s.trigMode).toBe('auto')
    expect(sanitizeSettings(null)).toEqual(defaultSettings())
  })
  it('round-trips through JSON', () => {
    const d = defaultSettings()
    d.tdiv = 0.002
    d.ch[1].fsVolts = 3.3
    expect(sanitizeSettings(JSON.parse(JSON.stringify(d)))).toEqual(d)
  })
  it('loads defaults when storage is unavailable', () => {
    expect(loadSettings().source).toBe('demo')
  })
})
