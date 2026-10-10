import type { T } from '../i18n'
import { toDbvRms, type Peak } from '../lib/dsp'
import { formatSI } from '../lib/format'
import type { Settings } from '../lib/settings'
import type { ScopeInfo } from './ScopeView'

export default function Measurements({ info, s, t }: { info: ScopeInfo | null; s: Settings; t: T }) {
  const m = info?.meas ?? null
  const chans = [0, 1] as const
  const cell = (c: 0 | 1, f: (i: NonNullable<typeof m>['ch'][0]) => string) => (!s.ch[c].enabled ? '' : m ? f(m.ch[c]) : '—')
  const rows: [string, (c: 0 | 1) => string][] = [
    [t('Frequency'), (c) => cell(c, (x) => (x.freq ? formatSI(x.freq.freq, 'Hz', 4) : '—'))],
    [t('Period'), (c) => cell(c, (x) => (x.freq ? formatSI(x.freq.period, 's', 4) : '—'))],
    [t('Peak-to-peak'), (c) => cell(c, (x) => formatSI(x.stats.vpp, 'V'))],
    [t('Maximum'), (c) => cell(c, (x) => formatSI(x.stats.max, 'V'))],
    [t('Minimum'), (c) => cell(c, (x) => formatSI(x.stats.min, 'V'))],
    [t('Mean (DC)'), (c) => cell(c, (x) => formatSI(x.stats.mean, 'V'))],
    [t('RMS (total)'), (c) => cell(c, (x) => formatSI(x.stats.rms, 'V'))],
    [t('RMS (AC)'), (c) => cell(c, (x) => formatSI(x.stats.acRms, 'V'))],
    [t('Duty cycle'), (c) => cell(c, (x) => (x.freq?.duty != null ? `${(x.freq.duty * 100).toFixed(1)} %` : '—'))],
  ]
  const peak = (p: Peak | null) => (p ? `${formatSI(p.freq, 'Hz', 5)}, ${toDbvRms(p.amp).toFixed(1)} dBV` : '—')
  return (
    <div className="box">
      <h3>{t('Measurements')}</h3>
      <div className="table-scroll">
        <table className="data meas">
          <thead>
            <tr>
              <th />
              <th className="ch1">CH1{m?.ch[0].clipped && s.ch[0].enabled ? ' ⚠' : ''}</th>
              <th className="ch2">CH2{m?.ch[1].clipped && s.ch[1].enabled ? ' ⚠' : ''}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, f]) => (
              <tr key={label}>
                <td>{label}</td>
                {chans.map((c) => (
                  <td key={c}>{f(c)}</td>
                ))}
              </tr>
            ))}
            {s.view === 'fft' && (
              <tr>
                <td>{t('Spectrum peak')}</td>
                {chans.map((c) => (
                  <td key={c}>{s.ch[c].enabled ? peak(info?.peaks[c] ?? null) : ''}</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="hint stats">
        {s.ch[0].enabled && s.ch[1].enabled && <span>{t('Phase CH2 − CH1: {0}', m?.phase != null ? `${m.phase.toFixed(1)}°` : '—')}</span>}
        {s.view === 'fft' && info?.thd != null && <span> {t('THD (harmonics 2–10): {0}', `${(info.thd * 100).toFixed(2)} %`)}</span>}
        {(m?.ch[0].clipped || m?.ch[1].clipped) && <span className="warn-text"> {t('⚠ Input is clipping (full scale reached). Lower the input level.')}</span>}
      </p>
    </div>
  )
}
