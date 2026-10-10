import { useState } from 'react'
import type { T } from '../i18n'
import { calibrateScale } from '../lib/scope'
import { defaultChannel, type ChannelSettings, type Settings } from '../lib/settings'
import type { Measurements } from '../lib/measure'
import { Field, NumInput } from './Controls'

interface Props {
  s: Settings
  set: (p: Partial<Settings>) => void
  meas: Measurements | null
  t: T
}

export default function CalibrationPanel({ s, set, meas, t }: Props) {
  const [known, setKnown] = useState([1, 1])
  const [kind, setKind] = useState<'vpp' | 'vrms'>('vpp')
  const [msg, setMsg] = useState('')
  const upd = (i: 0 | 1, p: Partial<ChannelSettings>) => set({ ch: i === 0 ? [{ ...s.ch[0], ...p }, s.ch[1]] : [s.ch[0], { ...s.ch[1], ...p }] })
  const calibrate = (i: 0 | 1) => {
    const m = meas?.ch[i].stats
    if (!m) return
    const measured = kind === 'vpp' ? m.vpp : m.acRms
    const next = calibrateScale(s.ch[i].fsVolts, measured, known[i])
    if (next === null) setMsg(t('Nothing to calibrate against: no signal measured on CH{0}.', i + 1))
    else {
      upd(i, { fsVolts: next })
      setMsg(t('CH{0}: full scale is now {1} V.', i + 1, Number(next.toPrecision(5))))
    }
  }
  const zero = (i: 0 | 1) => {
    const m = meas?.ch[i].stats
    if (m) upd(i, { offset: s.ch[i].offset - m.mean })
  }
  return (
    <>
      <p className="hint">{t('Sound cards are AC-coupled and read in digital full-scale units, so voltages are only as accurate as this calibration. Feed a known signal, enter its amplitude and press Calibrate. For anything above the card’s input range use a divider or a ×10 probe.')}</p>
      <Field label={t('Known amplitude is')}>
        <select value={kind} onChange={(e) => setKind(e.target.value as 'vpp' | 'vrms')}>
          <option value="vpp">{t('Peak-to-peak (V)')}</option>
          <option value="vrms">{t('RMS, AC (V)')}</option>
        </select>
      </Field>
      {([0, 1] as const).map((i) => (
        <div key={i} className={`card ch${i + 1}`}>
          <strong className="chname">{t('CH{0}', i + 1)}</strong>
          <div className="grid2">
            <Field label={t('Full scale (V)')}>
              <NumInput value={s.ch[i].fsVolts} min={0.000001} max={1000000} onChange={(v) => upd(i, { fsVolts: v })} />
            </Field>
            <Field label={t('Offset (V)')}>
              <NumInput value={s.ch[i].offset} min={-1000} max={1000} onChange={(v) => upd(i, { offset: v })} />
            </Field>
            <Field label={t('Reference (V)')}>
              <NumInput value={known[i]} min={0.000001} max={1000000} onChange={(v) => setKnown(i === 0 ? [v, known[1]] : [known[0], v])} />
            </Field>
          </div>
          <div className="row">
            <button onClick={() => calibrate(i)} disabled={!meas}>
              {t('Calibrate')}
            </button>
            <button onClick={() => zero(i)} disabled={!meas}>
              {t('Zero offset')}
            </button>
            <button onClick={() => upd(i, { fsVolts: defaultChannel(0).fsVolts, offset: 0 })}>{t('Reset')}</button>
          </div>
        </div>
      ))}
      {msg && <p className="hint" role="status">{msg}</p>}
    </>
  )
}
