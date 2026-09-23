import { describe, expect, test, tier } from 'claude-code/testing'
import { cagedSong, chordInKey, fingerpickSong, parseKey, PICK_PATTERNS, progressionSong, SCALES, scaleSong } from '../hooks/music/exercise.ts'
import { parseChord } from '../hooks/music/chords.ts'
import { parseStrumText, place, placeChords, placeStrums, strumText } from '../hooks/music/song.ts'
import { coachNotes, timingOf, weakSpots, withRun, type RunRecord } from '../hooks/music/stats.ts'
import { midiOf, STANDARD_TUNING } from '../hooks/music/notes.ts'

tier('user')

describe('exercise', () => {
  test('numerals resolve in a key', async () => {
    const G = parseKey('G')!
    expect(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'].map(n => chordInKey(n, G))).toEqual(['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#dim'])
    expect(chordInKey('V7', G)).toBe('D7')
    const Am = parseKey('Am')!
    expect(['i', 'bVII', 'bVI', 'V', 'iv'].map(n => chordInKey(n, Am))).toEqual(['Am', 'G', 'F', 'E', 'Dm'])
    expect(chordInKey('Cadd9', G)).toBe('Cadd9')
    expect(chordInKey('nope', G)).toBe(null)
    expect(parseKey('Bb')?.name).toBe('Bb')
    expect(chordInKey('IV', parseKey('Bb')!)).toBe('Eb')
  })

  test('a progression repeats with sections and a strum pattern places strums', async () => {
    const song = progressionSong(parseKey('C')!, ['I', 'V', 'vi', 'IV'], { repeats: 2 })
    expect(song.chords.map(c => c.name)).toEqual(['C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F'])
    expect(song.chords[4]).toMatchObject({ b: 16, section: 'round 2' })
    song.strum = parseStrumText('D DU UDU')!
    expect(song.strum).toEqual({ div: 2, marks: ['d', '-', 'd', 'u', '-', 'u', 'd', 'u'] })
    expect(parseStrumText('D D DU')).toEqual({ div: 2, marks: ['d', '-', 'd', '-', 'd', 'u'] })
    expect(strumText(parseStrumText('D - DU -')!)).toBe('D- -- DU --')
    expect(parseStrumText('hello')).toBe(null)
    const chords = placeChords(song)
    const strums = placeStrums(song, chords)
    // six strums per bar over 8 bars
    expect(strums.length).toBe(48)
    expect(strums[0]).toMatchObject({ beat: 0, dir: 'd', name: 'C' })
    expect(strums[0]?.pcs).toEqual([0, 4, 7])
    expect(strums[1]).toMatchObject({ beat: 1, dir: 'd' })
    expect(strums[2]).toMatchObject({ beat: 1.5, dir: 'u' })
    expect(strums[6]).toMatchObject({ beat: 4, name: 'G' })
  })

  test('fingerpicking puts the thumb on the chord bass and fingers on their strings', async () => {
    const song = fingerpickSong(parseKey('G')!, ['G', 'C'], PICK_PATTERNS.travis!, { repeats: 1 })
    expect(song.notes.length).toBe(16)
    const g = song.notes.slice(0, 8)
    expect(g[0]).toMatchObject({ b: 0, s: 6, f: 3, finger: 'p', chord: 'G' })
    expect(g[2]).toMatchObject({ b: 1, s: 4, f: 0, finger: 'p' }) // alternate bass two strings up
    expect(g[1]).toMatchObject({ b: 0.5, s: 3, f: 0, finger: 'i' })
    const c = song.notes.slice(8)
    expect(c[0]).toMatchObject({ s: 5, f: 3, finger: 'p', chord: 'C' }) // C's bass is the A string
    const placed = place(song)
    expect(placed[0]?.finger).toBe('p')
    expect(placed[0]?.midi).toBe(midiOf(STANDARD_TUNING, 6, 3))
  })

  test('a scale box climbs and descends within a few frets', async () => {
    const song = scaleSong(9, SCALES.pentatonic!, 1)
    expect(song.title).toContain('A minor pentatonic · box 1 (fret 4)')
    const frets = song.notes.map(n => n.f)
    expect(Math.min(...frets)).toBe(5)
    expect(Math.max(...frets)).toBe(8)
    expect(song.notes[0]).toMatchObject({ s: 6, f: 5, b: 0 })
    expect(song.notes.length).toBe(23) // 12 up, 11 back down
    expect(song.notes[song.notes.length - 1]).toMatchObject({ s: 6, f: 5 })
  })

  test('CAGED lays out five forms up the neck in order', async () => {
    const song = cagedSong(parseChord('C')!)
    expect(song.chords.length).toBe(5)
    expect(song.chords.map(c => c.section)).toEqual(['C form', 'A form', 'G form', 'E form', 'D form'])
    expect(song.chords[0]?.frets).toEqual([-1, 3, 2, 0, 1, 0])
    expect(song.chords[1]?.frets).toEqual([-1, 3, 5, 5, 5, 3])
    expect(song.chords[3]?.frets).toEqual([8, 10, 10, 9, 8, 8])
    const am = cagedSong(parseChord('Am')!)
    expect(am.chords[0]?.frets).toEqual([-1, 0, 2, 2, 1, 0])
  })

  test('stats: weak spots, timing, and coach notes', async () => {
    const run = (key: string, misses: Record<string, number>, hits: Record<string, number>, accuracy: number, timing: number[]): RunRecord =>
      ({ key, title: key, at: 1000, bpm: 80, tempo: 1, score: 100, accuracy, bestCombo: 3, grades: {}, hits, misses, timing })
    let runs: RunRecord[] = []
    runs = withRun(runs, run('a', { G7: 2, C: 1 }, { G: 4 }, 60, [-50, 10, 80, 120]))
    runs = withRun(runs, run('a', { G7: 1 }, { G: 4, C: 2 }, 80, [5, -5]))
    runs = withRun(runs, run('b', { Em: 3 }, {}, 20, []))
    expect(weakSpots(runs, 'a')[0]).toEqual({ label: 'G7', misses: 3, hits: 0 })
    expect(weakSpots(runs).map(w => w.label)).toEqual(['Em', 'G7', 'C'])
    expect(timingOf([-50, 10, 80, 120])).toEqual({ mean: 40, spread: 65, early: 1, late: 2 })
    const notes = coachNotes(runs, 'a', 60_000)
    expect(notes).toContain('80% accuracy')
    expect(notes).toContain('G7 (3 missed, 0 hit)')
    expect(notes).toContain('newest first: 80%, 60%')
  })
})
