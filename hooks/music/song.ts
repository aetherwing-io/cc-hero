// A song: notes on strings and frets at beats. Parsed from JSON a person writes or
// from the built-in starters; validated so a bad file never reaches the board.

import { midiOf, staffPosition, TUNINGS } from './notes.ts'

export type SongNote = {
  /** The beat the note starts on, 0-based; fractions allowed (0.5 = an eighth). */
  b: number
  /** String 1 (high e) to 6 (low E). */
  s: number
  /** Fret, 0 for open. */
  f: number
  /** Length in beats; 1 when left out. */
  l?: number
}

export type Song = {
  title: string
  bpm: number
  beatsPerBar: number
  tuning: string
  notes: SongNote[]
}

/** A note with everything the board and the judge need precomputed. */
export type PlacedNote = {
  index: number
  beat: number
  len: number
  string: number
  fret: number
  midi: number
  pos: number
  sharp: boolean
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

export function parseSong(raw: unknown): Song {
  if (!isRecord(raw)) throw new Error('a song is a JSON object')
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'untitled'
  const bpm = typeof raw.bpm === 'number' && raw.bpm >= 20 && raw.bpm <= 400 ? raw.bpm : 90
  const beatsPerBar = typeof raw.beatsPerBar === 'number' && raw.beatsPerBar >= 1 && raw.beatsPerBar <= 16 ? Math.floor(raw.beatsPerBar) : 4
  const tuning = typeof raw.tuning === 'string' && raw.tuning in TUNINGS ? raw.tuning : 'standard'
  if (!Array.isArray(raw.notes) || raw.notes.length === 0) throw new Error('a song needs a non-empty "notes" array')
  const notes: SongNote[] = raw.notes.map((n, i) => {
    if (!isRecord(n)) throw new Error(`note ${i} is not an object`)
    const { b, s, f, l } = n
    if (typeof b !== 'number' || b < 0) throw new Error(`note ${i}: "b" (beat) must be a number >= 0`)
    if (typeof s !== 'number' || s < 1 || s > 6 || !Number.isInteger(s)) throw new Error(`note ${i}: "s" (string) must be 1..6`)
    if (typeof f !== 'number' || f < 0 || f > 24 || !Number.isInteger(f)) throw new Error(`note ${i}: "f" (fret) must be 0..24`)
    if (l !== undefined && (typeof l !== 'number' || l <= 0)) throw new Error(`note ${i}: "l" (length) must be > 0`)
    return l === undefined ? { b, s, f } : { b, s, f, l }
  })
  notes.sort((x, y) => x.b - y.b || x.s - y.s)
  return { title, bpm, beatsPerBar, tuning, notes }
}

export function place(song: Song): PlacedNote[] {
  const tuning = TUNINGS[song.tuning] ?? TUNINGS.standard!
  return song.notes.map((n, index) => {
    const midi = midiOf(tuning, n.s, n.f)
    const { pos, sharp } = staffPosition(midi)
    return { index, beat: n.b, len: n.l ?? 1, string: n.s, fret: n.f, midi, pos, sharp }
  })
}

/** The last beat any note ends on. */
export const lengthOf = (notes: readonly PlacedNote[]): number => notes.reduce((m, n) => Math.max(m, n.beat + n.len), 0)

/** Shorthand for writing the starters: "s/f" tokens per beat, "-" for a rest, "s/f:len" for length. */
function riff(title: string, bpm: number, line: string, opts: Partial<Song> = {}): Song {
  const notes: SongNote[] = []
  let beat = 0
  for (const tok of line.replace(/\|/g, ' ').trim().split(/\s+/)) {
    if (tok === '-' || tok === '') { beat += 1; continue }
    const m = /^(\d)\/(\d+)(?::([\d.]+))?$/.exec(tok)
    if (!m) throw new Error(`bad token ${tok}`)
    const l = m[3] ? Number(m[3]) : 1
    notes.push({ b: beat, s: Number(m[1]), f: Number(m[2]), l })
    beat += l
  }
  return { title, bpm, beatsPerBar: 4, tuning: 'standard', ...opts, notes }
}

/** Public-domain melodies and exercises in open position. */
export const STARTERS: Record<string, Song> = {
  chromatic: riff('Chromatic warm-up', 80,
    '6/1 6/2 6/3 6/4 | 5/1 5/2 5/3 5/4 | 4/1 4/2 4/3 4/4 | 3/1 3/2 3/3 3/4 | 2/1 2/2 2/3 2/4 | 1/1 1/2 1/3 1/4 | 1/4:4'),
  cmajor: riff('C major scale', 90,
    '5/3 4/0 4/2 4/3 3/0 3/2 2/0 2/1 | 2/0 3/2 3/0 4/3 4/2 4/0 5/3:2'),
  ode: riff('Ode to Joy', 100,
    '4/2 4/2 4/3 3/0 | 3/0 4/3 4/2 4/0 | 5/3 5/3 4/0 4/2 | 4/2:1.5 4/0:0.5 4/0:2 |' +
    '4/2 4/2 4/3 3/0 | 3/0 4/3 4/2 4/0 | 5/3 5/3 4/0 4/2 | 4/0:1.5 5/3:0.5 5/3:2'),
  twinkle: riff('Twinkle Twinkle', 96,
    '5/3 5/3 3/0 3/0 | 3/2 3/2 3/0:2 | 4/3 4/3 4/2 4/2 | 4/0 4/0 5/3:2 |' +
    '3/0 3/0 4/3 4/3 | 4/2 4/2 4/0:2 | 3/0 3/0 4/3 4/3 | 4/2 4/2 4/0:2 |' +
    '5/3 5/3 3/0 3/0 | 3/2 3/2 3/0:2 | 4/3 4/3 4/2 4/2 | 4/0 4/0 5/3:2'),
  pentatonic: riff('A minor pentatonic, box 1', 110,
    '6/5 6/8 5/5 5/7 4/5 4/7 3/5 3/7 2/5 2/8 1/5 1/8 | 1/8 1/5 2/8 2/5 3/7 3/5 4/7 4/5 5/7 5/5 6/8 6/5:2'),
}
