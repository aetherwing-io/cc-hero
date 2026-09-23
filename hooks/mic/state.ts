// The file the listener writes and the mod reads: one JSON object, rewritten
// whole (write to a temp name, then rename) so a reader never sees half of it.

/** One note the listener heard start. */
export type Onset = {
  /** Wall-clock milliseconds (Date.now()) when the note began. */
  t: number
  midi: number
  hz: number
  cents: number
  /** RMS level at the onset, 0..1. */
  rms: number
}

export type MicState = {
  /** Wall-clock milliseconds of the last write: a heartbeat. */
  t: number
  /** The listener's process id, so the mod can stop it. */
  pid: number
  /** Wall-clock milliseconds when its first audio sample arrived; onset times count from it. */
  started?: number
  /** What the last frame heard, or null in silence. */
  now: { hz: number; midi: number; cents: number; rms: number } | null
  /** The most recent onsets, oldest first, at most ONSET_RING of them. */
  onsets: Onset[]
  /** A message for the status line: what device it opened, or why it failed. */
  message?: string
  /** Set when the listener gave up: ffmpeg missing, mic refused, and so on. */
  error?: string
}

export const ONSET_RING = 32

/** A heartbeat older than this and the mod treats the listener as gone. */
export const STALE_MS = 2000

export function parseMicState(text: string): MicState | null {
  try {
    const raw: unknown = JSON.parse(text)
    if (typeof raw !== 'object' || raw === null) return null
    const r = raw as Record<string, unknown>
    if (typeof r.t !== 'number' || typeof r.pid !== 'number' || !Array.isArray(r.onsets)) return null
    const onsets = r.onsets.filter((o): o is Onset =>
      typeof o === 'object' && o !== null && typeof (o as Onset).t === 'number' && typeof (o as Onset).midi === 'number')
    const now = typeof r.now === 'object' && r.now !== null && typeof (r.now as { midi?: unknown }).midi === 'number'
      ? (r.now as MicState['now'])
      : null
    const state: MicState = { t: r.t, pid: r.pid, now, onsets }
    if (typeof r.started === 'number' && r.started > 0) state.started = r.started
    if (typeof r.message === 'string') state.message = r.message
    if (typeof r.error === 'string') state.error = r.error
    return state
  } catch {
    return null
  }
}
