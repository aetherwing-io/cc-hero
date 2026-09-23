// Chroma: how much energy each pitch class carries in a window, from a radix-2
// FFT. What tells an Am strum from a C strum when no single pitch stands out.

let cacheN = 0
let cos: Float32Array = new Float32Array(0)
let sin: Float32Array = new Float32Array(0)
let window: Float32Array = new Float32Array(0)

function tables(n: number) {
  if (cacheN === n) return
  cacheN = n
  cos = new Float32Array(n / 2)
  sin = new Float32Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n)
    sin[i] = -Math.sin((2 * Math.PI * i) / n)
  }
  window = new Float32Array(n)
  for (let i = 0; i < n; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
}

/** In-place iterative FFT of `re`/`im` (length a power of two). */
export function fft(re: Float32Array, im: Float32Array) {
  const n = re.length
  tables(n)
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const step = n / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = cos[k * step]!
        const wi = sin[k * step]!
        const a = i + k
        const b = a + len / 2
        const xr = re[b]! * wr - im[b]! * wi
        const xi = re[b]! * wi + im[b]! * wr
        re[b] = re[a]! - xr
        im[b] = im[a]! - xi
        re[a] = re[a]! + xr
        im[a] = im[a]! + xi
      }
    }
  }
}

/**
 * The chroma of a window: energy per pitch class between `minHz` and `maxHz`,
 * C first, scaled so the strongest class is 1. Zeroes for silence.
 */
export function chromaOf(samples: Float32Array, sampleRate: number, minHz = 70, maxHz = 1100): number[] {
  const n = samples.length
  tables(n)
  const re = new Float32Array(n)
  const im = new Float32Array(n)
  for (let i = 0; i < n; i++) re[i] = samples[i]! * window[i]!
  fft(re, im)
  const out = new Array<number>(12).fill(0)
  const lo = Math.max(1, Math.floor((minHz * n) / sampleRate))
  const hi = Math.min(n / 2, Math.ceil((maxHz * n) / sampleRate))
  for (let k = lo; k <= hi; k++) {
    const hz = (k * sampleRate) / n
    const mag = Math.sqrt(re[k]! ** 2 + im[k]! ** 2)
    const pc = ((Math.round(12 * Math.log2(hz / 440) + 69) % 12) + 12) % 12
    // energy, weighted down a little with height so harmonics do not drown the roots
    out[pc]! += (mag * mag) / Math.sqrt(hz / minHz)
  }
  const max = Math.max(...out)
  return max > 0 ? out.map(v => Math.round((v / max) * 100) / 100) : out
}
