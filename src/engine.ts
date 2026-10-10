import { RingBuffer } from './lib/ring'
import type { GenSettings } from './lib/settings'
import { noise, waveValue } from './lib/wave'

export const DEMO_RATE = 48000
const HISTORY_SECONDS = 8

const WORKLET = `
class ScopeCapture extends AudioWorkletProcessor {
  constructor() { super(); this.n = 0; this.a = new Float32Array(1024); this.b = new Float32Array(1024) }
  process(inputs) {
    const inp = inputs[0]
    if (!inp || inp.length === 0) return true
    const l = inp[0], r = inp[1]
    for (let i = 0; i < l.length; i++) {
      this.a[this.n] = l[i]
      this.b[this.n] = r ? r[i] : 0
      if (++this.n === 1024) {
        this.port.postMessage([this.a, this.b], [this.a.buffer, this.b.buffer])
        this.a = new Float32Array(1024); this.b = new Float32Array(1024); this.n = 0
      }
    }
    return true
  }
}
registerProcessor('scope-capture', ScopeCapture)
`

export type Source = 'demo' | 'input'

/** Owns the sample history, the Web Audio graph (input capture + generator output) and the built-in demo signal. */
export class Engine {
  source: Source = 'demo'
  sampleRate = DEMO_RATE
  rings: [RingBuffer, RingBuffer] = Engine.makeRings(DEMO_RATE)
  /** Channels delivered by the input device (1 means CH2 is silent). */
  inputChannels = 2
  error: string | null = null
  starting = false
  deviceLabel = ''
  onChange: () => void = () => {}

  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private capture: AudioWorkletNode | null = null
  private mute: GainNode | null = null
  private micSource: MediaStreamAudioSourceNode | null = null
  private osc: OscillatorNode | null = null
  private noiseSrc: AudioBufferSourceNode | null = null
  private genGain: GainNode | null = null
  private merger: ChannelMergerNode | null = null
  private gen: GenSettings = { on: false, wave: 'sine', freq: 1000, amp: 0.4, out: 'both' }
  private demoLast = 0
  private demoPhase = 0
  private demoCarry = 0
  private workletReady = false

  static makeRings(sr: number): [RingBuffer, RingBuffer] {
    const cap = Math.ceil(sr * HISTORY_SECONDS)
    return [new RingBuffer(cap), new RingBuffer(cap)]
  }

  get inputRunning(): boolean {
    return this.source === 'input' && this.capture !== null
  }

  private reset(sr: number): void {
    this.sampleRate = sr
    this.rings = Engine.makeRings(sr)
    this.demoLast = 0
    this.demoCarry = 0
  }

  useDemo(): void {
    this.stopInput()
    this.source = 'demo'
    this.error = null
    this.reset(DEMO_RATE)
    this.onChange()
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor({ latencyHint: 'interactive' })
    }
    return this.ctx
  }

  async listDevices(): Promise<MediaDeviceInfo[]> {
    try {
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
    } catch {
      return []
    }
  }

  async startInput(deviceId: string): Promise<void> {
    if (this.starting) return
    this.starting = true
    this.error = null
    this.onChange()
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia is not available (needs HTTPS and a modern browser)')
      this.stopInput()
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: { ideal: 2 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      const ctx = this.ensureCtx()
      if (ctx.state === 'suspended') await ctx.resume()
      if (!this.workletReady) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
        try {
          await ctx.audioWorklet.addModule(url)
        } finally {
          URL.revokeObjectURL(url)
        }
        this.workletReady = true
      }
      this.stream = stream
      const track = stream.getAudioTracks()[0]
      this.deviceLabel = track?.label ?? ''
      this.inputChannels = track?.getSettings().channelCount ?? 2
      this.source = 'input'
      this.reset(ctx.sampleRate)
      const node = new AudioWorkletNode(ctx, 'scope-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
      })
      node.port.onmessage = (e: MessageEvent<[Float32Array, Float32Array]>) => {
        this.rings[0].push(e.data[0])
        this.rings[1].push(e.data[1])
      }
      const mute = ctx.createGain()
      mute.gain.value = 0
      const src = ctx.createMediaStreamSource(stream)
      src.connect(node)
      node.connect(mute).connect(ctx.destination)
      this.capture = node
      this.mute = mute
      this.micSource = src
      track?.addEventListener('ended', () => {
        this.error = 'The input device was disconnected.'
        this.useDemo()
      })
      this.applyGenerator()
    } catch (e) {
      this.stopInput()
      this.source = 'demo'
      this.reset(DEMO_RATE)
      this.error = e instanceof Error ? e.message : String(e)
    } finally {
      this.starting = false
      this.onChange()
    }
  }

  stopInput(): void {
    this.capture?.port.close()
    this.capture?.disconnect()
    this.mute?.disconnect()
    this.micSource?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.capture = this.mute = this.micSource = null
    this.stream = null
  }

  /** Applies generator settings to the audio output (a user gesture is needed the first time it is switched on). */
  setGenerator(g: GenSettings): void {
    this.gen = g
    this.applyGenerator()
  }

  private applyGenerator(): void {
    const g = this.gen
    if (!g.on && !this.genGain) return
    try {
      const ctx = this.ensureCtx()
      if (g.on && ctx.state === 'suspended') void ctx.resume()
      if (!this.genGain) {
        this.genGain = ctx.createGain()
        this.genGain.gain.value = 0
        this.merger = ctx.createChannelMerger(2)
        this.merger.connect(ctx.destination)
      }
      const gain = this.genGain
      if (g.wave === 'noise') {
        this.stopOsc()
        if (!this.noiseSrc) {
          const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
          const d = buf.getChannelData(0)
          for (let i = 0; i < d.length; i++) d[i] = Math.max(-1, Math.min(1, noise() * 0.5))
          this.noiseSrc = ctx.createBufferSource()
          this.noiseSrc.buffer = buf
          this.noiseSrc.loop = true
          this.noiseSrc.connect(gain)
          this.noiseSrc.start()
        }
      } else {
        this.stopNoise()
        if (!this.osc) {
          this.osc = ctx.createOscillator()
          this.osc.connect(gain)
          this.osc.start()
        }
        this.osc.type = g.wave
        this.osc.frequency.setTargetAtTime(g.freq, ctx.currentTime, 0.005)
      }
      gain.disconnect()
      const m = this.merger!
      if (g.out !== 'right') gain.connect(m, 0, 0)
      if (g.out !== 'left') gain.connect(m, 0, 1)
      gain.gain.setTargetAtTime(g.on ? g.amp : 0, ctx.currentTime, 0.01)
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
      this.onChange()
    }
  }

  private stopOsc(): void {
    this.osc?.stop()
    this.osc?.disconnect()
    this.osc = null
  }
  private stopNoise(): void {
    this.noiseSrc?.stop()
    this.noiseSrc?.disconnect()
    this.noiseSrc = null
  }

  /** Advances the demo signal to wall-clock `now` (ms). Call every frame; does nothing for a real input. */
  tick(now: number): void {
    if (this.source !== 'demo') return
    if (this.demoLast === 0) this.demoLast = now
    let n = ((now - this.demoLast) * DEMO_RATE) / 1000 + this.demoCarry
    this.demoLast = now
    n = Math.min(n, DEMO_RATE / 4)
    const count = Math.floor(n)
    this.demoCarry = n - count
    if (count <= 0) return
    const a = new Float32Array(count)
    const b = new Float32Array(count)
    const g = this.gen
    const dPhase = g.freq / DEMO_RATE
    for (let i = 0; i < count; i++) {
      const p = this.demoPhase
      const first = g.wave === 'noise' ? noise() * 0.3 : waveValue(g.wave, p)
      a[i] = g.amp * first + 0.003 * noise()
      b[i] = g.amp * 0.6 * waveValue('sine', p - 0.25) + 0.003 * noise()
      this.demoPhase += dPhase
      this.demoPhase -= Math.floor(this.demoPhase)
    }
    this.rings[0].push(a)
    this.rings[1].push(b)
  }

  dispose(): void {
    this.stopInput()
    this.stopOsc()
    this.stopNoise()
    void this.ctx?.close()
    this.ctx = null
  }
}
