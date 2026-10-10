import type { AcqConfig, ChanProc } from './acquire'
import { channelScale, windowSamples, type Settings } from './settings'

export const procOf = (s: Settings): [ChanProc, ChanProc] =>
  [0, 1].map((i) => ({ scale: channelScale(s.ch[i]), offset: s.ch[i].offset, ac: s.ch[i].coupling === 'ac' })) as [ChanProc, ChanProc]

/** Acquisition parameters for the current front-panel settings. */
export function acqConfig(s: Settings, sr: number): AcqConfig {
  const window = windowSamples(s.tdiv, sr)
  return {
    sampleRate: sr,
    window,
    pre: Math.round(window * s.trigPos),
    trigSource: s.trigSource,
    level: s.trigLevel,
    slope: s.trigSlope,
    hyst: s.ch[s.trigSource].vdiv * 0.1,
    chans: procOf(s),
  }
}
