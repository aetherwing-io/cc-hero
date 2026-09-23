// A song: notes on strings and frets at beats. Parsed from JSON a person writes or
// from the built-in starters; validated so a bad file never reaches the board.

import { midiOf, staffPosition, TUNINGS } from './notes.ts'
import { parseChord, shapeFromHighFirst, shapeOf } from './chords.ts'

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
  kind?: 'notes'
  title: string
  artist?: string
  bpm: number
  beatsPerBar: number
  tuning: string
  notes: SongNote[]
  /** Where it came from: a file path or a URL. */
  source?: string
}

/** One chord of a chord sheet, with the words sung over it. */
export type ChordSheetEvent = {
  /** The beat it starts on. */
  b: number
  /** Beats it lasts; the sheet's default when left out. */
  l?: number
  /** As written: "Am", "G7", "F#m". */
  name: string
  /** The lyric sung from this chord to the next, if any. */
  lyric?: string
  /** "Verse 1", "Chorus": drawn when it changes. */
  section?: string
  /** A shape to draw, strings 6 to 1, -1 muted; the built-in shapes when left out. */
  frets?: number[]
  /** Which lyric line of the sheet the chord sits on; chords of one line show together. */
  line?: number
}

export type ChordSong = {
  kind: 'chords'
  title: string
  artist?: string
  bpm: number
  beatsPerBar: number
  chords: ChordSheetEvent[]
  source?: string
}

export type AnySong = Song | ChordSong

export const isChordSong = (s: AnySong): s is ChordSong => s.kind === 'chords'

/** A chord with everything the board and the judge need precomputed. */
export type PlacedChord = {
  index: number
  beat: number
  len: number
  name: string
  pcs: number[]
  /** Strings 6 to 1; -1 muted. */
  frets: number[]
  base: number
  lyric: string
  section?: string
  line: number
  /** The lyric's words, each with its offset into the chord in beats. */
  words: { at: number; text: string }[]
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

export function parseSong(raw: unknown): AnySong {
  if (!isRecord(raw)) throw new Error('a song is a JSON object')
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'untitled'
  const bpm = typeof raw.bpm === 'number' && raw.bpm >= 20 && raw.bpm <= 400 ? raw.bpm : 90
  const beatsPerBar = typeof raw.beatsPerBar === 'number' && raw.beatsPerBar >= 1 && raw.beatsPerBar <= 16 ? Math.floor(raw.beatsPerBar) : 4
  const tuning = typeof raw.tuning === 'string' && raw.tuning in TUNINGS ? raw.tuning : 'standard'
  const artist = typeof raw.artist === 'string' && raw.artist.trim() ? { artist: raw.artist.trim() } : {}
  const source = typeof raw.source === 'string' ? { source: raw.source } : {}
  if (raw.kind === 'chords' || (Array.isArray(raw.chords) && !Array.isArray(raw.notes))) {
    if (!Array.isArray(raw.chords) || raw.chords.length === 0) throw new Error('a chord song needs a non-empty "chords" array')
    const chords: ChordSheetEvent[] = raw.chords.map((c, i) => {
      if (!isRecord(c)) throw new Error(`chord ${i} is not an object`)
      const { b, l, name, lyric, section, frets, line } = c
      if (typeof b !== 'number' || b < 0) throw new Error(`chord ${i}: "b" (beat) must be a number >= 0`)
      if (typeof name !== 'string' || !parseChord(name)) throw new Error(`chord ${i}: "${String(name)}" is not a chord name`)
      if (l !== undefined && (typeof l !== 'number' || l <= 0)) throw new Error(`chord ${i}: "l" (length) must be > 0`)
      const ev: ChordSheetEvent = { b, name }
      if (l !== undefined) ev.l = l
      if (typeof lyric === 'string') ev.lyric = lyric
      if (typeof section === 'string') ev.section = section
      if (typeof line === 'number') ev.line = line
      if (Array.isArray(frets) && frets.length === 6 && frets.every(f => typeof f === 'number')) ev.frets = frets as number[]
      return ev
    })
    chords.sort((x, y) => x.b - y.b)
    return { kind: 'chords', title, ...artist, bpm, beatsPerBar, chords, ...source }
  }
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
  return { kind: 'notes', title, ...artist, bpm, beatsPerBar, tuning, notes, ...source }
}

export function placeChords(song: ChordSong): PlacedChord[] {
  return song.chords.map((c, index) => {
    const chord = parseChord(c.name)
    const pcs = chord?.pcs ?? []
    const shape = c.frets ? shapeFromHighFirst([...c.frets].reverse()) : chord ? shapeOf(chord) : { frets: [-1, -1, -1, -1, -1, -1], base: 1 }
    const next = song.chords[index + 1]
    const len = c.l ?? (next ? Math.max(0.5, next.b - c.b) : song.beatsPerBar)
    const lyric = (c.lyric ?? '').trim()
    const parts = lyric ? lyric.split(/\s+/) : []
    const words = parts.map((text, i) => ({ at: (i / parts.length) * len, text }))
    const placed: PlacedChord = { index, beat: c.b, len, name: c.name, pcs, frets: shape.frets, base: shape.base, lyric, line: c.line ?? index, words }
    if (c.section) placed.section = c.section
    return placed
  })
}

/** The last beat any chord ends on. */
export const chordLengthOf = (chords: readonly PlacedChord[]): number => chords.reduce((m, c) => Math.max(m, c.beat + c.len), 0)

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
