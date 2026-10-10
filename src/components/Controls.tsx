import type { ReactNode } from 'react'
import type { T } from '../i18n'
import type { Slope, TriggerMode } from '../lib/acquire'
import { WINDOWS } from '../lib/dsp'
import { formatSI, nearestIndex, TIMEBASES, VOLTS_DIV } from '../lib/format'
import type { ChannelSettings, Settings } from '../lib/settings'
import { WAVES } from '../lib/wave'

export function Section({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="section" open={open}>
      <summary>{title}</summary>
      <div className="section-body">{children}</div>
    </details>
  )
}

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? 'field wide' : 'field'}>
      <span>{label}</span>
      {children}
    </label>
  )
}

/** Number input that keeps its own text while typing and commits valid numbers. */
export function NumInput({ value, onChange, min, max, step, disabled }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number | 'any'; disabled?: boolean }) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? Number(value.toPrecision(8)) : ''}
      min={min}
      max={max}
      step={step ?? 'any'}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.valueAsNumber
        if (Number.isFinite(v)) onChange(min !== undefined && max !== undefined ? Math.min(max, Math.max(min, v)) : v)
      }}
    />
  )
}

interface PanelProps {
  s: Settings
  set: (patch: Partial<Settings>) => void
  t: T
}

const voltsLabel = (v: number) => formatSI(v, 'V') + '/div'
const timeLabel = (v: number) => formatSI(v, 's') + '/div'

function ChannelCard({ i, c, onChange, t }: { i: 0 | 1; c: ChannelSettings; onChange: (p: Partial<ChannelSettings>) => void; t: T }) {
  const idx = nearestIndex(VOLTS_DIV, c.vdiv)
  return (
    <div className={`card ch${i + 1}`}>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={c.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
          <strong className="chname">{t('CH{0}', i + 1)}</strong>
        </label>
        <span className="spacer" />
        <button className="small" onClick={() => onChange({ vdiv: VOLTS_DIV[Math.min(VOLTS_DIV.length - 1, idx + 1)] })} aria-label={t('Less sensitive')}>
          −
        </button>
        <strong className="val">{voltsLabel(c.vdiv)}</strong>
        <button className="small" onClick={() => onChange({ vdiv: VOLTS_DIV[Math.max(0, idx - 1)] })} aria-label={t('More sensitive')}>
          +
        </button>
      </div>
      <div className="grid3">
        <Field label={t('Coupling')}>
          <select value={c.coupling} onChange={(e) => onChange({ coupling: e.target.value as 'dc' | 'ac' })}>
            <option value="dc">DC</option>
            <option value="ac">AC</option>
          </select>
        </Field>
        <Field label={t('Probe')}>
          <select value={c.probe} onChange={(e) => onChange({ probe: Number(e.target.value) })}>
            <option value={1}>×1</option>
            <option value={10}>×10</option>
            <option value={100}>×100</option>
          </select>
        </Field>
        <label className="check inv">
          <input type="checkbox" checked={c.invert} onChange={(e) => onChange({ invert: e.target.checked })} />
          <span>{t('Invert')}</span>
        </label>
      </div>
      <Field label={t('Position')}>
        <input type="range" min={-4} max={4} step={0.05} value={c.pos} onChange={(e) => onChange({ pos: Number(e.target.value) })} onDoubleClick={() => onChange({ pos: 0 })} />
      </Field>
    </div>
  )
}

export function ChannelsPanel({ s, set, t }: PanelProps) {
  const upd = (i: 0 | 1) => (p: Partial<ChannelSettings>) => set({ ch: i === 0 ? [{ ...s.ch[0], ...p }, s.ch[1]] : [s.ch[0], { ...s.ch[1], ...p }] })
  return (
    <>
      <ChannelCard i={0} c={s.ch[0]} onChange={upd(0)} t={t} />
      <ChannelCard i={1} c={s.ch[1]} onChange={upd(1)} t={t} />
    </>
  )
}

export function HorizontalPanel({ s, set, t }: PanelProps) {
  const idx = nearestIndex(TIMEBASES, s.tdiv)
  return (
    <>
      <div className="row">
        <span>{t('Time/div')}</span>
        <span className="spacer" />
        <button className="small" onClick={() => set({ tdiv: TIMEBASES[Math.min(TIMEBASES.length - 1, idx + 1)] })} aria-label={t('Slower')}>
          −
        </button>
        <strong className="val">{timeLabel(s.tdiv)}</strong>
        <button className="small" onClick={() => set({ tdiv: TIMEBASES[Math.max(0, idx - 1)] })} aria-label={t('Faster')}>
          +
        </button>
      </div>
      <Field label={t('Trigger position')}>
        <input type="range" min={0.05} max={0.95} step={0.01} value={s.trigPos} onChange={(e) => set({ trigPos: Number(e.target.value) })} onDoubleClick={() => set({ trigPos: 0.5 })} />
      </Field>
    </>
  )
}

export function TriggerPanel({ s, set, t }: PanelProps) {
  const vdiv = s.ch[s.trigSource].vdiv
  return (
    <>
      <div className="grid3">
        <Field label={t('Source')}>
          <select value={s.trigSource} onChange={(e) => set({ trigSource: Number(e.target.value) as 0 | 1 })}>
            <option value={0}>CH1</option>
            <option value={1}>CH2</option>
          </select>
        </Field>
        <Field label={t('Slope')}>
          <select value={s.trigSlope} onChange={(e) => set({ trigSlope: e.target.value as Slope })}>
            <option value="rising">{t('Rising')}</option>
            <option value="falling">{t('Falling')}</option>
          </select>
        </Field>
        <Field label={t('Mode')}>
          <select value={s.trigMode} onChange={(e) => set({ trigMode: e.target.value as TriggerMode })}>
            <option value="auto">{t('Auto')}</option>
            <option value="normal">{t('Normal')}</option>
          </select>
        </Field>
      </div>
      <Field label={t('Level: {0}', formatSI(s.trigLevel, 'V'))}>
        <input
          type="range"
          min={-4}
          max={4}
          step={0.02}
          value={Math.max(-4, Math.min(4, s.trigLevel / vdiv))}
          onChange={(e) => set({ trigLevel: Number(e.target.value) * vdiv })}
          onDoubleClick={() => set({ trigLevel: 0 })}
        />
      </Field>
    </>
  )
}

export function FftPanel({ s, set, t }: PanelProps) {
  const f = s.fft
  const upd = (p: Partial<typeof f>) => set({ fft: { ...f, ...p } })
  return (
    <>
      <div className="grid2">
        <Field label={t('Size')}>
          <select value={f.size} onChange={(e) => upd({ size: Number(e.target.value) })}>
            {[1024, 2048, 4096, 8192, 16384, 32768].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Window')}>
          <select value={f.window} onChange={(e) => upd({ window: e.target.value as typeof f.window })}>
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {t(w === 'rect' ? 'Rectangular' : w === 'hann' ? 'Hann' : w === 'hamming' ? 'Hamming' : w === 'blackman' ? 'Blackman' : 'Flat top')}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Frequency axis')}>
          <select value={f.scale} onChange={(e) => upd({ scale: e.target.value as 'log' | 'lin' })}>
            <option value="log">{t('Logarithmic')}</option>
            <option value="lin">{t('Linear')}</option>
          </select>
        </Field>
        <Field label={t('Level axis')}>
          <select value={f.unit} onChange={(e) => upd({ unit: e.target.value as 'dbv' | 'v' })}>
            <option value="dbv">dBV (RMS)</option>
            <option value="v">{t('Volts (peak)')}</option>
          </select>
        </Field>
        <Field label={t('Max frequency')}>
          <select value={f.fmax} onChange={(e) => upd({ fmax: Number(e.target.value) })}>
            <option value={0}>{t('Nyquist')}</option>
            {[20000, 10000, 5000, 2000, 1000, 500].map((n) => (
              <option key={n} value={n}>
                {formatSI(n, 'Hz', 2)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Averaging')}>
          <select value={f.avg} onChange={(e) => upd({ avg: Number(e.target.value) })}>
            <option value={0}>{t('Off')}</option>
            <option value={0.5}>{t('Light')}</option>
            <option value={0.8}>{t('Medium')}</option>
            <option value={0.9}>{t('Heavy')}</option>
          </select>
        </Field>
      </div>
    </>
  )
}

export function GeneratorPanel({ s, set, t }: PanelProps) {
  const g = s.gen
  const upd = (p: Partial<typeof g>) => set({ gen: { ...g, ...p } })
  return (
    <>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={g.on} onChange={(e) => upd({ on: e.target.checked })} />
          <strong>{t('Output on')}</strong>
        </label>
      </div>
      <div className="grid2">
        <Field label={t('Waveform')}>
          <select value={g.wave} onChange={(e) => upd({ wave: e.target.value as typeof g.wave })}>
            {WAVES.map((w) => (
              <option key={w} value={w}>
                {t(w === 'sine' ? 'Sine' : w === 'square' ? 'Square' : w === 'triangle' ? 'Triangle' : w === 'sawtooth' ? 'Sawtooth' : 'Noise')}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Output channel')}>
          <select value={g.out} onChange={(e) => upd({ out: e.target.value as typeof g.out })}>
            <option value="both">{t('Left + right')}</option>
            <option value="left">{t('Left')}</option>
            <option value="right">{t('Right')}</option>
          </select>
        </Field>
        <Field label={t('Frequency (Hz)')}>
          <NumInput value={g.freq} min={1} max={24000} onChange={(v) => upd({ freq: v })} disabled={g.wave === 'noise'} />
        </Field>
        <Field label={t('Amplitude: {0}%', Math.round(g.amp * 100))}>
          <input type="range" min={0} max={1} step={0.01} value={g.amp} onChange={(e) => upd({ amp: Number(e.target.value) })} />
        </Field>
      </div>
      <p className="hint">{t('Connect the sound card output to its input (or hold a speaker near the microphone) to see the generator on the scope. In demo mode CH1 follows these settings.')}</p>
    </>
  )
}
