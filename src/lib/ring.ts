/** Fixed-capacity sample history addressed by absolute sample number (total samples ever pushed). */
export class RingBuffer {
  readonly data: Float32Array
  total = 0
  readonly capacity: number
  constructor(capacity: number) {
    this.capacity = capacity
    this.data = new Float32Array(capacity)
  }
  /** Absolute index of the oldest sample still held. */
  get oldest(): number {
    return Math.max(0, this.total - this.capacity)
  }
  push(chunk: ArrayLike<number>): void {
    const cap = this.capacity
    let start = 0
    if (chunk.length > cap) start = chunk.length - cap
    let w = (this.total + start) % cap
    for (let i = start; i < chunk.length; i++) {
      this.data[w] = chunk[i]
      if (++w === cap) w = 0
    }
    this.total += chunk.length
  }
  at(abs: number): number {
    return this.data[((abs % this.capacity) + this.capacity) % this.capacity]
  }
  /** Copies samples [start, start + out.length) into `out`; false if they are not (or no longer) available. */
  copy(start: number, out: Float32Array): boolean {
    const n = out.length
    if (start < this.oldest || start + n > this.total) return false
    let r = start % this.capacity
    for (let i = 0; i < n; i++) {
      out[i] = this.data[r]
      if (++r === this.capacity) r = 0
    }
    return true
  }
  clear(): void {
    this.total = 0
    this.data.fill(0)
  }
}
