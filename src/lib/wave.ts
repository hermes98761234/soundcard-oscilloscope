export type Wave = 'sine' | 'square' | 'triangle' | 'sawtooth' | 'noise'
export const WAVES: Wave[] = ['sine', 'square', 'triangle', 'sawtooth', 'noise']

/** One sample of a unit-amplitude periodic wave; `phase` is in cycles. Same phase convention as Web Audio's OscillatorNode. */
export function waveValue(kind: Exclude<Wave, 'noise'>, phase: number): number {
  const p = phase - Math.floor(phase)
  switch (kind) {
    case 'sine':
      return Math.sin(2 * Math.PI * p)
    case 'square':
      return p < 0.5 ? 1 : -1
    case 'triangle':
      return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4
    case 'sawtooth':
      return p < 0.5 ? 2 * p : 2 * p - 2
  }
}

/** Approximately Gaussian noise (sum of three uniforms), unit-ish variance. */
export function noise(rand: () => number = Math.random): number {
  return (rand() + rand() + rand() - 1.5) * 2
}
