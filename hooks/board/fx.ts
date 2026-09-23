// Effects on the cell grid: particles that fly and fade, a screen shake, a beat
// pulse, and a three-row block font for the words that deserve it. Pure state
// machines over time; the board spawns and draws them each frame.

export type Particle = { x: number; y: number; vx: number; vy: number; born: number; life: number; glyph: string; color: string; gravity: number }

export type Fx = { particles: Particle[]; shakeUntil: number; finale?: { until: number; word: string; nextSpawn: number } }

export const newFx = (): Fx => ({ particles: [], shakeUntil: 0 })

const SPARKS = ['✦', '✧', '·', '˙', '⋆', '*']
const RING = ['○', '◦', '∘']
export const PURPLE = ['magentaBright', 'magenta', 'blueBright', 'cyanBright', 'white']

/** Sparks flying out of a point: `n` of them, spread all round, faster ones shorter lived. */
export function burst(fx: Fx, x: number, y: number, n: number, colors: readonly string[], now: number, opts: { speed?: number; life?: number; glyphs?: readonly string[]; gravity?: number } = {}) {
  const speed = opts.speed ?? 14
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.6
    const v = speed * (0.5 + Math.random() * 0.8)
    fx.particles.push({ x, y, vx: Math.cos(a) * v * 2, vy: Math.sin(a) * v * 0.5, born: now, life: (opts.life ?? 450) * (0.7 + Math.random() * 0.6), glyph: (opts.glyphs ?? SPARKS)[Math.floor(Math.random() * (opts.glyphs ?? SPARKS).length)]!, color: colors[Math.floor(Math.random() * colors.length)]!, gravity: opts.gravity ?? 6 })
  }
}

/** A ring of dots spreading out from a point: a shockwave. */
export function ring(fx: Fx, x: number, y: number, color: string, now: number, radius = 22) {
  const n = 18
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    fx.particles.push({ x, y, vx: Math.cos(a) * radius * 2, vy: Math.sin(a) * radius * 0.45, born: now, life: 500, glyph: RING[i % RING.length]!, color, gravity: 0 })
  }
}

/** The end of a run: a purple explosion that keeps coming for a moment, with a word over it. */
export function finale(fx: Fx, word: string, now: number, columns = 80, rows = 20) {
  fx.finale = { until: now + 2800, word, nextSpawn: now }
  // the first blast from the middle, then the shower step() keeps up
  const cx = columns / 2
  const cy = rows / 2
  burst(fx, cx, cy, 48, PURPLE, now, { speed: 22, life: 1100, gravity: 2, glyphs: ['✦', '✺', '✧', '⋆', '*', '✹'] })
  ring(fx, cx, cy, 'magentaBright', now, 30)
  ring(fx, cx, cy, 'cyanBright', now, 18)
}

/** Moves every particle on by `dtMs`, drops the dead, feeds a finale; call once a frame. */
export function step(fx: Fx, now: number, dtMs: number, columns: number, rows: number) {
  const dt = dtMs / 1000
  fx.particles = fx.particles.filter(p => now - p.born < p.life)
  for (const p of fx.particles) {
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.vy += p.gravity * dt
    p.vx *= 0.97
  }
  const f = fx.finale
  if (f) {
    if (now > f.until) fx.finale = undefined
    else if (now >= f.nextSpawn && now < f.until - 900) {
      f.nextSpawn = now + 60
      burst(fx, 2 + Math.random() * (columns - 4), 1 + Math.random() * Math.max(1, rows - 3), 8, PURPLE, now, { speed: 12, life: 1000, gravity: 2, glyphs: ['✦', '✧', '⋆', '*', '·', '✺'] })
    }
  }
}

export type Cell = { g: string; c?: string; b?: string; bold?: boolean; dim?: boolean; inv?: boolean }

/** Draws the live particles over a grid; the young ones bold, the old ones dim. */
export function drawParticles(fx: Fx, now: number, put: (x: number, y: number, cell: Cell) => void, top: number, bottom: number) {
  for (const p of fx.particles) {
    const age = (now - p.born) / p.life
    const x = Math.round(p.x)
    const y = Math.round(p.y)
    if (y < top || y >= bottom) continue
    put(x, y, { g: age > 0.75 ? '·' : p.glyph, c: p.color, bold: age < 0.35, dim: age > 0.6 })
  }
}

/** A one-column shake for a few frames: which way this frame leans, or 0. */
export const shakeOf = (fx: Fx, now: number, frame: number): number => (now < fx.shakeUntil ? (frame % 2 ? 1 : -1) : 0)

/** Rows of cells shifted one column, the way a shaken screen looks. */
export function shaken<T>(row: T[], shift: number, blank: T): T[] {
  if (shift > 0) return [blank, ...row.slice(0, -1)]
  if (shift < 0) return [...row.slice(1), blank]
  return row
}

// a three-row block font for a handful of words: each glyph three cells wide
const FONT: Record<string, [string, string, string]> = {
  A: ['▄▀▄', '█▀█', '▀ ▀'], B: ['█▀▄', '█▀▄', '▀▀ '], C: ['▄▀▀', '█  ', '▀▀▀'], D: ['█▀▄', '█ █', '▀▀ '], E: ['█▀▀', '█▀ ', '▀▀▀'],
  F: ['█▀▀', '█▀ ', '▀  '], G: ['▄▀▀', '█ ▄', '▀▀▀'], H: ['█ █', '█▀█', '▀ ▀'], I: ['▀█▀', ' █ ', '▀▀▀'], K: ['█ ▄', '█▀▄', '▀ ▀'],
  L: ['█  ', '█  ', '▀▀▀'], M: ['█▄█', '█ █', '▀ ▀'], N: ['█▄█', '█ █', '▀ ▀'], O: ['▄▀▄', '█ █', '▀▀▀'], P: ['█▀▄', '█▀ ', '▀  '],
  R: ['█▀▄', '█▀▄', '▀ ▀'], S: ['▄▀▀', '▀▀▄', '▀▀ '], T: ['▀█▀', ' █ ', ' ▀ '], U: ['█ █', '█ █', '▀▀▀'], W: ['█ █', '█▄█', '▀ ▀'],
  X: ['▀▄▀', ' █ ', '▀ ▀'], Y: ['▀▄▀', ' █ ', ' ▀ '], '2': ['▀▀▄', '▄▀ ', '▀▀▀'], '3': ['▀▀▄', ' ▀▄', '▀▀ '], '4': ['█ █', '▀▀█', '  ▀'],
  '!': [' █ ', ' █ ', ' ▄ '], '×': ['   ', '▀▄▀', '▀ ▀'], ' ': ['   ', '   ', '   '],
}

/** A word in the block font: three strings, or null for a word with a glyph the font lacks. */
export function blockWord(word: string): [string, string, string] | null {
  const rows: [string, string, string] = ['', '', '']
  for (const ch of word.toUpperCase()) {
    const g = FONT[ch]
    if (!g) return null
    rows[0] += g[0] + ' '
    rows[1] += g[1] + ' '
    rows[2] += g[2] + ' '
  }
  return rows
}
