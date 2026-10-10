import { acMean, fetchVolts, type ChanProc } from './acquire'
import { measureFrequency, measurePhase, stats, type FreqMeasure, type Stats } from './dsp'
import type { RingBuffer } from './ring'

export interface ChanMeas {
  stats: Stats
  freq: FreqMeasure | null
  /** The raw input reached (nearly) full scale in the measured record. */
  clipped: boolean
}

export interface Measurements {
  ch: [ChanMeas, ChanMeas]
  /** Phase of CH2 relative to CH1, degrees. */
  phase: number | null
  samples: number
}

/** Measures the `len` samples ending at `endAbs` (calibrated, with the same coupling as the display). */
export function measureChannels(rings: [RingBuffer, RingBuffer], procs: [ChanProc, ChanProc], sampleRate: number, len: number, endAbs: number): Measurements | null {
  const start = endAbs - len
  const volts: Float32Array[] = []
  const clipped: boolean[] = []
  for (let c = 0; c < 2; c++) {
    const v = fetchVolts(rings[c], start, len, procs[c], acMean(rings[c], procs[c], endAbs, len, sampleRate))
    if (!v) return null
    volts.push(v)
    const raw = new Float32Array(len)
    rings[c].copy(start, raw)
    let hit = false
    for (let i = 0; i < len; i++) if (Math.abs(raw[i]) >= 0.995) { hit = true; break }
    clipped.push(hit)
  }
  const ch = [0, 1].map((c) => ({ stats: stats(volts[c]), freq: measureFrequency(volts[c], sampleRate), clipped: clipped[c] })) as [ChanMeas, ChanMeas]
  return { ch, phase: measurePhase(volts[0], volts[1]), samples: len }
}
