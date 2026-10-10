import { useCallback, useEffect, useReducer, useState } from 'react'
import CalibrationPanel from './components/CalibrationPanel'
import { ChannelsPanel, FftPanel, Field, GeneratorPanel, HorizontalPanel, Section, TriggerPanel } from './components/Controls'
import Measurements from './components/Measurements'
import ScopeView, { type Run, type ScopeInfo } from './components/ScopeView'
import { Engine } from './engine'
import { tr, type T } from './i18n'
import { formatSI } from './lib/format'
import { autoset } from './lib/scope'
import { defaultSettings, loadSettings, saveSettings, type Settings, type View } from './lib/settings'

const VIEWS: View[] = ['scope', 'xy', 'fft']

export default function App() {
  const [s, setS] = useState<Settings>(loadSettings)
  const [run, setRun] = useState<Run>('run')
  const [info, setInfo] = useState<ScopeInfo | null>(null)
  const [nonce, setNonce] = useState(0)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [engine] = useState(() => new Engine())
  const t: T = (str, ...a) => tr(s.lang, str, ...a)
  const set = useCallback((p: Partial<Settings>) => setS((prev) => ({ ...prev, ...p })), [])

  useEffect(() => {
    engine.onChange = bump
    return () => {
      engine.onChange = () => {}
    }
  }, [engine])
  useEffect(() => () => engine.dispose(), [engine])
  useEffect(() => saveSettings(s), [s])
  useEffect(() => {
    const root = document.documentElement
    if (s.theme === 'auto') delete root.dataset.theme
    else root.dataset.theme = s.theme
    root.lang = s.lang
    document.title = tr(s.lang, 'Soundcard Oscilloscope') + ': ' + tr(s.lang, 'a free two-channel oscilloscope for your browser')
  }, [s.theme, s.lang])
  useEffect(() => engine.setGenerator(s.gen), [engine, s.gen])

  const refreshDevices = useCallback(() => void engine.listDevices().then(setDevices), [engine])
  useEffect(() => {
    refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices)
  }, [refreshDevices])

  const startInput = async () => {
    await engine.startInput(s.deviceId)
    if (engine.source === 'input') set({ source: 'input' })
    else set({ source: 'demo' })
    refreshDevices()
  }
  const useDemo = () => {
    engine.useDemo()
    set({ source: 'demo' })
  }
  const doAutoset = () => {
    const m = info?.meas
    if (!m) return
    const r = autoset([
      { vpp: s.ch[0].enabled ? m.ch[0].stats.vpp : 0, freq: s.ch[0].enabled ? (m.ch[0].freq?.freq ?? null) : null },
      { vpp: s.ch[1].enabled ? m.ch[1].stats.vpp : 0, freq: s.ch[1].enabled ? (m.ch[1].freq?.freq ?? null) : null },
    ])
    const ch: Settings['ch'] = [
      { ...s.ch[0], vdiv: r.vdiv[0] ?? s.ch[0].vdiv, pos: s.ch[0].enabled && s.ch[1].enabled ? 1.5 : 0 },
      { ...s.ch[1], vdiv: r.vdiv[1] ?? s.ch[1].vdiv, pos: s.ch[0].enabled && s.ch[1].enabled ? -1.5 : 0 },
    ]
    const ts = m.ch[s.trigSource].stats
    set({ ch, tdiv: r.tdiv ?? s.tdiv, trigPos: 0.5, trigLevel: s.ch[s.trigSource].coupling === 'ac' ? 0 : (ts.max + ts.min) / 2 })
    setRun('run')
    setNonce((n) => n + 1)
  }

  const live = engine.source === 'input' && engine.inputRunning
  const status = run === 'stop' ? t('Stopped') : run === 'single' ? (info?.waiting ? t('Single: waiting for trigger') : t('Single')) : info?.triggered ? t('Triggered') : s.trigMode === 'auto' ? t('Auto (free-running)') : t('Waiting for trigger')

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">{t('Soundcard Oscilloscope')}</span>
        <span className="hint">{t('A two-channel oscilloscope, FFT and signal generator using your sound card.')}</span>
        <span className="spacer" />
        <div className="row tools">
          <button className={run === 'run' ? 'primary' : ''} onClick={() => setRun(run === 'run' ? 'stop' : 'run')}>
            {run === 'run' ? t('Stop') : t('Run')}
          </button>
          <button className={run === 'single' ? 'primary' : ''} onClick={() => setRun('single')}>
            {t('Single')}
          </button>
          <button onClick={doAutoset} disabled={!info?.meas}>
            {t('Autoset')}
          </button>
        </div>
      </header>
      <div className="body">
        <aside className="side">
          <div className="panel">
            <Section title={t('Input')} open>
              <div className="seg" role="group" aria-label={t('Signal source')}>
                <button className={s.source === 'demo' || !live ? 'on' : ''} onClick={useDemo}>
                  {t('Demo signal')}
                </button>
                <button className={live ? 'on' : ''} onClick={() => void startInput()} disabled={engine.starting}>
                  {engine.starting ? t('Starting…') : live ? t('Sound card input') : t('Use sound card input')}
                </button>
              </div>
              <Field label={t('Input device')}>
                <select value={s.deviceId} onChange={(e) => set({ deviceId: e.target.value })}>
                  <option value="">{t('Default device')}</option>
                  {devices.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || t('Input {0}', i + 1)}
                    </option>
                  ))}
                </select>
              </Field>
              {live && (
                <p className="hint">
                  {engine.deviceLabel || t('Default device')} · {formatSI(engine.sampleRate, 'Hz', 4)} · {engine.inputChannels >= 2 ? t('2 channels') : t('1 channel (CH2 stays flat)')}
                </p>
              )}
              {!live && <p className="hint">{t('Demo mode: CH1 follows the generator settings and CH2 is the same tone shifted by 90°. Start the sound card input to measure real signals. Audio is processed locally and never leaves your device.')}</p>}
              {engine.error && <p className="err-text" role="alert">{t('Error: {0}', engine.error)}</p>}
              <p className="hint">{t('Keep the input level low: sound card inputs only take about 1 V peak (microphone inputs far less). Never connect mains or high voltages.')}</p>
            </Section>
            <Section title={t('Channels')} open>
              <ChannelsPanel s={s} set={set} t={t} />
            </Section>
            <Section title={t('Horizontal')} open>
              <HorizontalPanel s={s} set={set} t={t} />
            </Section>
            <Section title={t('Trigger')} open>
              <TriggerPanel s={s} set={set} t={t} />
            </Section>
            <Section title={t('FFT')} open={s.view === 'fft'}>
              <FftPanel s={s} set={set} t={t} />
            </Section>
            <Section title={t('Signal generator')}>
              <GeneratorPanel s={s} set={set} t={t} />
            </Section>
            <Section title={t('Calibration')}>
              <CalibrationPanel s={s} set={set} meas={info?.meas ?? null} t={t} />
            </Section>
            <Section title={t('Settings')}>
              <div className="grid2">
                <Field label={t('Language')}>
                  <select value={s.lang} onChange={(e) => set({ lang: e.target.value as Settings['lang'] })}>
                    <option value="en">English</option>
                    <option value="uk">Українська</option>
                  </select>
                </Field>
                <Field label={t('Theme')}>
                  <select value={s.theme} onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}>
                    <option value="auto">{t('System')}</option>
                    <option value="light">{t('Light')}</option>
                    <option value="dark">{t('Dark')}</option>
                  </select>
                </Field>
              </div>
              <button
                onClick={() => {
                  const d = defaultSettings()
                  setS({ ...d, lang: s.lang, theme: s.theme, source: s.source, deviceId: s.deviceId })
                }}
              >
                {t('Reset all controls')}
              </button>
            </Section>
          </div>
        </aside>
        <main className="main">
          <div className="box display">
            <div className="tabs" role="tablist">
              {VIEWS.map((v) => (
                <button key={v} role="tab" aria-selected={s.view === v} className={s.view === v ? 'on' : ''} onClick={() => set({ view: v })}>
                  {v === 'scope' ? t('Scope') : v === 'xy' ? t('XY') : t('FFT')}
                </button>
              ))}
              <span className="spacer" />
              <span className={`badge ${run === 'run' && info?.triggered ? 'ok' : ''}`}>{status}</span>
              <span className="badge">{formatSI(s.tdiv, 's')}/div</span>
              {s.view === 'scope' && <span className="badge">{formatSI(engine.sampleRate, 'Hz', 4)}</span>}
            </div>
            {!live && (
              <div className="banner">
                <span>{t('Showing a built-in demo signal.')}</span>
                <button className="primary" onClick={() => void startInput()} disabled={engine.starting}>
                  {t('Use sound card input')}
                </button>
              </div>
            )}
            <ScopeView engine={engine} s={s} run={run} nonce={nonce} onRun={setRun} onInfo={setInfo} t={t} />
            <div className="legend">
              <span className="ch1">{t('CH1')} {formatSI(s.ch[0].vdiv, 'V')}/div</span>
              <span className="ch2">{t('CH2')} {formatSI(s.ch[1].vdiv, 'V')}/div</span>
            </div>
          </div>
          <Measurements info={info} s={s} t={t} />
        </main>
      </div>
      <p className="hint foot">
        {t('Everything runs in your browser; audio never leaves your device.')}{' '}
        <a href="https://github.com/hermes98761234/soundcard-oscilloscope">{t('Source on GitHub')}</a>
      </p>
    </div>
  )
}
