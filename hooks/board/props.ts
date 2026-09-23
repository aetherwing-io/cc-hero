// What the hooks module hands the board on each redraw, and what the board posts back.
// Plain JSON both ways: the Client boundary carries no closures.

import type { MicNow, Onset } from '../mic/state.ts'
import type { PlacedChord, PlacedNote, StrumTarget } from '../music/song.ts'

export type MicProps = {
  /** The person asked for the microphone. */
  on: boolean
  /** The listener's heartbeat is fresh. */
  alive: boolean
  /** What the listener said about itself: the device it opened, or why it stopped. */
  message?: string
  /** What the last frame heard, null in silence. */
  now: MicNow | null
  /** Recent note starts, oldest first, wall-clock times. */
  onsets: Onset[]
}

export type BoardSong = { kind: 'notes' | 'chords'; title: string; bpm: number; beatsPerBar: number; tuning: string; notes: PlacedNote[]; chords: PlacedChord[]; strums: StrumTarget[]; strumText?: string }

export type SearchResult = { type: string; song: string; artist: string; votes: number; rating: number }

export type BoardProps = {
  /** Names the loaded song; a new key starts a fresh run. */
  songKey: string
  song: BoardSong | null
  mic: MicProps
  best: number
  view: 'play' | 'tune' | 'search' | 'stats'
  /** The last search: what was asked and what came back, for the search view. */
  search?: { query: string; results: SearchResult[] }
  /** What the hooks are busy with (fetching a page); shown while it lasts. */
  busy?: string
  /** Recent runs and weak spots, for the stats view. */
  stats?: { runs: RunSummary[]; weak: WeakSpot[]; lesson?: string }
  /** Wall-clock milliseconds of beat 0 for a run the hooks start (a recording played along to). */
  startAt?: number
}

export type RunSummary = { title: string; when: string; score: number; accuracy: number; bestCombo: number; tempo: number }
export type WeakSpot = { label: string; misses: number; hits: number }

export type BoardPost =
  | { kind: 'poll' }
  | { kind: 'view'; view: 'play' | 'tune' | 'search' | 'stats' }
  | { kind: 'pick'; index: number }
  | { kind: 'mic'; on: boolean }
  | { kind: 'result'; songKey: string; title: string; score: number; accuracy: number; bestCombo: number; verdict: string; tempo: number; grades: Record<string, number>; hits: Record<string, number>; misses: Record<string, number>; timing: number[] }
  | { kind: 'close' }
