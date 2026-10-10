import { scanCrossings } from './dsp'
import type { RingBuffer } from './ring'

export type TriggerMode = 'auto' | 'normal' | 'single'
export type Slope = 'rising' | 'falling'

/** volts = raw * scale + offset, then optionally the AC-coupling mean is removed. */
export interface ChanProc {
  scale: number
  offset: number
  ac: boolean
}

export interface AcqConfig {
  sampleRate: number
  /** Window length in samples (10 divisions). */
  window: number
  /** Samples shown before the trigger point. */
  pre: number
  trigSource: 0 | 1
  /** Trigger level in volts (after calibration/coupling). */
  level: number
  slope: Slope
  /** Hysteresis in volts. */
  hyst: number
  chans: [ChanProc, ChanProc]
}

export interface Capture {
  /** Calibrated volts per channel, `window` samples each. */
  data: [Float32Array, Float32Array]
  sampleRate: number
  /** Time of data[*][0] relative to the trigger point, seconds. */
  t0: number
  triggered: boolean
  /** Absolute sample index just past the last sample of the capture window. */
  endAbs: number
}

export interface AcqResult {
  capture: Capture
  /** Integer absolute index of the trigger sample (-1 for free-run). */
  trigAbs: number
}

/** Mean of the processed (not yet AC-removed) channel over [from, to). */
export function ringMean(ring: RingBuffer, from: number, to: number): number {
  from = Math.max(from, ring.oldest)
  to = Math.min(to, ring.total)
  if (to <= from) return 0
  let s = 0
  for (let i = from; i < to; i++) s += ring.at(i)
  return s / (to - from)
}

/** Value to subtract from a channel's samples for AC coupling (in volts). */
export function acMean(ring: RingBuffer, p: ChanProc, endAbs: number, window: number, sampleRate: number): number {
  if (!p.ac) return 0
  const len = Math.max(window, Math.round(sampleRate * 0.1))
  return ringMean(ring, endAbs - len, endAbs) * p.scale
}

/** Fetches `len` samples starting at `start` as calibrated volts; null if not available. */
export function fetchVolts(ring: RingBuffer, start: number, len: number, p: ChanProc, subtract: number): Float32Array | null {
  const out = new Float32Array(len)
  if (!ring.copy(start, out)) return null
  const k = p.scale
  const o = p.offset - subtract
  for (let i = 0; i < len; i++) out[i] = out[i] * k + o
  return out
}

/**
 * One acquisition: find the most recent trigger event after `minTrigAbs` that has `pre` samples before and the rest
 * of the window after it, using data up to `endAbs`. With `freeRun`, falls back to the latest untriggered window.
 */
export function acquire(rings: [RingBuffer, RingBuffer], cfg: AcqConfig, endAbs: number, minTrigAbs: number, freeRun: boolean): AcqResult | null {
  const { window: W, pre, sampleRate, trigSource } = cfg
  const post = W - pre
  const ring = rings[trigSource]
  const oldest = ring.oldest
  const first = Math.max(oldest + pre + 1, minTrigAbs + 1)
  const last = endAbs - post // exclusive upper bound for the trigger sample index
  const procT = cfg.chans[trigSource]
  const means: [number, number] = [acMean(rings[0], cfg.chans[0], endAbs, W, sampleRate), acMean(rings[1], cfg.chans[1], endAbs, W, sampleRate)]

  if (last > first) {
    const cap = Math.max(2 * W, Math.round(sampleRate * 0.25))
    const from = Math.max(first - 1, last - cap)
    const scratch = fetchVolts(ring, from, last - from, procT, means[trigSource])
    if (scratch) {
      const x = scanCrossings(scratch, cfg.level, cfg.hyst, cfg.slope === 'rising')
      // A crossing at scratch index 0 would be at `from`, which is not a valid trigger sample; guard anyway.
      if (x >= 0) {
        const xAbs = from + x
        const s = Math.floor(xAbs) - pre
        const a = fetchVolts(rings[0], s, W, cfg.chans[0], means[0])
        const b = fetchVolts(rings[1], s, W, cfg.chans[1], means[1])
        if (a && b) return { capture: { data: [a, b], sampleRate, t0: (s - xAbs) / sampleRate, triggered: true, endAbs: s + W }, trigAbs: Math.floor(xAbs) }
      }
    }
  }
  if (freeRun) {
    const s = endAbs - W
    const a = fetchVolts(rings[0], s, W, cfg.chans[0], means[0])
    const b = fetchVolts(rings[1], s, W, cfg.chans[1], means[1])
    if (a && b) return { capture: { data: [a, b], sampleRate, t0: -pre / sampleRate, triggered: false, endAbs }, trigAbs: -1 }
  }
  return null
}
