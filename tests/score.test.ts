import { describe, expect, test, tier } from 'claude-code/testing'
import { accuracyOf, judge, newJudge, WINDOW } from '../hooks/music/score.ts'
import { place } from '../hooks/music/song.ts'

tier('user')

const song = { title: 't', bpm: 120, beatsPerBar: 4, tuning: 'standard', notes: [{ b: 0, s: 1, f: 0 }, { b: 1, s: 2, f: 0 }, { b: 2, s: 3, f: 0 }] }
const MPB = 500
const ORIGIN = 1_000_000
const onset = (t: number, midi: number) => ({ t: ORIGIN + t, midi, hz: 0, cents: 0, rms: 0.1 })

describe('score', () => {
  test('a note on time is perfect, a late one is graded, silence is a miss', async () => {
    const notes = place(song)
    const j = newJudge()
    const onsets = [onset(20, 64), onset(500 + 120, 59)]
    expect(judge(j, notes, onsets, 100, MPB, ORIGIN).map(x => x.grade)).toEqual(['perfect'])
    expect(judge(j, notes, onsets, 700, MPB, ORIGIN).map(x => x.grade)).toEqual(['great'])
    expect(judge(j, notes, onsets, 1000 + WINDOW.late, MPB, ORIGIN).map(x => x.grade)).toEqual(['miss'])
    expect(j.tally.judged).toBe(3)
    expect(j.tally.hits).toBe(2)
    expect(j.tally.combo).toBe(0)
    expect(j.tally.bestCombo).toBe(2)
    expect(accuracyOf(j.tally)).toBe(57)
  })

  test('a wrong pitch in the window reports what was heard', async () => {
    const notes = place(song)
    const j = newJudge()
    const made = judge(j, notes, [onset(10, 65)], WINDOW.late + 1, MPB, ORIGIN)
    expect(made).toEqual([{ index: 0, grade: 'wrong', dtMs: 10, heardMidi: 65, heard: 'F4' }])
  })

  test('each onset scores once', async () => {
    const notes = place({ ...song, notes: [{ b: 0, s: 1, f: 0 }, { b: 0.25, s: 1, f: 0 }] })
    const j = newJudge()
    judge(j, notes, [onset(0, 64)], 2000, MPB, ORIGIN)
    expect([...j.judged.values()].map(x => x.grade)).toEqual(['perfect', 'miss'])
  })

  test('combos multiply the score from ten in a row', async () => {
    const notes = place({ ...song, notes: Array.from({ length: 11 }, (_, i) => ({ b: i, s: 1, f: 0 })) })
    const j = newJudge()
    judge(j, notes, notes.map(n => onset(n.beat * MPB, 64)), 20_000, MPB, ORIGIN)
    // nine at x1, then the tenth and eleventh in a row at x2
    expect(j.tally.score).toBe(9 * 100 + 2 * 200)
    expect(accuracyOf(j.tally)).toBe(100)
  })
})
