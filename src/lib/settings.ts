import type { Slope, TriggerMode } from './acquire'
import type { WindowKind } from './dsp'
import type { Wave } from './wave'
import { TIMEBASES, VOLTS_DIV, nearestIndex } from './format'

export type Lang = 'en' | 'uk'
export type Theme = 'auto' | 'light' | 'dark'
export type Source = 'demo' | 'input'
export type View = 'scope' | 'xy' | 'fft'

export interface ChannelSettings {
  enabled: boolean
  /** Volts per division. */
  vdiv: number
  /** Vertical position of the 0 V line, in divisions from the centre. */
  pos: number
  coupling: 'dc' | 'ac'
  invert: boolean
  /** Probe attenuation factor (1 = direct, 10 = x10 probe). */
  probe: number
  /** Calibration: volts at digital full scale (1.0). */
  fsVolts: number
  /** Calibration: offset added after scaling, in volts. */
  offset: number
}

export interface GenSettings {
  on: boolean
  wave: Wave
  freq: number
  /** Amplitude as a fraction of full scale (peak). */
  amp: number
  out: 'both' | 'left' | 'right'
}

export interface FftSettings {
  size: number
  window: WindowKind
  scale: 'log' | 'lin'
  unit: 'dbv' | 'v'
  /** Upper frequency shown in Hz; 0 = Nyquist. */
  fmax: number
  /** Exponential averaging factor: 0 = off. */
  avg: number
}

export interface Settings {
  lang: Lang
  theme: Theme
  source: Source
  deviceId: string
  view: View
  tdiv: number
  /** Horizontal trigger position, fraction of the screen width. */
  trigPos: number
  trigSource: 0 | 1
  trigSlope: Slope
  trigMode: TriggerMode
  /** Trigger level in volts. */
  trigLevel: number
  ch: [ChannelSettings, ChannelSettings]
  gen: GenSettings
  fft: FftSettings
}

export const defaultChannel = (pos: number): ChannelSettings => ({
  enabled: true,
  vdiv: 0.2,
  pos,
  coupling: 'dc',
  invert: false,
  probe: 1,
  fsVolts: 1,
  offset: 0,
})

export const defaultSettings = (): Settings => ({
  lang: 'en',
  theme: 'auto',
  source: 'demo',
  deviceId: '',
  view: 'scope',
  tdiv: 0.0005,
  trigPos: 0.5,
  trigSource: 0,
  trigSlope: 'rising',
  trigMode: 'auto',
  trigLevel: 0,
  ch: [defaultChannel(1.5), defaultChannel(-1.5)],
  gen: { on: false, wave: 'sine', freq: 1000, amp: 0.4, out: 'both' },
  fft: { size: 8192, window: 'hann', scale: 'log', unit: 'dbv', fmax: 0, avg: 0.5 },
})

/** Samples on screen for the current timebase. */
export function windowSamples(tdiv: number, sampleRate: number): number {
  return Math.max(16, Math.round(tdiv * 10 * sampleRate))
}

/** Calibrated volts per raw sample unit, including the probe factor. */
export function channelScale(c: ChannelSettings): number {
  return c.fsVolts * c.probe
}

const KEY = 'soundcard-oscilloscope:v1'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
const oneOf = <T extends string | number>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d)
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)

function sanitizeChannel(raw: unknown, d: ChannelSettings): ChannelSettings {
  const r = isObj(raw) ? raw : {}
  return {
    enabled: bool(r.enabled, d.enabled),
    vdiv: VOLTS_DIV[nearestIndex(VOLTS_DIV, num(r.vdiv, d.vdiv, 1e-4, 1e3))],
    pos: num(r.pos, d.pos, -4, 4),
    coupling: oneOf(r.coupling, ['dc', 'ac'] as const, d.coupling),
    invert: bool(r.invert, d.invert),
    probe: oneOf(r.probe, [1, 10, 100] as const, 1),
    fsVolts: num(r.fsVolts, d.fsVolts, 1e-6, 1e6),
    offset: num(r.offset, d.offset, -1e3, 1e3),
  }
}

/** Merges stored (untrusted) data over the defaults. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings()
  if (!isObj(raw)) return d
  const ch = Array.isArray(raw.ch) ? raw.ch : []
  const g = isObj(raw.gen) ? raw.gen : {}
  const f = isObj(raw.fft) ? raw.fft : {}
  return {
    lang: oneOf(raw.lang, ['en', 'uk'] as const, d.lang),
    theme: oneOf(raw.theme, ['auto', 'light', 'dark'] as const, d.theme),
    source: oneOf(raw.source, ['demo', 'input'] as const, d.source),
    deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : '',
    view: oneOf(raw.view, ['scope', 'xy', 'fft'] as const, d.view),
    tdiv: TIMEBASES[nearestIndex(TIMEBASES, num(raw.tdiv, d.tdiv, 1e-6, 10))],
    trigPos: num(raw.trigPos, d.trigPos, 0.05, 0.95),
    trigSource: oneOf(raw.trigSource, [0, 1] as const, 0),
    trigSlope: oneOf(raw.trigSlope, ['rising', 'falling'] as const, d.trigSlope),
    trigMode: oneOf(raw.trigMode, ['auto', 'normal'] as const, d.trigMode),
    trigLevel: num(raw.trigLevel, d.trigLevel, -1e3, 1e3),
    ch: [sanitizeChannel(ch[0], d.ch[0]), sanitizeChannel(ch[1], d.ch[1])],
    gen: {
      on: false,
      wave: oneOf(g.wave, ['sine', 'square', 'triangle', 'sawtooth', 'noise'] as const, d.gen.wave),
      freq: num(g.freq, d.gen.freq, 1, 24000),
      amp: num(g.amp, d.gen.amp, 0, 1),
      out: oneOf(g.out, ['both', 'left', 'right'] as const, d.gen.out),
    },
    fft: {
      size: oneOf(f.size, [1024, 2048, 4096, 8192, 16384, 32768] as const, d.fft.size),
      window: oneOf(f.window, ['rect', 'hann', 'hamming', 'blackman', 'flattop'] as const, d.fft.window),
      scale: oneOf(f.scale, ['log', 'lin'] as const, d.fft.scale),
      unit: oneOf(f.unit, ['dbv', 'v'] as const, d.fft.unit),
      fmax: oneOf(f.fmax, [0, 20000, 10000, 5000, 2000, 1000, 500] as const, d.fft.fmax),
      avg: oneOf(f.avg, [0, 0.5, 0.8, 0.9] as const, d.fft.avg),
    },
  }
}

export function loadSettings(): Settings {
  try {
    const s = localStorage.getItem(KEY)
    if (s) return sanitizeSettings(JSON.parse(s))
  } catch {
    /* storage unavailable or corrupt: use defaults */
  }
  const d = defaultSettings()
  try {
    if (navigator.language?.toLowerCase().startsWith('uk')) d.lang = 'uk'
  } catch {
    /* ignore */
  }
  return d
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}
