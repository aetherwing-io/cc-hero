// Exercises the mod makes up: chord progressions in a key, fingerpicking
// patterns over them, scale boxes, and the five CAGED forms of a chord. Each
// comes out as a song the board already knows how to draw and judge. Pure.

import { parseChord, pcName, shapeOf, type Chord } from './chords.ts'
import { STANDARD_TUNING } from './notes.ts'
import type { ChordSheetEvent, ChordSong, Song, SongNote } from './song.ts'

// ---- keys and progressions ----

/** Numerals count from the key's root up the major scale, as chord charts do; a flat lowers one. */
const MAJOR_DEGREES = [0, 2, 4, 5, 7, 9, 11]

const NUMERALS: Record<string, number> = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 }

/** Chord names most players spell with flats rather than sharps. */
const FLAT_ROOTS: Record<number, string> = { 1: 'Db', 3: 'Eb', 6: 'Gb', 8: 'Ab', 10: 'Bb' }
export const rootName = (pc: number, preferFlats = false): string => (preferFlats && FLAT_ROOTS[pc]) || pcName(pc)

export type Key = { root: number; minor: boolean; name: string }

export function parseKey(text: string): Key | null {
  const m = /^([A-G])([#b]?)(m|min|minor)?$/i.exec(text.trim())
  if (!m) return null
  const c = parseChord(`${m[1]!.toUpperCase()}${m[2] ?? ''}${m[3] ? 'm' : ''}`)
  if (!c) return null
  return { root: c.root, minor: !!m[3], name: `${rootName(c.root, (m[2] ?? '') === 'b')}${m[3] ? 'm' : ''}` }
}

/**
 * A roman numeral (I, ii, V7, bVII, vii°) or a chord name, resolved in a key:
 * uppercase is major, lowercase minor, a bare vii in a major key diminished.
 */
export function chordInKey(token: string, key: Key): string | null {
  const m = /^(b|#)?(vii|vi|iv|v|iii|ii|i)(°|dim|7|maj7|m7|sus4|sus2)?$/i.exec(token)
  if (!m) return parseChord(token) ? token : null
  const [, acc, numeral, ext = ''] = m
  const degree = NUMERALS[numeral!.toLowerCase()] ?? 0
  const pc = (key.root + (MAJOR_DEGREES[degree] ?? 0) + (acc === 'b' ? -1 : acc === '#' ? 1 : 0) + 24) % 12
  const upper = numeral === numeral!.toUpperCase()
  let quality = upper ? '' : 'm'
  if (!upper && degree === 6 && !acc && !key.minor && !ext) quality = 'dim'
  if (ext === '°' || ext === 'dim') quality = 'dim'
  else if (ext === 'm7') quality = 'm7'
  else if (ext) quality = ext
  return `${rootName(pc, key.name.includes('b'))}${quality}`
}

export const PROGRESSIONS: Record<string, string[]> = {
  pop: ['I', 'V', 'vi', 'IV'],
  'axis': ['vi', 'IV', 'I', 'V'],
  doowop: ['I', 'vi', 'IV', 'V'],
  blues: ['I', 'I', 'I', 'I', 'IV', 'IV', 'I', 'I', 'V', 'IV', 'I', 'V'],
  jazz: ['ii', 'V', 'I', 'I'],
  folk: ['I', 'IV', 'V', 'I'],
  andalusian: ['i', 'bVII', 'bVI', 'V'],
  canon: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'],
}

export function progressionSong(key: Key, tokens: string[], opts: { beatsPerChord?: number; repeats?: number; bpm?: number; title?: string } = {}): ChordSong {
  const beats = opts.beatsPerChord ?? 4
  const repeats = opts.repeats ?? 2
  const names = tokens.map(t => chordInKey(t, key))
  const bad = tokens.filter((_, i) => !names[i])
  if (bad.length) throw new Error(`not a chord or numeral: ${bad.join(', ')}`)
  const chords: ChordSheetEvent[] = []
  for (let r = 0; r < repeats; r++) {
    names.forEach((name, i) => {
      chords.push({ b: (r * names.length + i) * beats, l: beats, name: name!, line: r, ...(i === 0 ? { section: `round ${r + 1}` } : {}) })
    })
  }
  return { kind: 'chords', title: opts.title ?? `${key.name}: ${tokens.join(' ')}`, bpm: opts.bpm ?? 80, beatsPerBar: 4, chords }
}

// ---- fingerpicking ----

/** One pluck of a pattern: when in the bar, which finger, and which string (`bass` is the chord's lowest). */
export type Pluck = { at: number; finger: 'p' | 'i' | 'm' | 'a'; string: number | 'bass' | 'bass2' }

export type PickPattern = { name: string; beatsPerBar: number; plucks: Pluck[]; blurb: string }

const P = (at: number, finger: Pluck['finger'], string: Pluck['string']): Pluck => ({ at, finger, string })

export const PICK_PATTERNS: Record<string, PickPattern> = {
  travis: { name: 'Travis', beatsPerBar: 4, blurb: 'alternating bass under a steady thumb, melody on top', plucks: [P(0, 'p', 'bass'), P(0.5, 'i', 3), P(1, 'p', 'bass2'), P(1.5, 'm', 2), P(2, 'p', 'bass'), P(2.5, 'i', 3), P(3, 'p', 'bass2'), P(3.5, 'm', 2)] },
  arp: { name: 'Arpeggio', beatsPerBar: 4, blurb: 'p i m a m i, up and back', plucks: [P(0, 'p', 'bass'), P(0.5, 'i', 3), P(1, 'm', 2), P(1.5, 'a', 1), P(2, 'm', 2), P(2.5, 'i', 3), P(3, 'p', 'bass2'), P(3.5, 'i', 3)] },
  folk: { name: 'Folk', beatsPerBar: 4, blurb: 'thumb then i m a together in turn', plucks: [P(0, 'p', 'bass'), P(1, 'i', 3), P(1.5, 'm', 2), P(2, 'p', 'bass2'), P(3, 'a', 1), P(3.5, 'm', 2)] },
  waltz: { name: 'Waltz', beatsPerBar: 3, blurb: 'bass, then the top two strings, in three', plucks: [P(0, 'p', 'bass'), P(1, 'i', 3), P(1.5, 'm', 2), P(2, 'a', 1), P(2.5, 'm', 2)] },
  pinch: { name: 'Pinch', beatsPerBar: 4, blurb: 'thumb and finger together on the beat', plucks: [P(0, 'p', 'bass'), P(0, 'a', 1), P(1, 'i', 3), P(2, 'p', 'bass2'), P(2, 'm', 2), P(3, 'i', 3)] },
}

/** The lowest and second-lowest sounding strings of a shape (6 to 1), for `bass` and `bass2`. */
function bassStrings(frets: readonly number[]): [number, number] {
  const sounding = frets.map((f, i) => (f >= 0 ? 6 - i : 0)).filter(s => s > 0)
  const low = sounding[0] ?? 6
  const second = sounding[1] ?? low
  // an alternating bass moves to the string two up when the shape has it (E: 6 then 4; A: 5 then 4)
  const alt = sounding.includes(low - 2) ? low - 2 : second
  return [low, alt]
}

export function fingerpickSong(key: Key, tokens: string[], pattern: PickPattern, opts: { repeats?: number; bpm?: number; title?: string } = {}): Song {
  const repeats = opts.repeats ?? 2
  const names = tokens.map(t => chordInKey(t, key))
  const bad = tokens.filter((_, i) => !names[i])
  if (bad.length) throw new Error(`not a chord or numeral: ${bad.join(', ')}`)
  const notes: SongNote[] = []
  const bar = pattern.beatsPerBar
  let barIndex = 0
  for (let r = 0; r < repeats; r++) {
    for (const name of names) {
      const chord = parseChord(name!)!
      const shape = shapeOf(chord)
      const [bass, bass2] = bassStrings(shape.frets)
      for (const p of pattern.plucks) {
        const string = p.string === 'bass' ? bass : p.string === 'bass2' ? bass2 : p.string
        const fret = shape.frets[6 - string] ?? -1
        if (fret < 0) continue
        notes.push({ b: barIndex * bar + p.at, s: string, f: fret, l: 0.5, finger: p.finger, chord: name! })
      }
      barIndex++
    }
  }
  return { kind: 'notes', title: opts.title ?? `${pattern.name} picking · ${key.name}: ${tokens.join(' ')}`, bpm: opts.bpm ?? 70, beatsPerBar: bar, tuning: 'standard', notes }
}

// ---- scales ----

export type ScaleDef = { name: string; intervals: number[] }
export const SCALES: Record<string, ScaleDef> = {
  major: { name: 'major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: 'natural minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  pentatonic: { name: 'minor pentatonic', intervals: [0, 3, 5, 7, 10] },
  majorpentatonic: { name: 'major pentatonic', intervals: [0, 2, 4, 7, 9] },
  blues: { name: 'blues', intervals: [0, 3, 5, 6, 7, 10] },
  dorian: { name: 'dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  mixolydian: { name: 'mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
}

/**
 * A scale in one position: on each string from 6 to 1, the scale tones within
 * `span` frets of `lowFret`, ascending then descending, one note a beat.
 * Box 1 starts at the root on string 6; each later box starts at the next
 * scale tone up.
 */
export function scaleSong(root: number, scale: ScaleDef, box: number, opts: { bpm?: number; span?: number; title?: string; eighths?: boolean } = {}): Song {
  const span = opts.span ?? 4
  const pcs = scale.intervals.map(i => (root + i) % 12)
  // the box's lowest fret: the box-th scale tone on the low E string, at or above the open string
  const lowE = STANDARD_TUNING[5]!
  const tonesOnE: number[] = []
  for (let f = 0; f <= 15 && tonesOnE.length < 12; f++) if (pcs.includes((lowE + f) % 12)) tonesOnE.push(f)
  const rootFret = tonesOnE.find(f => (lowE + f) % 12 === root) ?? 0
  const start = tonesOnE.indexOf(rootFret)
  const lowFret = Math.max(0, (tonesOnE[(start + box - 1) % tonesOnE.length] ?? 0) - 1)
  const up: SongNote[] = []
  for (let s = 6; s >= 1; s--) {
    const open = STANDARD_TUNING[s - 1]!
    for (let f = lowFret; f <= lowFret + span; f++) if (pcs.includes((open + f) % 12)) up.push({ b: 0, s, f })
  }
  const down = [...up].reverse().slice(1)
  const step = opts.eighths ? 0.5 : 1
  const notes = [...up, ...down].map((n, i) => ({ ...n, b: i * step, l: step }))
  return { kind: 'notes', title: opts.title ?? `${rootName(root)} ${scale.name} · box ${box} (fret ${lowFret})`, bpm: opts.bpm ?? 80, beatsPerBar: 4, tuning: 'standard', notes }
}

// ---- CAGED ----

/**
 * The five moveable forms of a major and a minor chord: frets 6 to 1 relative to
 * the root's fret on the form's root string, null for a string left out.
 */
type Form = { name: string; rootString: number; major: (number | null)[]; minor: (number | null)[] }
const FORMS: Form[] = [
  { name: 'C', rootString: 5, major: [null, 0, -1, -3, -2, -3], minor: [null, 0, -2, -3, -2, -3] },
  { name: 'A', rootString: 5, major: [null, 0, 2, 2, 2, 0], minor: [null, 0, 2, 2, 1, 0] },
  { name: 'G', rootString: 6, major: [0, -1, -3, -3, -3, 0], minor: [0, -2, -3, -3, -3, 0] },
  { name: 'E', rootString: 6, major: [0, 2, 2, 1, 0, 0], minor: [0, 2, 2, 0, 0, 0] },
  { name: 'D', rootString: 4, major: [null, null, 0, 2, 3, 2], minor: [null, null, 0, 2, 3, 1] },
]

/** A chord in its five CAGED forms up the neck, lowest first, each shape given so the diagram draws it. */
export function cagedSong(chord: Chord, opts: { beatsPerChord?: number; bpm?: number } = {}): ChordSong {
  const beats = opts.beatsPerChord ?? 4
  const shapes: { form: string; frets: number[]; low: number }[] = []
  for (const form of FORMS) {
    const open = STANDARD_TUNING[form.rootString - 1]!
    const rootFret0 = (chord.root - open + 12) % 12
    const rel = chord.minor ? form.minor : form.major
    const minRel = Math.min(...rel.filter((v): v is number => v !== null))
    for (const rootFret of [rootFret0, rootFret0 + 12]) {
      if (rootFret + minRel < 0) continue
      const frets = rel.map(v => (v === null ? -1 : rootFret + v))
      if (Math.max(...frets) > 15) continue
      shapes.push({ form: form.name, frets, low: Math.min(...frets.filter(f => f > 0)) })
      break
    }
  }
  shapes.sort((a, b) => a.low - b.low)
  const chords: ChordSheetEvent[] = shapes.map((s, i) => ({ b: i * beats, l: beats, name: chord.name, frets: s.frets, section: `${s.form} form`, line: i, lyric: `${s.form} form${s.frets.includes(0) ? ' · open position' : ` · fret ${s.low}`}` }))
  return { kind: 'chords', title: `${chord.name} · CAGED`, bpm: opts.bpm ?? 70, beatsPerBar: 4, chords }
}

export const randomOf = <T>(items: readonly T[], rand = Math.random): T => items[Math.floor(rand() * items.length)]!
