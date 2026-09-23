// The judge: which onsets hit which notes, how well, and the running score.
// Pure and deterministic, so the board can replay it and a test can pin it.

import type { PlacedNote } from './song.ts'
import type { Onset } from '../mic/state.ts'

export type Grade = 'perfect' | 'great' | 'good' | 'wrong' | 'miss'

export type Judgment = {
  index: number
  grade: Grade
  /** Milliseconds late (positive) or early (negative); absent on a miss. */
  dtMs?: number
  /** The pitch heard on a wrong note. */
  heardMidi?: number
}

export type Tally = { score: number; base: number; combo: number; bestCombo: number; hits: number; judged: number; byGrade: Record<Grade, number> }

/** Timing windows around a note's start, in milliseconds. */
export const WINDOW = { early: 180, late: 260, perfect: 70, great: 140 } as const

export const POINTS: Record<Grade, number> = { perfect: 100, great: 70, good: 40, wrong: 0, miss: 0 }

export const emptyTally = (): Tally => ({ score: 0, base: 0, combo: 0, bestCombo: 0, hits: 0, judged: 0, byGrade: { perfect: 0, great: 0, good: 0, wrong: 0, miss: 0 } })

export function gradeOf(dtMs: number): Grade {
  const a = Math.abs(dtMs)
  return a <= WINDOW.perfect ? 'perfect' : a <= WINDOW.great ? 'great' : 'good'
}

export function tallyWith(t: Tally, j: Judgment): Tally {
  const hit = j.grade === 'perfect' || j.grade === 'great' || j.grade === 'good'
  const combo = hit ? t.combo + 1 : 0
  // a combo multiplies: x2 from 10 in a row, x3 from 20, x4 from 30
  const mult = 1 + Math.min(3, Math.floor(combo / 10))
  return {
    score: t.score + POINTS[j.grade] * mult,
    base: t.base + POINTS[j.grade],
    combo,
    bestCombo: Math.max(t.bestCombo, combo),
    hits: t.hits + (hit ? 1 : 0),
    judged: t.judged + 1,
    byGrade: { ...t.byGrade, [j.grade]: t.byGrade[j.grade] + 1 },
  }
}

export type JudgeState = {
  /** Judgments so far, by note index. */
  judged: Map<number, Judgment>
  /** Onset timestamps already matched to a note; each onset scores once. */
  used: Set<number>
  tally: Tally
}

export const newJudge = (): JudgeState => ({ judged: new Map(), used: new Set(), tally: emptyTally() })

/**
 * Advances the judge to `nowMs` (song-relative milliseconds): matches onsets to
 * notes whose window they fall in, and misses notes whose window has closed.
 * Onsets carry wall-clock times; `originMs` is the wall-clock time of beat 0.
 * Returns the new judgments, in order.
 */
export function judge(state: JudgeState, notes: readonly PlacedNote[], onsets: readonly Onset[], nowMs: number, msPerBeat: number, originMs: number): Judgment[] {
  const out: Judgment[] = []
  const settle = (j: Judgment) => {
    state.judged.set(j.index, j)
    state.tally = tallyWith(state.tally, j)
    out.push(j)
  }
  for (const n of notes) {
    if (state.judged.has(n.index)) continue
    const at = n.beat * msPerBeat
    if (at - WINDOW.early > nowMs) break // notes are sorted; the rest are still ahead
    // the onset nearest the note's start, right pitch first
    let best: { o: Onset; dt: number } | undefined
    let wrong: { o: Onset; dt: number } | undefined
    for (const o of onsets) {
      if (state.used.has(o.t)) continue
      const dt = o.t - originMs - at
      if (dt < -WINDOW.early || dt > WINDOW.late) continue
      if (o.midi === n.midi) {
        if (!best || Math.abs(dt) < Math.abs(best.dt)) best = { o, dt }
      } else if (!wrong || Math.abs(dt) < Math.abs(wrong.dt)) wrong = { o, dt }
    }
    if (best) {
      state.used.add(best.o.t)
      settle({ index: n.index, grade: gradeOf(best.dt), dtMs: Math.round(best.dt) })
      continue
    }
    if (at + WINDOW.late <= nowMs) {
      // the window closed: a wrong pitch in it is a "wrong", silence a "miss"
      if (wrong) {
        state.used.add(wrong.o.t)
        settle({ index: n.index, grade: 'wrong', dtMs: Math.round(wrong.dt), heardMidi: wrong.o.midi })
      } else settle({ index: n.index, grade: 'miss' })
    }
  }
  return out
}

/** Accuracy as a percentage of the points available for the notes judged so far. */
export const accuracyOf = (t: Tally): number => (t.judged === 0 ? 100 : Math.round((t.base / (t.judged * POINTS.perfect)) * 100))

/** A one-word verdict for a finished run. */
export function verdictOf(t: Tally): string {
  const acc = accuracyOf(t)
  return acc >= 95 ? 'flawless' : acc >= 80 ? 'solid' : acc >= 60 ? 'getting there' : 'keep at it'
}
