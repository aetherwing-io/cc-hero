import { describe, expect, test, tier } from 'claude-code/testing'
import { hzOf, isLedgerPosition, midiOf, nameOf, nearestString, pitchOf, staffPosition, STANDARD_TUNING } from '../hooks/music/notes.ts'

tier('user')

describe('notes', () => {
  test('strings and frets map to the right pitches', async () => {
    expect(midiOf(STANDARD_TUNING, 6, 0)).toBe(40) // low E2
    expect(midiOf(STANDARD_TUNING, 1, 0)).toBe(64) // high E4
    expect(midiOf(STANDARD_TUNING, 5, 3)).toBe(48) // C3
    expect(nameOf(48)).toBe('C3')
    expect(nameOf(61)).toBe('C#4')
  })

  test('frequencies round-trip through midi and cents', async () => {
    expect(Math.round(hzOf(69))).toBe(440)
    expect(pitchOf(440)).toEqual({ midi: 69, cents: 0 })
    expect(pitchOf(82.41).midi).toBe(40)
    const sharp = pitchOf(hzOf(57) * 2 ** (10 / 1200))
    expect(sharp.midi).toBe(57)
    expect(sharp.cents).toBe(10)
  })

  test('staff positions: written an octave up, E4 sounding lands on the bottom space of the low ledger', async () => {
    expect(staffPosition(64)).toEqual({ pos: 7, sharp: false }) // E4 sounds, E5 written: top space
    expect(staffPosition(52)).toEqual({ pos: 0, sharp: false }) // E3 sounds, E4 written: bottom line
    expect(staffPosition(40)).toEqual({ pos: -7, sharp: false }) // low E2 sounds, E3 written
    expect(staffPosition(61)).toEqual({ pos: 5, sharp: true }) // C#4 sounds, C#5 written
    expect(isLedgerPosition(-2)).toBe(true)
    expect(isLedgerPosition(-1)).toBe(false)
    expect(isLedgerPosition(4)).toBe(false)
    expect(isLedgerPosition(10)).toBe(true)
  })

  test('the tuner picks the nearest string', async () => {
    expect(nearestString(STANDARD_TUNING, 45, 12)).toEqual({ string: 5, midi: 45, offsetCents: 12 })
    expect(nearestString(STANDARD_TUNING, 46, -40)).toEqual({ string: 5, midi: 45, offsetCents: 60 })
  })
})
