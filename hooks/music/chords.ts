// Chords: names to pitch classes, shapes for the diagram, and the templates the
// listener's chroma is matched against. Pure.

import { NOTE_NAMES } from './notes.ts'

export type Chord = {
  /** As written: "Am7", "F#m", "Cadd9", "G/B". */
  name: string
  /** Root pitch class, 0 = C. */
  root: number
  /** Pitch classes the chord is made of, root first. */
  pcs: number[]
  /** Bass pitch class of a slash chord, when written. */
  bass?: number
  /** Whether the third is minor: what the listener's triad templates tell apart. */
  minor: boolean
}

const ROOTS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** Intervals for the qualities a chord sheet writes; the first match on the suffix wins. */
const QUALITIES: [RegExp, number[]][] = [
  [/^(maj7|M7|Δ7?)$/, [0, 4, 7, 11]],
  [/^(m7b5|ø7?)$/, [0, 3, 6, 10]],
  [/^(dim7|°7)$/, [0, 3, 6, 9]],
  [/^(dim|°)$/, [0, 3, 6]],
  [/^(aug|\+)$/, [0, 4, 8]],
  [/^(m|min|-)(maj7|M7)$/, [0, 3, 7, 11]],
  [/^(m|min|-)7$/, [0, 3, 7, 10]],
  [/^(m|min|-)9$/, [0, 3, 7, 10, 14]],
  [/^(m|min|-)6$/, [0, 3, 7, 9]],
  [/^(m|min|-)(add9|add2)$/, [0, 3, 7, 14]],
  [/^(m|min|-)$/, [0, 3, 7]],
  [/^7sus4?$/, [0, 5, 7, 10]],
  [/^sus2$/, [0, 2, 7]],
  [/^sus4?$/, [0, 5, 7]],
  [/^(add9|add2|2)$/, [0, 4, 7, 14]],
  [/^6$/, [0, 4, 7, 9]],
  [/^(6\/9|69)$/, [0, 4, 7, 9, 14]],
  [/^9$/, [0, 4, 7, 10, 14]],
  [/^7$/, [0, 4, 7, 10]],
  [/^5$/, [0, 7]],
  [/^(maj|M)?$/, [0, 4, 7]],
]

/** Parses a chord name; null for text that is not one ("N.C.", "x2", a lyric). */
export function parseChord(text: string): Chord | null {
  const m = /^([A-G])([#b♯♭]?)([^/\s]*)(?:\/([A-G])([#b♯♭]?))?$/.exec(text.trim())
  if (!m) return null
  const [, letter, acc, suffix, bassLetter, bassAcc] = m
  const shift = (a: string | undefined) => (a === '#' || a === '♯' ? 1 : a === 'b' || a === '♭' ? -1 : 0)
  const root = ((ROOTS[letter!] ?? 0) + shift(acc) + 12) % 12
  const q = QUALITIES.find(([re]) => re.test(suffix ?? ''))
  if (!q) return null
  const pcs = [...new Set(q[1].map(i => (root + i) % 12))]
  const chord: Chord = { name: text.trim(), root, pcs, minor: q[1][1] === 3 }
  if (bassLetter) chord.bass = ((ROOTS[bassLetter] ?? 0) + shift(bassAcc) + 12) % 12
  return chord
}

export const pcName = (pc: number): string => NOTE_NAMES[((pc % 12) + 12) % 12] ?? '?'

/** A chord shape: frets for strings 6 (low E) to 1 (high e); -1 is a muted string. */
export type Shape = { frets: number[]; base: number }

/** Open-position shapes for the chords most sheets use; anything else gets a barre. */
export const SHAPES: Record<string, number[]> = {
  C: [-1, 3, 2, 0, 1, 0], Cmaj7: [-1, 3, 2, 0, 0, 0], C7: [-1, 3, 2, 3, 1, 0], Cadd9: [-1, 3, 2, 0, 3, 0],
  D: [-1, -1, 0, 2, 3, 2], Dm: [-1, -1, 0, 2, 3, 1], D7: [-1, -1, 0, 2, 1, 2], Dsus4: [-1, -1, 0, 2, 3, 3], Dsus2: [-1, -1, 0, 2, 3, 0], Dm7: [-1, -1, 0, 2, 1, 1],
  E: [0, 2, 2, 1, 0, 0], Em: [0, 2, 2, 0, 0, 0], E7: [0, 2, 0, 1, 0, 0], Em7: [0, 2, 0, 0, 0, 0],
  F: [1, 3, 3, 2, 1, 1], Fmaj7: [-1, -1, 3, 2, 1, 0], Fm: [1, 3, 3, 1, 1, 1],
  G: [3, 2, 0, 0, 0, 3], G7: [3, 2, 0, 0, 0, 1], Gm: [3, 5, 5, 3, 3, 3],
  A: [-1, 0, 2, 2, 2, 0], Am: [-1, 0, 2, 2, 1, 0], A7: [-1, 0, 2, 0, 2, 0], Am7: [-1, 0, 2, 0, 1, 0], Asus2: [-1, 0, 2, 2, 0, 0], Asus4: [-1, 0, 2, 2, 3, 0],
  B7: [-1, 2, 1, 2, 0, 2], Bm: [-1, 2, 4, 4, 3, 2], B: [-1, 2, 4, 4, 4, 2],
  'F#m': [2, 4, 4, 2, 2, 2], 'C#m': [-1, 4, 6, 6, 5, 4], Bb: [-1, 1, 3, 3, 3, 1], 'A#': [-1, 1, 3, 3, 3, 1], Eb: [-1, 6, 8, 8, 8, 6], Ab: [4, 6, 6, 5, 4, 4],
}

/** The shape to draw for a chord: its open shape, or an E- or A-form barre at its root. */
/** The first fret a diagram shows: 1 while the shape fits the first four frets, else its lowest fretted fret. */
export const baseOf = (frets: readonly number[]): number => {
  const fretted = frets.filter(f => f > 0)
  if (fretted.length === 0) return 1
  return Math.max(...fretted) <= 4 ? 1 : Math.min(...fretted)
}

export function shapeOf(chord: Chord): Shape {
  const known = SHAPES[chord.name]
  if (known) return { frets: known, base: baseOf(known) }
  // barre: the root on string 6 (E form) if it sits at fret 1..7, else on string 5 (A form)
  const eFret = (chord.root - 4 + 12) % 12
  const aFret = (chord.root - 9 + 12) % 12
  const suffix = chord.minor ? 'm' : ''
  const seventh = chord.pcs.includes((chord.root + 10) % 12)
  if (eFret >= 1 && eFret <= 7) {
    const f = eFret
    const form = suffix === 'm' ? [f, f + 2, f + 2, f, f, f] : [f, f + 2, f + 2, f + 1, f, f]
    if (seventh) form[3] = f
    return { frets: form, base: f }
  }
  const f = aFret === 0 ? 12 : aFret
  const form = suffix === 'm' ? [-1, f, f + 2, f + 2, f + 1, f] : [-1, f, f + 2, f + 2, f + 2, f]
  if (seventh) form[3] = f
  return { frets: form, base: f }
}

/** Frets as a chords page lists them, string 1 first, to the shape's string 6 first. */
export const shapeFromHighFirst = (frets: readonly number[]): Shape => {
  const low = [...frets].reverse()
  return { frets: low, base: baseOf(low) }
}

/** A 12-vector with the chord's tones at 1 (the root a little stronger), for chroma matching. */
export function templateOf(pcs: readonly number[]): number[] {
  const t = new Array<number>(12).fill(0)
  pcs.forEach((pc, i) => { t[pc] = i === 0 ? 1.2 : 1 })
  return t
}

/** Cosine similarity of a chroma vector to a chord's template, 0..1. */
export function chromaMatch(chroma: readonly number[], pcs: readonly number[]): number {
  const t = templateOf(pcs)
  let dot = 0
  let a = 0
  let b = 0
  for (let i = 0; i < 12; i++) {
    const c = chroma[i] ?? 0
    dot += c * (t[i] ?? 0)
    a += c * c
    b += (t[i] ?? 0) ** 2
  }
  return a === 0 || b === 0 ? 0 : dot / Math.sqrt(a * b)
}

/** The 48 triad and seventh templates the listener names what it hears with. */
export const DETECT_TEMPLATES: { name: string; pcs: number[] }[] = []
for (let root = 0; root < 12; root++) {
  const n = pcName(root)
  DETECT_TEMPLATES.push({ name: n, pcs: [root, (root + 4) % 12, (root + 7) % 12] })
  DETECT_TEMPLATES.push({ name: `${n}m`, pcs: [root, (root + 3) % 12, (root + 7) % 12] })
  DETECT_TEMPLATES.push({ name: `${n}7`, pcs: [root, (root + 4) % 12, (root + 7) % 12, (root + 10) % 12] })
  DETECT_TEMPLATES.push({ name: `${n}m7`, pcs: [root, (root + 3) % 12, (root + 7) % 12, (root + 10) % 12] })
}

export function bestChord(chroma: readonly number[]): { name: string; score: number } | null {
  let best: { name: string; score: number } | null = null
  for (const t of DETECT_TEMPLATES) {
    const score = chromaMatch(chroma, t.pcs)
    if (!best || score > best.score) best = { name: t.name, score }
  }
  return best
}
