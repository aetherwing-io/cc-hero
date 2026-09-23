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
import { accuracyOf, judge, newJudge, verdictOf, WINDOW, type Grade, type JudgeState, type Judgment } from '../music/score.ts'
import { lengthOf } from '../music/song.ts'

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

function fresh(songKey: string): State {
  return { songKey, mode: 'idle', origin: 0, pausedAt: 0, tempo: 1, judge: newJudge(), strums: [], help: false, posted: false, ticks: 0 }
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
        const made = judge(s.judge, song.notes, onsets, t, mpb, s.origin)
        const lastMade = made[made.length - 1]
        if (lastMade) next.last = lastMade
        if (next.mode === 'playing' && t > (lengthOf(song.notes) + TAIL_BEATS) * mpb) {
          next = { ...next, mode: 'done', pausedAt: now() }
          if (!next.posted) {
            next.posted = true
            const tally = s.judge.tally
            enqueue({ kind: 'result', songKey: p.songKey, title: song.title, score: tally.score, accuracy: accuracyOf(tally), bestCombo: tally.bestCombo, verdict: verdictOf(tally) })
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
        // a strum: the right pitch for whichever unjudged note is nearest in time
        const t = now()
        const mpb = msPerBeat(song, s.tempo)
        const rel = t - s.origin
        let target: { midi: number; dt: number } | undefined
        for (const n of song.notes) {
          if (s.judge.judged.has(n.index)) continue
          const dt = rel - n.beat * mpb
          if (dt < -WINDOW.early || dt > WINDOW.late) continue
          if (!target || Math.abs(dt) < Math.abs(target.dt)) target = { midi: n.midi, dt }
        }
        const strums = [...s.strums.slice(-40), { t, midi: target?.midi ?? -1, hz: 0, cents: 0, rms: 1 }]
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

  if (props.view === 'tune') return tuner(Text, Box, props, columns)
  if (!props.song) return <Text dimColor>no song loaded · /hero play ode · /hero list</Text>

  return board(Text, Box, props, props.song, s, columns, rows)
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

  // rows: header, six tab strings, a ruler, the staff, a status line, an optional help line
  const fixed = 1 + 6 + 1 + 1 + (s.help ? 1 : 0)
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
  const staffTop = 8
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
  const micText = !props.mic.on ? 'mic off · space strums · m for mic'
    : !props.mic.alive ? `mic starting… ${props.mic.message ?? ''}`.trim()
    : heard ? `mic ● ${nameOf(heard.midi)} ${heard.cents >= 0 ? '+' : ''}${heard.cents}¢`
    : props.mic.message && /exited|not start|stopped/.test(props.mic.message) ? `mic ✗ ${props.mic.message}` : 'mic ○'
  let status: { text: string; color?: string } = { text: '' }
  switch (s.mode) {
    case 'idle': status = { text: `space or enter starts · ${micText} · t tuner · ? keys` }; break
    case 'countin': status = { text: `count-in ${Math.max(1, Math.ceil(-elapsed / mpb))} · ${micText}`, color: 'yellow' }; break
    case 'paused': status = { text: 'paused · p resumes · r restarts', color: 'yellow' }; break
    case 'done': status = { text: `done · ${verdictOf(tally)} · ${tally.score} pts · ${accuracyOf(tally)}% · best combo ${tally.bestCombo} · enter plays again`, color: 'cyan' }; break
    case 'playing': {
      const j = s.last
      const word = !j ? '…' : j.grade === 'wrong' ? `wrong note: heard ${j.heardMidi === undefined ? '?' : nameOf(j.heardMidi)}` : j.grade === 'miss' ? 'miss' : `${GRADE_WORD[j.grade]} ${j.dtMs === undefined ? '' : `(${j.dtMs > 0 ? '+' : ''}${j.dtMs}ms)`}`
      status = { text: `${word} · ${micText}`, color: j ? GRADE_COLOR[j.grade] : undefined }
    }
  }
  const help = 'enter/space start · space strum · p pause · r restart · +/- tempo · m mic · t tuner · ? hide · q close · esc back to prompt'

  const lines = grid.slice(0, statusRow).map((row, y) => (y === 0 ? <Text bold wrap="truncate-end">{header}</Text> : <Text>{runsOf(row).map(([t, c]) => <Text color={c.c} backgroundColor={c.b} bold={c.bold} dimColor={c.dim} inverse={c.inv}>{t}</Text>)}</Text>))
  lines.push(<Text color={status.color} wrap="truncate-end">{status.text}</Text>)
  if (s.help && helpRow < rows) lines.push(<Text dimColor wrap="truncate-end">{help}</Text>)
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
