const PREFIXES: [number, string][] = [
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
]

/** Engineering notation with an SI prefix: formatSI(0.00125, 's') = "1.25 ms". */
export function formatSI(v: number, unit: string, digits = 3): string {
  if (!Number.isFinite(v)) return '—'
  if (v === 0) return `0 ${unit}`
  const a = Math.abs(v)
  let [scale, prefix] = PREFIXES[PREFIXES.length - 1]
  for (const [s, p] of PREFIXES) {
    if (a >= s * 0.9995) {
      scale = s
      prefix = p
      break
    }
  }
  const n = Number((v / scale).toPrecision(digits))
  return `${n} ${prefix}${unit}`
}

/** 1-2-5 sequence helpers. */
export function nearestIndex(seq: readonly number[], v: number): number {
  let best = 0
  for (let i = 1; i < seq.length; i++) if (Math.abs(Math.log(seq[i] / v)) < Math.abs(Math.log(seq[best] / v))) best = i
  return best
}

/** Smallest value in an ascending sequence that is >= v (or the last one). */
export function snapUp(seq: readonly number[], v: number): number {
  for (const s of seq) if (s >= v * 0.9999) return s
  return seq[seq.length - 1]
}

export const TIMEBASES = [20e-6, 50e-6, 100e-6, 200e-6, 500e-6, 1e-3, 2e-3, 5e-3, 10e-3, 20e-3, 50e-3, 100e-3, 200e-3, 500e-3] as const
export const VOLTS_DIV = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50] as const
