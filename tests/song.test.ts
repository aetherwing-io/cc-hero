import { describe, expect, test, tier } from 'claude-code/testing'
import { lengthOf, parseSong, place, STARTERS } from '../hooks/music/song.ts'

tier('user')

describe('song', () => {
  test('every starter parses, places and has a length', async () => {
    for (const [key, s] of Object.entries(STARTERS)) {
      const song = parseSong(s)
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

  test('notes are sorted by beat and defaults fill in', async () => {
    const song = parseSong({ notes: [{ b: 2, s: 1, f: 0 }, { b: 0, s: 6, f: 3 }] })
    expect(song.bpm).toBe(90)
    expect(song.beatsPerBar).toBe(4)
    expect(song.tuning).toBe('standard')
    expect(song.notes.map(n => n.b)).toEqual([0, 2])
  })
})
