import { describe, expect, test, tier } from 'claude-code/testing'
import { bestChord, chromaMatch, parseChord, shapeOf, templateOf } from '../hooks/music/chords.ts'

tier('user')

describe('chords', () => {
  test('names parse to pitch classes', async () => {
    expect(parseChord('C')).toMatchObject({ root: 0, pcs: [0, 4, 7], minor: false })
    expect(parseChord('Am')).toMatchObject({ root: 9, pcs: [9, 0, 4], minor: true })
    expect(parseChord('G7')).toMatchObject({ root: 7, pcs: [7, 11, 2, 5] })
    expect(parseChord('F#m7')).toMatchObject({ root: 6, pcs: [6, 9, 1, 4], minor: true })
    expect(parseChord('Bb')).toMatchObject({ root: 10 })
    expect(parseChord('Dsus4')).toMatchObject({ pcs: [2, 7, 9] })
    expect(parseChord('Cadd9')).toMatchObject({ pcs: [0, 4, 7, 2] })
    expect(parseChord('G/B')).toMatchObject({ root: 7, bass: 11 })
    expect(parseChord('N.C.')).toBe(null)
    expect(parseChord('Amazing')).toBe(null)
    expect(parseChord('x2')).toBe(null)
  })

  test('open shapes are known and barre shapes are built from the root', async () => {
    expect(shapeOf(parseChord('Am')!)).toEqual({ frets: [-1, 0, 2, 2, 1, 0], base: 1 })
    expect(shapeOf(parseChord('G')!).frets).toEqual([3, 2, 0, 0, 0, 3])
    // F#m is known; Gm7 is not and takes an E-form barre at the third fret
    expect(shapeOf(parseChord('Gm7')!)).toEqual({ frets: [3, 5, 5, 3, 3, 3], base: 3 })
    expect(shapeOf(parseChord('C#')!).base).toBe(4)
  })

  test('a chord template matches its own chroma and not a distant chord', async () => {
    const am = templateOf(parseChord('Am')!.pcs)
    expect(chromaMatch(am, parseChord('Am')!.pcs)).toBeGreaterThan(0.99)
    expect(chromaMatch(am, parseChord('C')!.pcs)).toBeLessThan(0.72) // shares two tones
    expect(chromaMatch(am, parseChord('Eb')!.pcs)).toBeLessThan(0.2)
    expect(bestChord(am)?.name).toBe('Am')
    const g7 = templateOf(parseChord('G7')!.pcs)
    expect(bestChord(g7)?.name).toBe('G7')
  })
})
