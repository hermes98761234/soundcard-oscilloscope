import { TIMEBASES, VOLTS_DIV, snapUp } from './format'

export interface AutosetInput {
  vpp: number
  freq: number | null
}

export interface AutosetResult {
  /** Per-channel volts/div or null to leave unchanged. */
  vdiv: [number | null, number | null]
  tdiv: number | null
}

/** Picks volts/div so each signal fills ~6 of 8 divisions and a timebase that shows ~3 periods of the first usable frequency. */
export function autoset(m: [AutosetInput, AutosetInput]): AutosetResult {
  const vdiv = m.map((c) => (c.vpp > 1e-6 ? snapUp(VOLTS_DIV, c.vpp / 6) : null)) as [number | null, number | null]
  const f = m.find((c) => c.freq && c.freq > 0)?.freq ?? null
  const tdiv = f ? snapUp(TIMEBASES, 3 / f / 10) : null
  return { vdiv, tdiv }
}

/** Calibration: new full-scale volts so that a measured value matches the known reference. */
export function calibrateScale(currentFsVolts: number, measured: number, known: number): number | null {
  if (!(measured > 0) || !(known > 0)) return null
  return currentFsVolts * (known / measured)
}
