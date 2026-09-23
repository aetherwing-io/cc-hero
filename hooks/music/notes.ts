// Pitch arithmetic: MIDI numbers, note names, guitar strings and frets, and where a
// pitch sits on a treble staff. Pure functions, no state.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

/** Standard tuning, string 1 (high e) to string 6 (low E), as MIDI numbers. */
export const STANDARD_TUNING: readonly number[] = [64, 59, 55, 50, 45, 40]

export const TUNINGS: Record<string, readonly number[]> = {
  standard: STANDARD_TUNING,
  'drop-d': [64, 59, 55, 50, 45, 38],
  'half-down': [63, 58, 54, 49, 44, 39],
}

/** Labels for the six tab lines, string 1 first. */
export const STRING_LABELS = ['e', 'B', 'G', 'D', 'A', 'E'] as const

export const midiOf = (tuning: readonly number[], string: number, fret: number): number => {
  const open = tuning[string - 1]
  if (open === undefined) throw new Error(`no string ${string}`)
  return open + fret
}

export const nameOf = (midi: number): string => {
  const m = Math.round(midi)
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`
}

export const hzOf = (midi: number): number => 440 * 2 ** ((midi - 69) / 12)

/** The nearest MIDI note and the offset from it in cents, for a frequency. */
export function pitchOf(hz: number): { midi: number; cents: number } {
  const exact = 69 + 12 * Math.log2(hz / 440)
  const midi = Math.round(exact)
  return { midi, cents: Math.round((exact - midi) * 100) }
}

/**
 * Where a sounding pitch is drawn on a treble staff, as diatonic steps from the
 * bottom line (E4 = 0, F4 = 1, G4 = 2 ... F5 = 8). Guitar is written an octave
 * above where it sounds, so the low open E (E2) lands at written E3, position -7.
 * Sharps are spelled as the natural below with an accidental.
 */
export function staffPosition(midi: number): { pos: number; sharp: boolean } {
  const written = midi + 12
  const octave = Math.floor(written / 12) - 1
  const pc = ((written % 12) + 12) % 12
  // diatonic index of each pitch class and whether it carries a sharp
  const DIATONIC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6] as const
  const SHARP = [false, true, false, true, false, false, true, false, true, false, true, false] as const
  const step = DIATONIC[pc] ?? 0
  // C4 is position -2 (two below the E4 line)
  return { pos: (octave - 4) * 7 + step - 2, sharp: SHARP[pc] ?? false }
}

/** A staff line sits on every even position from 0 to 8; ledger lines on even positions outside. */
export const isLinePosition = (pos: number): boolean => pos % 2 === 0
export const isLedgerPosition = (pos: number): boolean => isLinePosition(pos) && (pos < 0 || pos > 8)

/** The open string closest to a pitch and how far off it is, for the tuner. */
export function nearestString(tuning: readonly number[], midi: number, cents: number) {
  let best = { string: 1, midi: tuning[0] ?? 64, offsetCents: Infinity }
  tuning.forEach((open, i) => {
    const offset = (midi - open) * 100 + cents
    if (Math.abs(offset) < Math.abs(best.offsetCents)) best = { string: i + 1, midi: open, offsetCents: offset }
  })
  return best
}
