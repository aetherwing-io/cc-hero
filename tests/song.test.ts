import { describe, expect, test, tier } from 'claude-code/testing'
import { isChordSong, lengthOf, parseSong, place, STARTERS } from '../hooks/music/song.ts'

tier('user')

describe('song', () => {
  test('every starter parses, places and has a length', async () => {
    for (const [key, s] of Object.entries(STARTERS)) {
      const song = parseSong(s)
      if (isChordSong(song)) throw new Error('a starter is notes')
      const notes = place(song)
      expect(notes.length).toBe(s.notes.length)
      expect(lengthOf(notes)).toBeGreaterThan(0)
      expect(key.length).toBeGreaterThan(0)
    }
  })

  test('Ode to Joy starts on E4 on the D string and its rhythm has the dotted quarter', async () => {
    const notes = place(STARTERS.ode!)
    expect(notes[0]).toMatchObject({ beat: 0, string: 4, fret: 2, midi: 52 })
    expect(notes.find(n => n.len === 1.5)).toBeDefined()
    expect(notes.find(n => n.len === 0.5)).toBeDefined()
  })

  test('a bad file is refused with a reason', async () => {
    expect(() => parseSong({})).toThrow(/notes/)
    expect(() => parseSong({ notes: [{ b: 0, s: 7, f: 0 }] })).toThrow(/string/)
    expect(() => parseSong({ notes: [{ b: 0, s: 1, f: 30 }] })).toThrow(/fret/)
    expect(() => parseSong({ notes: [{ b: -1, s: 1, f: 0 }] })).toThrow(/beat/)
  })

  test('a chord song parses with lines and lengths', async () => {
    const song = parseSong({ kind: 'chords', bpm: 100, chords: [{ b: 0, name: 'C', lyric: 'one two', line: 0 }, { b: 4, name: 'G7', line: 0 }, { b: 8, name: 'Am', l: 2, line: 1 }] })
    expect(isChordSong(song)).toBe(true)
    expect(() => parseSong({ chords: [{ b: 0, name: 'H' }] })).toThrow(/chord name/)
  })

  test('notes are sorted by beat and defaults fill in', async () => {
    const song = parseSong({ notes: [{ b: 2, s: 1, f: 0 }, { b: 0, s: 6, f: 3 }] })
    if (isChordSong(song)) throw new Error('notes expected')
    expect(song.bpm).toBe(90)
    expect(song.beatsPerBar).toBe(4)
    expect(song.tuning).toBe('standard')
    expect(song.notes.map(n => n.b)).toEqual([0, 2])
  })
})
