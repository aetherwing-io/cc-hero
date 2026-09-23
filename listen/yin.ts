// YIN pitch detection (de Cheveigné & Kawahara, 2002) over one window of mono
// samples: the difference function, its cumulative mean normalised form, the first
// dip under the threshold, and a parabolic touch-up of the lag. No dependencies.

export type Pitch = { hz: number; /** 0..1, 1 is a clean period */ clarity: number }

export function yin(buf: Float32Array, sampleRate: number, opts: { minHz?: number; maxHz?: number; threshold?: number } = {}): Pitch | null {
  const minHz = opts.minHz ?? 60
  const maxHz = opts.maxHz ?? 1400
  const threshold = opts.threshold ?? 0.15
  const n = buf.length
  const maxTau = Math.min(Math.floor(sampleRate / minHz), Math.floor(n / 2))
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz))
  if (maxTau <= minTau) return null
  const half = Math.floor(n / 2)

  const d = new Float32Array(maxTau + 1)
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0
    for (let i = 0; i < half; i++) {
      const delta = (buf[i] ?? 0) - (buf[i + tau] ?? 0)
      sum += delta * delta
    }
    d[tau] = sum
  }

  // cumulative mean normalised difference
  const cmnd = new Float32Array(maxTau + 1)
  cmnd[0] = 1
  let running = 0
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau] ?? 0
    cmnd[tau] = running === 0 ? 1 : ((d[tau] ?? 0) * tau) / running
  }

  // the first lag under the threshold, walked down to its local minimum
  let tau = -1
  for (let t = minTau; t <= maxTau; t++) {
    if ((cmnd[t] ?? 1) < threshold) {
      while (t + 1 <= maxTau && (cmnd[t + 1] ?? 1) < (cmnd[t] ?? 1)) t++
      tau = t
      break
    }
  }
  if (tau === -1) {
    // no dip under the threshold: take the global minimum if it is at least fair
    let bestT = -1
    let bestV = 1
    for (let t = minTau; t <= maxTau; t++) {
      const v = cmnd[t] ?? 1
      if (v < bestV) { bestV = v; bestT = t }
    }
    if (bestT === -1 || bestV > 0.35) return null
    tau = bestT
  }

  // parabolic interpolation around the lag
  const y0 = cmnd[tau - 1] ?? cmnd[tau] ?? 0
  const y1 = cmnd[tau] ?? 0
  const y2 = cmnd[tau + 1] ?? cmnd[tau] ?? 0
  const denom = 2 * (2 * y1 - y0 - y2)
  const shift = denom === 0 ? 0 : (y0 - y2) / denom
  const period = tau + Math.max(-1, Math.min(1, shift))
  return { hz: sampleRate / period, clarity: 1 - Math.max(0, Math.min(1, y1)) }
}

export const rmsOf = (buf: Float32Array): number => {
  let s = 0
  for (let i = 0; i < buf.length; i++) s += (buf[i] ?? 0) ** 2
  return Math.sqrt(s / Math.max(1, buf.length))
}
