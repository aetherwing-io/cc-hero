/* @jsx h */
// The board: a surface module drawing the song as it scrolls past the now-marker,
// tablature on top and a treble staff below, and judging what the microphone (or
// the space bar) plays against it. Runs on the drawing thread with its own frame
// clock and keys; it reaches the hooks module only by posting.
//
// Never name a local `h` here: every JSX tag compiles to a call of `h`.

import type { ClientElements, ClientSurface } from 'claude-code'
import type { Onset } from '../mic/state.ts'
import type { BoardPost, BoardProps, BoardSong } from './props.ts'
import { isLinePosition, nameOf, nearestString, staffPosition, STRING_LABELS, TUNINGS } from '../music/notes.ts'
import { accuracyOf, judge, newJudge, verdictOf, WINDOW, type Grade, type JudgeState, type Judgment, type Target } from '../music/score.ts'
import { chordLengthOf, lengthOf } from '../music/song.ts'
import { templateOf } from '../music/chords.ts'

type Mode = 'idle' | 'countin' | 'playing' | 'paused' | 'done'

type State = {
  songKey: string
  mode: Mode
  /** Wall-clock milliseconds of beat 0. */
  origin: number
  pausedAt: number
  tempo: number
  judge: JudgeState
  last?: Judgment
  strums: Onset[]
  help: boolean
  posted: boolean
  ticks: number
  /** The `startAt` prop this run was started from, so it starts once. */
  startedFrom?: number
  /** The search view's cursor, and the query it belongs to. */
  cursor: number
  cursorFor?: string
}

type Cell = { g: string; c?: string; b?: string; bold?: boolean; dim?: boolean; inv?: boolean }
type TextTag = ClientElements['Text']

const LABEL = 2
const FRAME_MS = 50
const TAIL_BEATS = 2

// the latest props and the posts waiting for the next frame: one instance per plugin
let latest: BoardProps | undefined
const queue: BoardPost[] = []
const enqueue = (p: BoardPost) => { queue.push(p) }

const now = () => Date.now()
const msPerBeat = (song: BoardSong, tempo: number) => 60000 / (song.bpm * tempo)
const targetsOf = (song: BoardSong): readonly Target[] => (song.kind === 'chords' ? (song.strums.length ? song.strums : song.chords) : song.notes)
const songLength = (song: BoardSong) => (song.kind === 'chords' ? chordLengthOf(song.chords) : lengthOf(song.notes))

function fresh(songKey: string): State {
  return { songKey, mode: 'idle', origin: 0, pausedAt: 0, tempo: 1, judge: newJudge(), strums: [], help: false, posted: false, ticks: 0, cursor: 0 }
}

/** Song-relative milliseconds for a state, negative before beat 0. */
function elapsedOf(s: State, song: BoardSong): number {
  const mpb = msPerBeat(song, s.tempo)
  switch (s.mode) {
    case 'idle': return -song.beatsPerBar * mpb
    case 'paused':
    case 'done': return s.pausedAt - s.origin
    default: return now() - s.origin
  }
}

function start(s: State, song: BoardSong): State {
  const mpb = msPerBeat(song, s.tempo)
  return { ...fresh(s.songKey), tempo: s.tempo, help: s.help, mode: 'countin', origin: now() + song.beatsPerBar * mpb }
}

function retempo(s: State, song: BoardSong, tempo: number): State {
  const next = Math.max(0.4, Math.min(2, Math.round(tempo * 100) / 100))
  if (s.mode === 'idle' || s.mode === 'done') return { ...s, tempo: next }
  const beat = elapsedOf(s, song) / msPerBeat(song, s.tempo)
  const at = s.mode === 'paused' ? s.pausedAt : now()
  return { ...s, tempo: next, origin: at - beat * msPerBeat(song, next) }
}

const GRADE_COLOR: Record<Grade, string> = { perfect: 'greenBright', great: 'green', good: 'yellow', wrong: 'magenta', miss: 'red' }
const GRADE_WORD: Record<Grade, string> = { perfect: 'PERFECT', great: 'great', good: 'good', wrong: 'wrong note', miss: 'miss' }

export default function Hero(props: BoardProps, surface: ClientSurface<State>) {
  latest = props
  const { Box, Text } = surface.elements

  if (surface.state === undefined) {
    surface.setState(fresh(props.songKey))
    surface.every(FRAME_MS, () => {
      const s = surface.state
      const p = latest
      if (!s || !p) return
      // one post per frame: a queued request first, else a poll while the mic is on
      const post = queue.shift() ?? (p.mic.on || s.ticks % 20 === 0 ? { kind: 'poll' } as const : undefined)
      if (post) surface.post(post)
      let next: State = { ...s, ticks: s.ticks + 1 }
      const song = p.song
      if (song && (s.mode === 'countin' || s.mode === 'playing')) {
        const mpb = msPerBeat(song, s.tempo)
        const t = now() - s.origin
        if (s.mode === 'countin' && t >= 0) next.mode = 'playing'
        const onsets: Onset[] = p.mic.on ? [...p.mic.onsets, ...s.strums] : s.strums
        const made = judge(s.judge, targetsOf(song), onsets, t, mpb, s.origin)
        const lastMade = made[made.length - 1]
        if (lastMade) next.last = lastMade
        if (next.mode === 'playing' && t > (songLength(song) + TAIL_BEATS) * mpb) {
          next = { ...next, mode: 'done', pausedAt: now() }
          if (!next.posted) {
            next.posted = true
            const tally = s.judge.tally
            const hits: Record<string, number> = {}
            const misses: Record<string, number> = {}
            const timing: number[] = []
            const labelOf = (index: number): string => {
              if (song.kind === 'chords') return (song.strums.find(t => t.index === index)?.name ?? song.chords.find(c => c.index === index)?.name) ?? '?'
              const n = song.notes.find(x => x.index === index)
              return n ? `${nameOf(n.midi)} s${n.string} f${n.fret}` : '?'
            }
            for (const [index, j] of s.judge.judged) {
              const label = labelOf(index)
              const hit = j.grade === 'perfect' || j.grade === 'great' || j.grade === 'good'
              if (hit) { hits[label] = (hits[label] ?? 0) + 1; if (j.dtMs !== undefined) timing.push(j.dtMs) }
              else misses[label] = (misses[label] ?? 0) + 1
            }
            enqueue({ kind: 'result', songKey: p.songKey, title: song.title, score: tally.score, accuracy: accuracyOf(tally), bestCombo: tally.bestCombo, verdict: verdictOf(tally), tempo: s.tempo, grades: { ...tally.byGrade }, hits, misses, timing })
          }
        }
      }
      surface.setState(next)
    })
    surface.onKey(({ key }) => {
      const s = surface.state
      const p = latest
      if (!s || !p) return
      const song = p.song
      const k = key === 'space' ? ' ' : key.length === 1 ? key.toLowerCase() : key
      if (p.view === 'stats') {
        if (k === 't' || k === 'escape' || k === 'return') return enqueue({ kind: 'view', view: 'play' })
        if (k === 'q') return enqueue({ kind: 'close' })
        return
      }
      if (p.view === 'search' && p.search) {
        const n = p.search.results.length
        if (k === 'down' || k === 'j') return surface.setState({ ...s, cursor: n ? (s.cursor + 1) % n : 0 })
        if (k === 'up' || k === 'k') return surface.setState({ ...s, cursor: n ? (s.cursor - 1 + n) % n : 0 })
        if (/^[1-9]$/.test(k) && Number(k) <= n) return surface.setState({ ...s, cursor: Number(k) - 1 })
        if ((k === 'return' || k === ' ') && n) return enqueue({ kind: 'pick', index: s.cursor })
        if (k === 't' || k === 'escape') return enqueue({ kind: 'view', view: 'play' })
        if (k === 'q') return enqueue({ kind: 'close' })
        return
      }
      if (k === '?') return surface.setState({ ...s, help: !s.help })
      if (k === 't') return enqueue({ kind: 'view', view: p.view === 'tune' ? 'play' : 'tune' })
      if (k === 'm') return enqueue({ kind: 'mic', on: !p.mic.on })
      if (k === 'q') return enqueue({ kind: 'close' })
      if (!song || p.view === 'tune') return
      if (k === 'return' || k === 'r') return surface.setState(start(s, song))
      if (k === '+' || k === '=') return surface.setState(retempo(s, song, s.tempo + 0.05))
      if (k === '-' || k === '_') return surface.setState(retempo(s, song, s.tempo - 0.05))
      if (k === 'p') {
        if (s.mode === 'playing' || s.mode === 'countin') return surface.setState({ ...s, mode: 'paused', pausedAt: now() })
        if (s.mode === 'paused') return surface.setState({ ...s, mode: 'playing', origin: s.origin + (now() - s.pausedAt) })
        return
      }
      if (k === ' ') {
        if (s.mode === 'idle' || s.mode === 'done') return surface.setState(start(s, song))
        if (s.mode !== 'playing' && s.mode !== 'countin') return
        // a strum: the right pitch (or chord) for whichever unjudged target is nearest in time
        const t = now()
        const mpb = msPerBeat(song, s.tempo)
        const rel = t - s.origin
        let target: { n: Target; dt: number } | undefined
        for (const n of targetsOf(song)) {
          if (s.judge.judged.has(n.index)) continue
          const dt = rel - n.beat * mpb
          if (dt < -WINDOW.early || dt > WINDOW.late) continue
          if (!target || Math.abs(dt) < Math.abs(target.dt)) target = { n, dt }
        }
        const strum: Onset = { t, midi: target?.n.midi ?? -1, hz: 0, cents: 0, rms: 1 }
        if (target?.n.pcs) strum.chroma = templateOf(target.n.pcs)
        const strums = [...s.strums.slice(-40), strum]
        return surface.setState({ ...s, strums })
      }
    })
  }

  let s = surface.state
  if (!s) return <Text dimColor>cc-hero: loading…</Text>
  if (s.songKey !== props.songKey) {
    s = fresh(props.songKey)
    surface.setState(s)
  }
  // a run the hooks start, timed to a recording: beat 0 at startAt, count-in before it
  if (props.song && props.startAt !== undefined && props.startAt !== s.startedFrom && props.view === 'play') {
    s = { ...fresh(s.songKey), tempo: s.tempo, help: s.help, mode: now() < props.startAt ? 'countin' : 'playing', origin: props.startAt, startedFrom: props.startAt }
    surface.setState(s)
  }

  const columns = surface.columns
  const rows = surface.rows
  if (columns < 40 || rows < 8) return <Text dimColor>cc-hero needs a wider, taller pane (drag its edge, or dock it in a fullscreen terminal)</Text>

  if (props.view === 'search') return searchView(Text, Box, props, s, surface, columns, rows)
  if (props.view === 'stats') return statsView(Text, Box, props, columns, rows)
  if (props.view === 'tune') return tuner(Text, Box, props, columns)
  if (!props.song) return <Text dimColor>no song loaded · /hero play ode · /hero list · /hero search {'<song>'}</Text>

  return props.song.kind === 'chords' ? chordBoard(Text, Box, props, props.song, s, columns, rows) : board(Text, Box, props, props.song, s, columns, rows)
}

/** A strummed chord's name in the status: what the listener matched, or the note it settled on. */
const heardText = (mic: BoardProps['mic']) => {
  const h = mic.now
  if (!h) return null
  if (h.chord && (h.midi < 0 || (h.chordScore ?? 0) >= 0.8)) return `${h.chord}${h.chordScore !== undefined ? ` ${Math.round(h.chordScore * 100)}%` : ''}`
  return h.midi >= 0 ? `${nameOf(h.midi)} ${h.cents >= 0 ? '+' : ''}${h.cents}¢` : null
}

function micStatus(props: BoardProps): string {
  const heard = heardText(props.mic)
  return !props.mic.on ? 'mic off · space strums · m for mic'
    : !props.mic.alive ? `mic starting… ${props.mic.message ?? ''}`.trim()
    : heard ? `mic ● ${heard}`
    : props.mic.message && /exited|not start|stopped/.test(props.mic.message) ? `mic ✗ ${props.mic.message}` : 'mic ○'
}

function statusOf(s: State, props: BoardProps, elapsed: number, mpb: number): { text: string; color?: string } {
  const tally = s.judge.tally
  const micText = micStatus(props)
  switch (s.mode) {
    case 'idle': return { text: `space or enter starts · ${micText} · t tuner · ? keys` }
    case 'countin': return { text: `count-in ${Math.max(1, Math.ceil(-elapsed / mpb))} · ${micText}`, color: 'yellow' }
    case 'paused': return { text: 'paused · p resumes · r restarts', color: 'yellow' }
    case 'done': return { text: `done · ${verdictOf(tally)} · ${tally.score} pts · ${accuracyOf(tally)}% · best combo ${tally.bestCombo} · enter plays again`, color: 'cyan' }
    case 'playing': {
      const j = s.last
      const word = !j ? '…' : j.grade === 'wrong' ? `wrong: heard ${j.heard ?? (j.heardMidi === undefined ? '?' : nameOf(j.heardMidi))}` : j.grade === 'miss' ? 'miss' : `${GRADE_WORD[j.grade]} ${j.dtMs === undefined ? '' : `(${j.dtMs > 0 ? '+' : ''}${j.dtMs}ms)`}`
      return { text: `${word} · ${micText}`, color: j ? GRADE_COLOR[j.grade] : undefined }
    }
  }
}

const HELP = 'enter/space start · space strum · p pause · r restart · +/- tempo · m mic · t tuner · ? hide · q close · esc back to prompt'

/** The chord sheet view: a lane of chord names, the current and next shapes, the words. */
function chordBoard(Text: TextTag, Box: ClientElements['Box'], props: BoardProps, song: BoardSong, s: State, columns: number, rows: number) {
  const mpb = msPerBeat(song, s.tempo)
  const elapsed = elapsedOf(s, song)
  const beat = elapsed / mpb
  const laneCols = columns - LABEL
  const CPB = laneCols >= 56 ? 4 : 3
  const NOW = Math.max(4, Math.min(12, Math.floor(laneCols / 5)))
  const xOf = (b: number) => LABEL + NOW + Math.round((b - beat) * CPB)
  const grid: Cell[][] = Array.from({ length: rows }, () => Array.from({ length: columns }, () => ({ g: ' ' })))
  const put = (x: number, y: number, cell: Cell) => { if (x >= 0 && x < columns && y >= 0 && y < rows) grid[y]![x] = cell }
  const text = (x: number, y: number, t: string, style: Omit<Cell, 'g'> = {}) => { for (let i = 0; i < t.length; i++) put(x + i, y, { g: t[i] ?? ' ', ...style }) }
  const chords = song.chords

  // rows: header, section, six tab lines with each chord's voicing stacked at its beat, a ruler,
  // the chord lane under them, a gap, seven rows of diagrams, a gap, three lyric rows, status
  const TAB = 2
  const RULER = TAB + 6
  const LANE = RULER + 1
  const DIAG = LANE + (song.strums.length ? 3 : 2)
  const LYR = DIAG + 8
  const statusRow = Math.min(rows - 1, LYR + 3)

  for (let i = 0; i < 6; i++) {
    put(0, TAB + i, { g: STRING_LABELS[i] ?? '?', dim: true })
    put(1, TAB + i, { g: '|', dim: true })
    for (let x = LABEL; x < columns; x++) put(x, TAB + i, { g: '─', dim: true })
  }
  for (let x = LABEL; x < columns; x++) put(x, LANE, { g: '─', dim: true })
  const firstBeat = Math.floor(beat - NOW / CPB) - 1
  const lastBeat = Math.ceil(beat + (laneCols - NOW) / CPB) + 1
  for (let b = Math.max(0, firstBeat); b <= lastBeat; b++) {
    const x = xOf(b)
    if (x < LABEL || x >= columns) continue
    const isBar = b % song.beatsPerBar === 0
    if (isBar) { for (let i = 0; i < 6; i++) put(x, TAB + i, { g: '┊', dim: true }); put(x, LANE, { g: '┊', dim: true }) }
    put(x, RULER, isBar ? { g: String(b / song.beatsPerBar + 1), dim: true } : { g: '·', dim: true })
  }
  for (let i = 0; i < 6; i++) put(LABEL + NOW, TAB + i, { g: '│', c: 'yellow' })
  put(LABEL + NOW, RULER, { g: '▼', c: 'yellow' })
  put(LABEL + NOW, LANE, { g: '│', c: 'yellow' })
  // strums under the pattern: arrows on the lane's row above, each colored by its grade
  const STRUMS = LANE + 1
  if (song.strums.length) {
    put(0, STRUMS, { g: '♪', dim: true })
    for (const t of song.strums) {
      const x = xOf(t.beat)
      if (x < LABEL || x >= columns) continue
      const j = s.judge.judged.get(t.index)
      const dtMs = (t.beat - beat) * mpb
      const inWindow = dtMs >= -WINDOW.late && dtMs <= WINDOW.early
      const g = t.dir === 'd' ? '↓' : t.dir === 'u' ? '↑' : t.dir === 'x' ? 'x' : 'X'
      put(x, STRUMS, { g, c: j ? GRADE_COLOR[j.grade] : inWindow ? 'yellow' : t.beat < beat ? 'gray' : 'white', bold: !!j || inWindow })
    }
  }

  // the current chord: the last one that started; the next: the one after it
  let current: (typeof chords)[number] | undefined
  let next: (typeof chords)[number] | undefined
  for (const c of chords) {
    if (c.beat <= beat) current = c
    else { next = c; break }
  }
  if (!current) next = chords[0]

  for (const c of chords) {
    const x = xOf(c.beat)
    const end = xOf(c.beat + c.len) - 1
    if (end < LABEL || x >= columns) continue
    const j = s.judge.judged.get(c.index)
    const dtMs = (c.beat - beat) * mpb
    const inWindow = dtMs >= -WINDOW.late && dtMs <= WINDOW.early
    const color = j ? GRADE_COLOR[j.grade] : inWindow ? 'yellow' : c.beat < beat ? 'gray' : 'white'
    const onNow = x <= LABEL + NOW && end >= LABEL + NOW
    // the voicing as tab: frets stacked at the chord's beat, string 1 on top, again dimly at each later strum beat
    for (let b = 0; b < c.len; b += 2) {
      const sx = xOf(c.beat + b)
      if (sx < LABEL || sx >= columns) continue
      const first = b === 0
      for (let i = 0; i < 6; i++) {
        const f = c.frets[5 - i] ?? -1
        const g = f < 0 ? 'x' : String(f)
        for (let k = 0; k < g.length; k++) put(sx + k, TAB + i, { g: g[k] ?? ' ', c: color, bold: first && (c === current || inWindow), dim: !first && !j, inv: first && onNow && !j })
      }
    }
    text(x, LANE, c.name.slice(0, Math.max(1, end - x + 1)), { c: color, bold: c === current || inWindow, inv: onNow && !j })
    if (c.section && x >= LABEL) text(x, 1, c.section, { c: 'cyan', dim: true })
  }
  const heard = props.mic.on && props.mic.now?.chord && (props.mic.now.chordScore ?? 0) >= 0.75 ? props.mic.now.chord : undefined
  if (heard) text(LABEL + NOW + 1, 1, `♪ ${heard}`, { c: 'magenta', bold: true })

  // diagrams: the current chord at the left, the next beside it
  const drawShape = (x0: number, c: (typeof chords)[number], title: string, style: Omit<Cell, 'g'>) => {
    text(x0, DIAG, `${title} ${c.name}`, { ...style, bold: true })
    const base = c.base
    const mutes = c.frets.map(f => (f < 0 ? 'x' : f === 0 ? 'o' : ' ')).join(' ')
    text(x0, DIAG + 1, mutes, { dim: true })
    text(x0, DIAG + 2, base === 1 ? '┌─┬─┬─┬─┬─┐' : `${String(base).padStart(2)}fr`, { dim: true })
    for (let r = 0; r < 4; r++) {
      const fret = base + r
      const row = c.frets.map(f => (f === fret ? '●' : '│')).join(' ')
      text(x0, DIAG + 3 + r, row, { ...style })
    }
    text(x0, DIAG + 7, 'E A D G B e', { dim: true })
  }
  if (current) drawShape(LABEL, current, 'now:', { c: s.judge.judged.get(current.index) ? GRADE_COLOR[s.judge.judged.get(current.index)!.grade] : 'white' })
  if (next) drawShape(LABEL + 18, next, 'next:', { c: 'cyan' })

  // lyrics: the current line with the word being sung, the next line dim below
  const lineOf = (line: number) => chords.filter(c => c.line === line)
  const wordsOf = (line: number) => lineOf(line).flatMap(c => c.words.map(w => ({ at: c.beat + w.at, text: w.text })))
  const curLine = current?.line ?? next?.line
  if (curLine !== undefined) {
    const words = wordsOf(curLine)
    let x = LABEL
    let activeIdx = -1
    words.forEach((w, i) => { if (w.at <= beat) activeIdx = i })
    for (let i = 0; i < words.length && x < columns; i++) {
      const w = words[i]!
      text(x, LYR + 1, w.text, i === activeIdx ? { c: 'yellow', bold: true, inv: true } : i < activeIdx ? { dim: true } : { c: 'white' })
      x += w.text.length + 1
    }
    const after = chords.find(c => c.line > curLine)
    if (after) {
      const nextWords = wordsOf(after.line).map(w => w.text).join(' ')
      text(LABEL, LYR + 2, nextWords.slice(0, columns - LABEL), { dim: true })
    }
    const before = [...chords].reverse().find(c => c.line < curLine)
    if (before) text(LABEL, LYR, wordsOf(before.line).map(w => w.text).join(' ').slice(0, columns - LABEL), { dim: true })
  }

  const tally = s.judge.tally
  const tempo = s.tempo === 1 ? '' : ` ×${s.tempo.toFixed(2)}`
  const header = `♪ ${song.title} · chords${song.strumText ? ` · ${song.strumText}` : ''} · ${song.bpm} bpm${tempo} · ${tally.score} pts · combo ${tally.combo} · ${accuracyOf(tally)}%${props.best ? ` · best ${props.best}` : ''}`
  const status = statusOf(s, props, elapsed, mpb)
  const lines = grid.slice(0, statusRow).map((row, y) => (y === 0 ? <Text bold wrap="truncate-end">{header}</Text> : <Text>{runsOf(row).map(([t, c]) => <Text color={c.c} backgroundColor={c.b} bold={c.bold} dimColor={c.dim} inverse={c.inv}>{t}</Text>)}</Text>))
  lines.push(<Text color={status.color} wrap="truncate-end">{status.text}</Text>)
  if (s.help && statusRow + 1 < rows) lines.push(<Text dimColor wrap="truncate-end">{HELP}</Text>)
  return <Box flexDirection="column">{lines}</Box>
}

/** The stats view: recent runs, the weak spots of the current song, the lesson in progress. */
function statsView(Text: TextTag, Box: ClientElements['Box'], props: BoardProps, columns: number, rows: number) {
  const st = props.stats
  const lines: ReturnType<TextTag>[] = []
  lines.push(<Text bold wrap="truncate-end">{`stats${props.song ? ` · ${props.song.title}` : ''} · t back · q close`}</Text>)
  if (!st || st.runs.length === 0) {
    lines.push(<Text dimColor>no runs yet: play a song through and come back</Text>)
    return <Box flexDirection="column">{lines}</Box>
  }
  if (st.lesson) lines.push(<Text color="cyan" wrap="truncate-end">{st.lesson}</Text>)
  lines.push(<Text dimColor>recent runs</Text>)
  for (const r of st.runs.slice(0, Math.max(3, Math.min(10, rows - 12)))) {
    const bar = '█'.repeat(Math.round(r.accuracy / 10)).padEnd(10, '·')
    lines.push(<Text wrap="truncate-end">{`  ${r.when.padEnd(11)} `}<Text color={r.accuracy >= 90 ? 'greenBright' : r.accuracy >= 70 ? 'green' : r.accuracy >= 50 ? 'yellow' : 'red'}>{bar}</Text>{` ${String(r.accuracy).padStart(3)}% · ${String(r.score).padStart(5)} pts · combo ${String(r.bestCombo).padStart(3)}${r.tempo !== 1 ? ` · ×${r.tempo.toFixed(2)}` : ''} · ${r.title.slice(0, Math.max(10, columns - 60))}`}</Text>)
  }
  if (st.weak.length) {
    lines.push(<Text> </Text>)
    lines.push(<Text dimColor>weak spots (most missed, this song)</Text>)
    for (const w of st.weak.slice(0, 6)) {
      const total = w.misses + w.hits
      lines.push(<Text wrap="truncate-end">{`  ${w.label.padEnd(16)} `}<Text color="red">{'▮'.repeat(Math.min(20, w.misses))}</Text>{` ${w.misses} missed of ${total} (${Math.round((w.hits / Math.max(1, total)) * 100)}% hit)`}</Text>)
    }
  }
  return <Box flexDirection="column">{lines}</Box>
}

/** The search view: results under a cursor; up and down move it, enter opens, t goes back. */
function searchView(Text: TextTag, Box: ClientElements['Box'], props: BoardProps, s: State, surface: ClientSurface<State>, columns: number, rows: number) {
  const search = props.search
  const lines: ReturnType<TextTag>[] = []
  if (!search) {
    lines.push(<Text dimColor>{'/hero search <song or artist> looks a song up on Ultimate Guitar'}</Text>)
    return <Box flexDirection="column">{lines}</Box>
  }
  if (s.cursorFor !== search.query) surface.setState({ ...s, cursor: 0, cursorFor: search.query })
  const cursor = s.cursorFor === search.query ? s.cursor : 0
  lines.push(<Text bold wrap="truncate-end">{`search: ${search.query} · ${search.results.length} results · ↑↓ or j/k move · enter opens · 1-9 jump · t back · q close`}</Text>)
  if (props.busy) lines.push(<Text color="yellow" wrap="truncate-end">{props.busy}</Text>)
  const visible = Math.max(3, rows - 3)
  const top = Math.max(0, Math.min(cursor - Math.floor(visible / 2), search.results.length - visible))
  search.results.slice(top, top + visible).forEach((r, i) => {
    const index = top + i
    const at = index === cursor
    const num = String(index + 1).padStart(2)
    const text = `${at ? '▶' : ' '} ${num}. ${r.type.padEnd(6)} ${r.song} · ${r.artist} · ${r.votes} votes${r.rating ? ` · ${r.rating.toFixed(1)}★` : ''}`
    lines.push(<Text color={at ? 'yellow' : r.type === 'Chords' ? 'cyan' : 'white'} bold={at} inverse={at} wrap="truncate-end">{text.slice(0, columns)}</Text>)
  })
  if (search.results.length === 0) lines.push(<Text dimColor>nothing found (chords and tabs only)</Text>)
  return <Box flexDirection="column">{lines}</Box>
}

function tuner(Text: TextTag, Box: ClientElements['Box'], props: BoardProps, columns: number) {
  const mic = props.mic
  const tuning = TUNINGS[props.song?.tuning ?? 'standard'] ?? TUNINGS.standard!
  const lines: ReturnType<TextTag>[] = []
  lines.push(<Text bold>{`cc-hero tuner · ${mic.on ? (mic.alive ? 'mic ●' : 'mic starting…') : 'mic off (m turns it on)'} · t back to the song · q closes`}</Text>)
  lines.push(<Text> </Text>)
  if (!mic.on) {
    lines.push(<Text dimColor>press m to start listening (needs ffmpeg; macOS asks once for microphone access)</Text>)
  } else if (!mic.alive) {
    lines.push(<Text color="yellow">{mic.message ?? 'waiting for the listener…'}</Text>)
  } else if (!mic.now) {
    lines.push(<Text dimColor>silence · play one string and let it ring</Text>)
  } else {
    const { midi, cents, hz, rms } = mic.now
    const color = Math.abs(cents) <= 5 ? 'greenBright' : Math.abs(cents) <= 15 ? 'yellow' : 'red'
    const near = nearestString(tuning, midi, cents)
    const width = Math.min(41, Math.max(21, columns - 12))
    const half = Math.floor(width / 2)
    const at = half + Math.max(-half, Math.min(half, Math.round((cents / 50) * half)))
    const meter = Array.from({ length: width }, (_, i) => (i === at ? '●' : i === half ? '│' : '─')).join('')
    const off = near.offsetCents
    const advice = Math.abs(off) <= 5 ? 'in tune' : Math.abs(off) > 250 ? 'far from any string' : off > 0 ? `${Math.abs(off)}¢ sharp → tune down` : `${Math.abs(off)}¢ flat → tune up`
    lines.push(<Text>{'  '}<Text color={color} bold>{nameOf(midi).padEnd(4)}</Text><Text dimColor>{`${hz.toFixed(1)} Hz  ${cents >= 0 ? '+' : ''}${cents}¢`}</Text></Text>)
    lines.push(<Text>{'  ♭ '}<Text color={color}>{meter}</Text>{' ♯'}</Text>)
    lines.push(<Text>{`  string ${near.string} (${STRING_LABELS[near.string - 1]} · ${nameOf(near.midi)}) · `}<Text color={color}>{advice}</Text></Text>)
    lines.push(<Text dimColor>{`  level ${'▮'.repeat(Math.min(20, Math.round(rms * 60)))}`}</Text>)
  }
  if (mic.message && mic.alive) lines.push(<Text dimColor>{mic.message}</Text>)
  return <Box flexDirection="column">{lines}</Box>
}

function board(Text: TextTag, Box: ClientElements['Box'], props: BoardProps, song: BoardSong, s: State, columns: number, rows: number) {
  const mpb = msPerBeat(song, s.tempo)
  const elapsed = elapsedOf(s, song)
  const beat = elapsed / mpb
  const laneCols = columns - LABEL
  const CPB = laneCols >= 56 ? 4 : 3
  const NOW = Math.max(4, Math.min(12, Math.floor(laneCols / 5)))
  const xOf = (b: number) => LABEL + NOW + Math.round((b - beat) * CPB)

  // rows: header, six tab strings, a ruler (with chord names and picking fingers when the song has them), the staff, status, help
  const hasFingers = song.notes.some(n => n.finger)
  const fixed = 1 + 6 + 1 + 1 + (s.help ? 1 : 0) + (hasFingers ? 1 : 0)
  let maxPos = 8
  let minPos = 0
  for (const n of song.notes) { maxPos = Math.max(maxPos, n.pos); minPos = Math.min(minPos, n.pos) }
  let staffRows = maxPos - minPos + 1
  const spare = rows - fixed
  while (staffRows > spare && (maxPos > 8 || minPos < 0)) {
    if (maxPos > 8 && (maxPos - 8 >= -minPos)) maxPos--
    else minPos++
    staffRows = maxPos - minPos + 1
  }
  const showStaff = staffRows <= spare
  const staffTop = hasFingers ? 9 : 8
  const rowOfPos = (pos: number) => (showStaff && pos <= maxPos && pos >= minPos ? staffTop + (maxPos - pos) : -1)
  const statusRow = showStaff ? staffTop + staffRows : staffTop
  const helpRow = statusRow + 1

  const grid: Cell[][] = Array.from({ length: rows }, () => Array.from({ length: columns }, () => ({ g: ' ' })))
  const put = (x: number, y: number, cell: Cell) => { if (x >= 0 && x < columns && y >= 0 && y < rows) grid[y]![x] = cell }
  const at = (x: number, y: number) => grid[y]?.[x]
  const isBackground = (c: Cell | undefined) => !c || c.g === ' ' || c.g === '─' || c.g === '·' || c.g === '┊'

  // tab lines and labels
  for (let i = 0; i < 6; i++) {
    const y = 1 + i
    put(0, y, { g: STRING_LABELS[i] ?? '?', dim: true })
    put(1, y, { g: '|', dim: true })
    for (let x = LABEL; x < columns; x++) put(x, y, { g: '─', dim: true })
  }
  // staff lines
  if (showStaff) {
    for (let pos = minPos; pos <= maxPos; pos++) {
      const y = rowOfPos(pos)
      if (pos >= 0 && pos <= 8 && isLinePosition(pos)) for (let x = LABEL; x < columns; x++) put(x, y, { g: '─', dim: true })
    }
    const clefRow = rowOfPos(4)
    if (clefRow >= 0) put(0, clefRow, { g: '𝄞', c: 'cyan' })
  }
  // bar lines and the ruler
  const firstBeat = Math.floor(beat - NOW / CPB) - 1
  const lastBeat = Math.ceil(beat + (laneCols - NOW) / CPB) + 1
  for (let b = Math.max(0, firstBeat); b <= lastBeat; b++) {
    const x = xOf(b)
    if (x < LABEL || x >= columns) continue
    const isBar = b % song.beatsPerBar === 0
    for (let y = 1; y <= 6; y++) put(x, y, isBar ? { g: '┊', dim: true } : at(x, y)!)
    if (showStaff) for (let pos = 0; pos <= 8; pos++) if (isBar) put(x, rowOfPos(pos), { g: '┊', dim: true })
    put(x, 7, isBar ? { g: String(b / song.beatsPerBar + 1), dim: true } : { g: '·', dim: true })
  }
  // the now-marker
  for (let y = 1; y < statusRow; y++) if (isBackground(at(LABEL + NOW, y))) put(LABEL + NOW, y, { g: y === 7 ? '▼' : '│', c: 'yellow' })

  // notes
  for (const n of song.notes) {
    const x = xOf(n.beat)
    if (x + 1 < LABEL || x >= columns) continue
    const j = s.judge.judged.get(n.index)
    const dtBeats = n.beat - beat
    const inWindow = dtBeats * mpb >= -WINDOW.late && dtBeats * mpb <= WINDOW.early
    const color = j ? GRADE_COLOR[j.grade] : inWindow ? 'yellow' : dtBeats < 0 ? 'gray' : 'white'
    const bold = j ? j.grade === 'perfect' : inWindow || dtBeats < 1
    // tab: the fret, and a tail for the note's length
    const ty = n.string
    const fret = String(n.fret)
    const tailEnd = xOf(n.beat + n.len) - 1
    for (let tx = x + fret.length; tx <= tailEnd; tx++) if (isBackground(at(tx, ty))) put(tx, ty, { g: '═', c: color, dim: !j && !inWindow })
    for (let i = 0; i < fret.length; i++) put(x + i, ty, { g: fret[i] ?? ' ', c: color, bold, inv: x + i === LABEL + NOW })
    if (hasFingers && n.finger && x >= LABEL) put(x, 8, { g: n.finger, c: color, dim: !inWindow && !j })
    // the chord the note belongs to, named once where it begins
    if (n.chord && x >= LABEL + 1 && !song.notes.some(o => o.chord === n.chord && o.beat < n.beat && o.beat > n.beat - song.beatsPerBar)) {
      // beside the bar number, where the whole name fits
      const lx = isBackground(at(x, 7)) ? x : x + 1
      const fits = [...n.chord].every((_, i) => isBackground(at(lx + i, 7)))
      if (fits) for (let i = 0; i < n.chord.length; i++) put(lx + i, 7, { g: n.chord[i] ?? ' ', c: 'cyan' })
    }
    // staff: ledger lines, the accidental, the head
    if (!showStaff) continue
    const y = rowOfPos(n.pos)
    if (y < 0) continue
    const ledgers: number[] = []
    if (n.pos < 0) for (let p = -2; p >= n.pos; p -= 2) ledgers.push(p)
    if (n.pos > 8) for (let p = 10; p <= n.pos; p += 2) ledgers.push(p)
    for (const p of ledgers) {
      const ly = rowOfPos(p)
      for (const lx of [x - 1, x, x + 1]) if (isBackground(at(lx, ly))) put(lx, ly, { g: '─', c: color, dim: true })
    }
    if (n.sharp && x - 1 >= LABEL) put(x - 1, y, { g: '♯', c: color })
    put(x, y, { g: n.len >= 2 ? '○' : '●', c: color, bold, inv: x === LABEL + NOW })
  }
  // what the microphone hears, on the staff at the now-marker
  const heard = props.mic.on && props.mic.now ? props.mic.now : undefined
  if (heard && showStaff) {
    const hy = rowOfPos(staffPosition(heard.midi).pos)
    if (hy >= 0) put(LABEL + NOW, hy, { g: '◆', c: 'magenta', bold: true })
  }

  // header and status
  const tally = s.judge.tally
  const tempo = s.tempo === 1 ? '' : ` ×${s.tempo.toFixed(2)}`
  const header = `♪ ${song.title} · ${song.bpm} bpm${tempo} · ${tally.score} pts · combo ${tally.combo} · ${accuracyOf(tally)}%${props.best ? ` · best ${props.best}` : ''}`
  const status = statusOf(s, props, elapsed, mpb)
  const help = HELP

  const lines = grid.slice(0, statusRow).map((row, y) => (y === 0 ? <Text bold wrap="truncate-end">{header}</Text> : <Text>{runsOf(row).map(([t, c]) => <Text color={c.c} backgroundColor={c.b} bold={c.bold} dimColor={c.dim} inverse={c.inv}>{t}</Text>)}</Text>))
  lines.push(<Text color={status.color} wrap="truncate-end">{status.text}</Text>)
  if (s.help && helpRow < rows) lines.push(<Text dimColor wrap="truncate-end">{HELP}</Text>)
  if (!showStaff) lines.push(<Text dimColor wrap="truncate-end">(staff hidden: the pane is too short · drag it taller or dock it)</Text>)
  return <Box flexDirection="column">{lines}</Box>
}

type Run = [text: string, cell: Cell]
const sameStyle = (a: Cell, b: Cell) => a.c === b.c && a.b === b.b && !!a.bold === !!b.bold && !!a.dim === !!b.dim && !!a.inv === !!b.inv
function runsOf(row: Cell[]): Run[] {
  const out: Run[] = []
  for (const cell of row) {
    const last = out[out.length - 1]
    if (last && sameStyle(last[1], cell)) last[0] += cell.g
    else out.push([cell.g, cell])
  }
  return out
}
