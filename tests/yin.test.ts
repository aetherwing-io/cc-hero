import { describe, expect, test, tier } from 'claude-code/testing'
import { rmsOf, yin } from '../listen/yin.ts'

tier('user')

const tone = (hz: number, rate = 22050, n = 2048, harmonics = [1, 0.5, 0.25]) => {
  const buf = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let v = 0
    harmonics.forEach((a, k) => { v += a * Math.sin((2 * Math.PI * hz * (k + 1) * i) / rate) })
    buf[i] = v * 0.3
  }
  return buf
}

describe('yin', () => {
  test('finds the fundamental of each open string', async () => {
    for (const hz of [82.41, 110, 146.83, 196, 246.94, 329.63]) {
      const p = yin(tone(hz), 22050)
      expect(p).toBeDefined()
      expect(Math.abs((p!.hz - hz) / hz)).toBeLessThan(0.01)
      expect(p!.clarity).toBeGreaterThan(0.8)
    }
  })

  test('silence and noise are not pitches', async () => {
    expect(yin(new Float32Array(2048), 22050)).toBe(null)
    const noise = new Float32Array(2048)
    let seed = 7
    for (let i = 0; i < noise.length; i++) { seed = (seed * 16807) % 2147483647; noise[i] = (seed / 2147483647 - 0.5) * 0.5 }
    expect(rmsOf(noise)).toBeGreaterThan(0.1)
    expect(yin(noise, 22050)).toBe(null)
  })
})
