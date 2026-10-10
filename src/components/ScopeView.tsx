import { useEffect, useRef, useState } from 'react'
import { drawFft, drawScope, drawXY, fftAxis, FFT_ML, prepare, readColors, valueAt, DIVS_X, DIVS_Y } from '../draw'
import type { Engine } from '../engine'
import { acMean, acquire, fetchVolts, type Capture } from '../lib/acquire'
import { amplitudeSpectrum, findPeak, thd, toDbvRms, type Peak } from '../lib/dsp'
import { formatSI } from '../lib/format'
import { measureChannels, type Measurements } from '../lib/measure'
import type { Settings } from '../lib/settings'
import type { T } from '../i18n'
import { acqConfig, procOf } from '../lib/config'

export type Run = 'run' | 'stop' | 'single'

export interface ScopeInfo {
  meas: Measurements | null
  peaks: [Peak | null, Peak | null]
  thd: number | null
  /** The last window was triggered (false = free-running or waiting). */
  triggered: boolean
  waiting: boolean
  sampleRate: number
}

interface Props {
  engine: Engine
  s: Settings
  run: Run
  /** Bumped by the parent to force a re-acquire (e.g. after autoset). */
  nonce: number
  onRun: (r: Run) => void
  onInfo: (i: ScopeInfo) => void
  t: T
}

export default function ScopeView({ engine, s, run, nonce, onRun, onInfo, t }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const propsRef = useRef({ engine, s, run, onRun, onInfo })
  useEffect(() => {
    propsRef.current = { engine, s, run, onRun, onInfo }
  })
  const st = useRef({
    rings: engine.rings,
    capture: null as Capture | null,
    minTrig: -1,
    armAt: 0,
    lastEvent: 0,
    lastTotal: -1,
    frozen: null as number | null,
    prevRun: 'run' as Run,
    dirty: true,
    lastInfo: 0,
    triggered: false,
    avg: [null, null] as [Float64Array | null, Float64Array | null],
    specs: [null, null] as [Float64Array | null, Float64Array | null],
    peaks: [null, null] as [Peak | null, Peak | null],
    thd: null as number | null,
    hover: null as { x: number; y: number } | null,
    sr: 48000,
  })
  const [cursors, setCursors] = useState<number[]>([])
  const cursorsRef = useRef<number[]>([])
  useEffect(() => {
    cursorsRef.current = cursors
  }, [cursors])
  const [readout, setReadout] = useState('')

  useEffect(() => {
    st.current.dirty = true
  }, [s, nonce])

  useEffect(() => {
    let raf = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const { engine: eng, s: S, run: R, onRun: setRun, onInfo: info } = propsRef.current
      const z = st.current
      eng.tick(now)
      if (z.rings !== eng.rings) {
        z.rings = eng.rings
        z.capture = null
        z.minTrig = -1
        z.frozen = null
        z.dirty = true
        z.lastTotal = -1
        z.avg = [null, null]
      }
      const rings = eng.rings
      const sr = eng.sampleRate
      z.sr = sr
      const total = Math.min(rings[0].total, rings[1].total)
      if (R !== z.prevRun) {
        if (R === 'single') {
          z.armAt = total
          z.minTrig = total
          z.capture = null
        }
        if (R === 'stop') z.frozen = total
        if (R === 'run') {
          z.frozen = null
          z.minTrig = -1
        }
        z.prevRun = R
      }
      const cfg = acqConfig(S, sr)
      const endAbs = R === 'stop' ? (z.frozen ?? total) : total
      if (z.dirty) {
        z.dirty = false
        z.minTrig = R === 'single' ? z.armAt : -1
        if (R === 'stop') z.capture = acquire(rings, cfg, endAbs, -1, true)?.capture ?? z.capture
        z.lastTotal = -1
      }
      const waiting = R === 'single' && !z.capture
      if (R !== 'stop' && total !== z.lastTotal) {
        z.lastTotal = total
        const timeout = Math.max(cfg.window, Math.round(sr * 0.1))
        const free = R === 'run' && S.trigMode === 'auto' && total - z.lastEvent > timeout
        const res = acquire(rings, cfg, endAbs, z.minTrig, free)
        if (res) {
          z.capture = res.capture
          z.lastEvent = total
          z.triggered = res.capture.triggered
          if (res.trigAbs >= 0) z.minTrig = res.trigAbs
          if (R === 'single') setRun('stop')
        }
      }

      // draw
      const canvas = canvasRef.current
      const p = canvas && prepare(canvas)
      const procs = procOf(S)
      const specNeeded = S.view === 'fft'
      if (specNeeded || now - z.lastInfo > 250) {
        // FFT spectra for the last `size` samples
        if (specNeeded) {
          for (const c of [0, 1] as const) {
            const n = Math.min(S.fft.size, rings[c].total - rings[c].oldest)
            if (n < 16 || !S.ch[c].enabled) {
              z.specs[c] = null
              continue
            }
            const v = fetchVolts(rings[c], endAbs - n, n, procs[c], acMean(rings[c], procs[c], endAbs, n, sr))
            if (!v) continue
            const sp = amplitudeSpectrum(v, S.fft.size, S.fft.window)
            const prev = z.avg[c]
            if (prev && prev.length === sp.length && S.fft.avg > 0 && R !== 'stop') for (let k = 0; k < sp.length; k++) sp[k] = S.fft.avg * prev[k] + (1 - S.fft.avg) * sp[k]
            z.avg[c] = sp
            z.specs[c] = sp
            z.peaks[c] = findPeak(sp, sr, 2)
          }
        }
      }
      if (p) {
        const colors = readColors(canvas)
        const { ctx, w, h } = p
        if (S.view === 'scope') drawScope(ctx, w, h, { capture: z.capture, s: S, colors, cursors: cursorsRef.current, hover: z.hover })
        else if (S.view === 'xy') {
          const n = Math.min(Math.max(cfg.window, 1024), 65536, rings[0].total - rings[0].oldest, rings[1].total - rings[1].oldest)
          const x = n > 8 ? fetchVolts(rings[0], endAbs - n, n, procs[0], acMean(rings[0], procs[0], endAbs, n, sr)) : null
          const y = n > 8 ? fetchVolts(rings[1], endAbs - n, n, procs[1], acMean(rings[1], procs[1], endAbs, n, sr)) : null
          drawXY(ctx, w, h, { x, y, s: S, colors })
        } else drawFft(ctx, w, h, { specs: z.specs, enabled: [S.ch[0].enabled, S.ch[1].enabled], sampleRate: sr, s: S, colors, peaks: z.peaks })
      }

      if (now - z.lastInfo > 250) {
        z.lastInfo = now
        const len = Math.min(Math.max(cfg.window, Math.round(sr * 0.25)), 1 << 18, rings[0].total - rings[0].oldest, rings[1].total - rings[1].oldest)
        const meas = len >= 32 ? measureChannels(rings, procs, sr, len, endAbs) : null
        let thdv: number | null = null
        const pk = z.peaks[0] ?? z.peaks[1]
        const spec = z.specs[0] ?? z.specs[1]
        if (specNeeded && pk && spec) thdv = thd(spec, sr, pk.freq)
        z.thd = thdv
        info({ meas, peaks: z.peaks, thd: thdv, triggered: z.triggered, waiting, sampleRate: sr })
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const local = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }
  }

  const describe = (x: number, y: number, w: number, h: number): string => {
    const z = st.current
    if (s.view === 'scope') {
      const t0 = (x / w - s.trigPos) * s.tdiv * DIVS_X
      const parts = [`t = ${formatSI(t0, 's')}`]
      for (const c of [0, 1] as const) {
        if (!s.ch[c].enabled) continue
        const v = z.capture ? valueAt(z.capture, c, t0) : null
        parts.push(`CH${c + 1} ${v === null ? '—' : formatSI(v, 'V')}`)
      }
      return parts.join('   ')
    }
    if (s.view === 'xy') {
      const size = Math.min(w, h)
      const dx = ((x - w / 2) / size) * DIVS_Y
      const dy = ((h / 2 - y) / size) * DIVS_Y
      return `X = ${formatSI(dx * s.ch[0].vdiv, 'V')}   Y = ${formatSI(dy * s.ch[1].vdiv, 'V')}`
    }
    const { fmin, fmax } = fftAxis({ sampleRate: z.sr, s })
    const pw = w - FFT_ML - 6
    const fx = Math.min(1, Math.max(0, (x - FFT_ML) / pw))
    const f = s.fft.scale === 'log' ? fmin * Math.pow(fmax / fmin, fx) : fmin + fx * (fmax - fmin)
    const parts = [`f = ${formatSI(f, 'Hz')}`]
    for (const c of [0, 1] as const) {
      const sp = z.specs[c]
      if (!sp || !s.ch[c].enabled) continue
      const k = Math.round((f * (sp.length - 1) * 2) / z.sr)
      const a = sp[Math.min(sp.length - 1, Math.max(0, k))]
      parts.push(`CH${c + 1} ${s.fft.unit === 'dbv' ? `${toDbvRms(a).toFixed(1)} dBV` : formatSI(a, 'V')}`)
    }
    return parts.join('   ')
  }

  const cursorText = (): string => {
    const z = st.current
    if (s.view !== 'scope' || cursors.length === 0) return ''
    const [a, b] = cursors
    const parts = [`A = ${formatSI(a, 's')}`]
    if (b !== undefined) {
      parts.push(`B = ${formatSI(b, 's')}`, `Δt = ${formatSI(b - a, 's')}`)
      if (b !== a) parts.push(`1/Δt = ${formatSI(1 / Math.abs(b - a), 'Hz')}`)
      for (const c of [0, 1] as const) {
        if (!s.ch[c].enabled || !z.capture) continue
        const va = valueAt(z.capture, c, a)
        const vb = valueAt(z.capture, c, b)
        if (va !== null && vb !== null) parts.push(`ΔV${c + 1} = ${formatSI(vb - va, 'V')}`)
      }
    }
    return parts.join('   ')
  }

  return (
    <div className="scope-wrap">
      <div className="scope-canvas">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={t('Oscilloscope display')}
          onPointerMove={(e) => {
            const { x, y, w, h } = local(e)
            st.current.hover = { x, y }
            setReadout(describe(x, y, w, h))
          }}
          onPointerLeave={() => {
            st.current.hover = null
            setReadout('')
          }}
          onClick={(e) => {
            if (s.view !== 'scope') return
            const { x, w } = local(e as unknown as React.PointerEvent<HTMLCanvasElement>)
            const tt = (x / w - s.trigPos) * s.tdiv * DIVS_X
            setCursors((c) => (c.length >= 2 ? [] : [...c, tt]))
          }}
        />
      </div>
      <div className="readout" aria-live="off">
        <span>{readout || (s.view === 'scope' ? t('Hover for readout, click to place cursors A and B.') : t('Hover for readout.'))}</span>
        {cursorText() && <span className="cursor-text">{cursorText()}</span>}
      </div>
    </div>
  )
}
