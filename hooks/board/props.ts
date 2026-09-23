// What the hooks module hands the board on each redraw, and what the board posts back.
// Plain JSON both ways: the Client boundary carries no closures.

import type { Onset } from '../mic/state.ts'
import type { PlacedNote } from '../music/song.ts'

export type MicProps = {
  /** The person asked for the microphone. */
  on: boolean
  /** The listener's heartbeat is fresh. */
  alive: boolean
  /** What the listener said about itself: the device it opened, or why it stopped. */
  message?: string
  /** What the last frame heard, null in silence. */
  now: { hz: number; midi: number; cents: number; rms: number } | null
  /** Recent note starts, oldest first, wall-clock times. */
  onsets: Onset[]
}

export type BoardSong = { title: string; bpm: number; beatsPerBar: number; tuning: string; notes: PlacedNote[] }

export type BoardProps = {
  /** Names the loaded song; a new key starts a fresh run. */
  songKey: string
  song: BoardSong | null
  mic: MicProps
  best: number
  view: 'play' | 'tune'
  /** Wall-clock milliseconds of beat 0 for a run the hooks start (a recording played along to). */
  startAt?: number
}

export type BoardPost =
  | { kind: 'poll' }
  | { kind: 'view'; view: 'play' | 'tune' }
  | { kind: 'mic'; on: boolean }
  | { kind: 'result'; songKey: string; title: string; score: number; accuracy: number; bestCombo: number; verdict: string }
  | { kind: 'close' }
