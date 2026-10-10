import { expect, it } from 'vitest'
import { measureChannels } from './measure'
import { RingBuffer } from './ring'

it('measures both channels from the ring buffers', () => {
  const SR = 48000
  const a = new RingBuffer(SR)
  const b = new RingBuffer(SR)
  const n = 24000
  a.push(Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SR)))
  b.push(Float32Array.from({ length: n }, (_, i) => Math.max(-1, Math.min(1, 1.5 * Math.sin(2 * Math.PI * 1000 * (i / SR - 0.00025))))))
  const p = { scale: 2, offset: 0, ac: false }
  const m = measureChannels([a, b], [p, { scale: 1, offset: 0, ac: false }], SR, 12000, n)!
  expect(m.ch[0].stats.vpp).toBeCloseTo(2, 2)
  expect(m.ch[0].stats.rms).toBeCloseTo(1 / Math.SQRT2, 2)
  expect(m.ch[0].freq!.freq).toBeCloseTo(1000, 0)
  expect(m.ch[0].clipped).toBe(false)
  expect(m.ch[1].clipped).toBe(true)
  expect(m.phase).toBeCloseTo(90, 0)
  expect(measureChannels([a, b], [p, p], SR, 12000, n + 100)).toBeNull()
})
