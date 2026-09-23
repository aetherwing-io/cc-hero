// Run history and what it says: the record a finished run leaves, the weak spots
// of a song across its runs, and the summary the coach reads. Pure.

export type RunRecord = {
  key: string
  title: string
  /** Wall-clock milliseconds when the run ended. */
  at: number
  bpm: number
  tempo: number
  score: number
  accuracy: number
  bestCombo: number
  grades: Record<string, number>
  /** Hits and misses by label: a chord name, or a note with its string and fret. */
  hits: Record<string, number>
  misses: Record<string, number>
  /** Timing offsets of the hits in milliseconds, late positive. */
  timing: number[]
}

export const MAX_RUNS = 200

export const withRun = (runs: readonly RunRecord[], run: RunRecord): RunRecord[] => [run, ...runs].slice(0, MAX_RUNS)

export type WeakSpot = { label: string; misses: number; hits: number }

/** Labels missed most across the runs of one song (or all songs), worst first. */
export function weakSpots(runs: readonly RunRecord[], key?: string, limit = 8): WeakSpot[] {
  const by = new Map<string, WeakSpot>()
  for (const r of runs) {
    if (key && r.key !== key) continue
    for (const [label, n] of Object.entries(r.misses)) {
      const w = by.get(label) ?? { label, misses: 0, hits: 0 }
      w.misses += n
      by.set(label, w)
    }
    for (const [label, n] of Object.entries(r.hits)) {
      const w = by.get(label) ?? { label, misses: 0, hits: 0 }
      w.hits += n
      by.set(label, w)
    }
  }
  return [...by.values()].filter(w => w.misses > 0).sort((a, b) => b.misses - a.misses || a.hits - b.hits || a.label.localeCompare(b.label)).slice(0, limit)
}

export type TimingSummary = { mean: number; spread: number; early: number; late: number }

export function timingOf(timing: readonly number[]): TimingSummary | null {
  if (timing.length === 0) return null
  const mean = timing.reduce((a, b) => a + b, 0) / timing.length
  const spread = Math.sqrt(timing.reduce((a, b) => a + (b - mean) ** 2, 0) / timing.length)
  return { mean: Math.round(mean), spread: Math.round(spread), early: timing.filter(t => t < -40).length, late: timing.filter(t => t > 40).length }
}

export const whenOf = (at: number, now: number): string => {
  const min = Math.round((now - at) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

/** A compact, model-readable account of the runs of one song and the player's history overall. */
export function coachNotes(runs: readonly RunRecord[], key: string | undefined, now: number): string {
  const lines: string[] = []
  const mine = key ? runs.filter(r => r.key === key) : runs
  const last = mine[0]
  if (!last) return 'No runs recorded yet.'
  const t = timingOf(last.timing)
  lines.push(`Last run: "${last.title}" at ${last.bpm} bpm ×${last.tempo.toFixed(2)}, ${whenOf(last.at, now)}: ${last.accuracy}% accuracy, ${last.score} points, best combo ${last.bestCombo}.`)
  lines.push(`Grades: ${Object.entries(last.grades).map(([g, n]) => `${g} ${n}`).join(', ')}.`)
  if (t) lines.push(`Timing of hits: mean ${t.mean > 0 ? '+' : ''}${t.mean} ms (${t.mean > 25 ? 'late' : t.mean < -25 ? 'early' : 'on time'}), spread ${t.spread} ms, ${t.early} early and ${t.late} late of ${last.timing.length}.`)
  const worst = Object.entries(last.misses).sort((a, b) => b[1] - a[1]).slice(0, 6)
  if (worst.length) lines.push(`Missed or wrong in the last run: ${worst.map(([l, n]) => `${l} ×${n}`).join(', ')}.`)
  const weak = weakSpots(runs, key, 6)
  if (weak.length) lines.push(`Weak spots across ${mine.length} run(s) of this song: ${weak.map(w => `${w.label} (${w.misses} missed, ${w.hits} hit)`).join('; ')}.`)
  if (mine.length > 1) lines.push(`Accuracy over the last runs, newest first: ${mine.slice(0, 8).map(r => `${r.accuracy}%`).join(', ')}.`)
  const others = runs.filter(r => !key || r.key !== key).slice(0, 5)
  if (others.length) lines.push(`Other songs lately: ${others.map(r => `"${r.title}" ${r.accuracy}%`).join('; ')}.`)
  return lines.join('\n')
}
