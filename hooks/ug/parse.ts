// Ultimate Guitar pages: the JSON a page embeds in its `js-store` element, search
// results, and the two text formats a page's content comes in: a chord sheet
// ([ch]G[/ch] over lyrics, in [tab] blocks) and ASCII tablature. Pure; the fetch
// lives in the hooks module.

import type { AnySong, ChordSheetEvent, ChordSong, Song, SongNote } from '../music/song.ts'
import { parseChord } from '../music/chords.ts'

export type UgResult = {
  id: number
  type: string
  song: string
  artist: string
  votes: number
  rating: number
  url: string
}

export type UgPage = {
  tab: { song_name?: string; artist_name?: string; type?: string; id?: number; tab_url?: string; tonality_name?: string }
  tab_view: {
    meta?: { tuning?: { name?: string; value?: string } }
    applicature?: Record<string, { frets: number[] }[]>
    strummings?: { bpm?: number }[]
    wiki_tab?: { content?: string }
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Decodes the HTML entities an attribute value carries. */
export function unescapeHtml(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/** The `store.page.data` object of a page, or null when the page has none. */
export function pageDataOf(html: string): unknown {
  const m = /class="js-store"\s+data-content="([^"]*)"/.exec(html)
  if (!m?.[1]) return null
  try {
    const store: unknown = JSON.parse(unescapeHtml(m[1]))
    if (!isRecord(store) || !isRecord(store.store) || !isRecord(store.store.page)) return null
    return store.store.page.data ?? null
  } catch {
    return null
  }
}

export function searchResultsOf(html: string): UgResult[] {
  const data = pageDataOf(html)
  if (!isRecord(data) || !Array.isArray(data.results)) return []
  const out: UgResult[] = []
  for (const r of data.results) {
    if (!isRecord(r) || typeof r.id !== 'number' || typeof r.tab_url !== 'string') continue
    const type = typeof r.type === 'string' ? r.type : ''
    if (type !== 'Chords' && type !== 'Tabs') continue
    out.push({ id: r.id, type, song: String(r.song_name ?? ''), artist: String(r.artist_name ?? ''), votes: typeof r.votes === 'number' ? r.votes : 0, rating: typeof r.rating === 'number' ? r.rating : 0, url: r.tab_url })
  }
  return out.sort((a, b) => b.votes - a.votes)
}

export function tabPageOf(html: string): UgPage | null {
  const data = pageDataOf(html)
  if (!isRecord(data) || !isRecord(data.tab) || !isRecord(data.tab_view)) return null
  return data as UgPage
}

export type ImportOptions = {
  /** Beats a chord of a chord sheet lasts when nothing says otherwise. */
  beatsPerChord: number
  /** Tab columns per beat: 4 reads each dash as a sixteenth. */
  stepsPerBeat: number
  /** Tempo when the page names none. */
  bpm: number
}

export const DEFAULT_IMPORT: ImportOptions = { beatsPerChord: 4, stepsPerBeat: 4, bpm: 90 }

export function songOfPage(page: UgPage, opts: ImportOptions = DEFAULT_IMPORT): AnySong {
  const content = page.tab_view.wiki_tab?.content ?? ''
  const title = page.tab.song_name?.trim() || 'untitled'
  const artist = page.tab.artist_name?.trim()
  const bpm = page.tab_view.strummings?.find(s => typeof s.bpm === 'number' && s.bpm > 0)?.bpm ?? opts.bpm
  const source = page.tab.tab_url
  const type = page.tab.type ?? ''
  const base = { title, ...(artist ? { artist } : {}), bpm, beatsPerBar: 4, ...(source ? { source } : {}) }
  if (type === 'Chords' || (type !== 'Tabs' && /\[ch\]/.test(content) && !hasTabSystem(content))) {
    const chords = chordSheetOf(content, opts.beatsPerChord, page.tab_view.applicature ?? {})
    if (chords.length === 0) throw new Error('no chords found on that page')
    const song: ChordSong = { kind: 'chords', ...base, chords }
    return song
  }
  const notes = tabNotesOf(content, opts.stepsPerBeat)
  if (notes.length === 0) throw new Error('no tablature found on that page (a chord sheet would import as chords)')
  const song: Song = { kind: 'notes', ...base, tuning: 'standard', notes }
  return song
}

// ---- chord sheets ----

type ChordAt = { col: number; name: string }

/** Splits a line into its plain text and the chords with the columns they sit at. */
function chordsOfLine(line: string): { plain: string; chords: ChordAt[] } {
  const chords: ChordAt[] = []
  let plain = ''
  const re = /\[ch\]([^[]*?)\[\/ch\]|([^[]+|\[)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    if (m[1] !== undefined) {
      chords.push({ col: plain.length, name: m[1].trim() })
      plain += ' '.repeat(m[1].length)
    } else plain += m[2] ?? ''
  }
  return { plain, chords }
}

/**
 * A chord sheet as chord events: a chord line over a lyric line hands each chord
 * the words from its column to the next chord's; a chord line alone gets none;
 * a lyric line alone continues the last chord's words.
 */
export function chordSheetOf(content: string, beatsPerChord: number, applicature: Record<string, { frets: number[] }[]>): ChordSheetEvent[] {
  const events: ChordSheetEvent[] = []
  let beat = 0
  let section: string | undefined
  let pendingSection = false
  let line = 0
  const lines = content.replace(/\r/g, '').replace(/\[\/?tab\]/g, '').split('\n')
  const push = (name: string, lyric: string) => {
    const ev: ChordSheetEvent = { b: beat, l: beatsPerChord, name, line }
    if (lyric.trim()) ev.lyric = lyric.trim()
    if (pendingSection && section) { ev.section = section; pendingSection = false }
    const shape = applicature[name]?.[0]?.frets
    if (shape && shape.length === 6) ev.frets = [...shape].reverse()
    events.push(ev)
    beat += beatsPerChord
  }
  const appendLyric = (text: string) => {
    const last = events[events.length - 1]
    if (!last || !text.trim()) return
    last.lyric = last.lyric ? `${last.lyric} ${text.trim()}` : text.trim()
  }
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? ''
    const header = /^\s*\[([^\]]{1,40})\]\s*$/.exec(raw)
    if (header && !/^\/?ch$/.test(header[1] ?? '')) { section = header[1]; pendingSection = true; continue }
    const { plain, chords } = chordsOfLine(raw)
    if (chords.length === 0) {
      if (raw.trim() && !isTabLine(raw)) appendLyric(raw)
      continue
    }
    const inline = plain.trim().length > 0
    const nextRaw = lines[i + 1] ?? ''
    // a chord name over tab lines is a diagram, not a chord of the song
    if (!inline && isTabLine(nextRaw)) continue
    const nextIsLyric = !inline && nextRaw.trim().length > 0 && chordsOfLine(nextRaw).chords.length === 0 && !/^\s*\[/.test(nextRaw) && !isTabLine(nextRaw)
    const lyricLine = inline ? plain : nextIsLyric ? nextRaw : ''
    if (nextIsLyric) i++
    // a chord over the middle of a word takes the whole word; words before the first chord are
    // pickup words of the chord before (or of this line's first chord when there is none)
    const cutAt = (col: number) => {
      let p = Math.min(col, lyricLine.length)
      while (p > 0 && /\S/.test(lyricLine[p - 1] ?? ' ') && /\S/.test(lyricLine[p] ?? ' ')) p--
      return p
    }
    const cuts = chords.map(c => cutAt(c.col))
    let prefix = ''
    if (lyricLine && cuts[0]! > 0) {
      if (events.length) appendLyric(lyricLine.slice(0, cuts[0]))
      else prefix = lyricLine.slice(0, cuts[0])
    }
    line++
    chords.forEach((c, k) => {
      const words = lyricLine ? (k === 0 ? prefix : '') + lyricLine.slice(cuts[k], cuts[k + 1] ?? lyricLine.length) : ''
      if (parseChord(c.name)) push(c.name, words)
    })
  }
  return events
}

// ---- ASCII tablature ----

const LABELS: Record<string, number> = { e: 1, E: 6, B: 2, b: 2, G: 3, g: 3, D: 4, d: 4, A: 5, a: 5 }

const isTabLine = (line: string): boolean => /^\s*[A-Ga-g]?\s*[|:]?[-0-9|hpb/\\^~()xX.rs,\s]*-{3,}[-0-9|hpb/\\^~()xX.rs,\s]*$/.test(line) && /[-|]/.test(line)

const hasTabSystem = (content: string): boolean => {
  const lines = content.replace(/\[\/?tab\]/g, '').split('\n')
  let run = 0
  for (const l of lines) {
    run = isTabLine(l) ? run + 1 : 0
    if (run >= 6) return true
  }
  return false
}

/** The lane of a tab line: what follows its label and bar, and the string it names. */
function laneOf(line: string, fallbackString: number): { lane: string; string: number } {
  const m = /^\s*([A-Ga-g])?\s*[|:]?/.exec(line)
  const label = m?.[1]
  const string = label ? LABELS[label] ?? fallbackString : fallbackString
  return { lane: line.slice(m?.[0].length ?? 0), string }
}

/**
 * Notes from every six-line tab system in the text, one column of characters per
 * step. A fret of two digits (10-24) is one note. Each note lasts to the next on
 * its string, at most two beats.
 */
export function tabNotesOf(content: string, stepsPerBeat: number): SongNote[] {
  const lines = content.replace(/\r/g, '').replace(/\[\/?tab\]/g, '').split('\n')
  const notes: SongNote[] = []
  let offset = 0
  let i = 0
  while (i < lines.length) {
    if (!isTabLine(lines[i] ?? '')) { i++; continue }
    let j = i
    while (j < lines.length && isTabLine(lines[j] ?? '')) j++
    const system = lines.slice(i, j)
    i = j
    if (system.length < 6) continue
    // a system of more than six lines is two stacked: take them six at a time
    for (let s = 0; s + 6 <= system.length; s += 6) {
      const lanes = system.slice(s, s + 6).map((l, k) => laneOf(l, k + 1))
      // labels missing or odd: top to bottom is high e to low E
      const strings = new Set(lanes.map(l => l.string))
      if (strings.size !== 6) lanes.forEach((l, k) => { l.string = k + 1 })
      const width = Math.max(...lanes.map(l => l.lane.length))
      for (const { lane, string } of lanes) {
        for (let c = 0; c < lane.length; c++) {
          const ch = lane[c] ?? ''
          if (ch < '0' || ch > '9') continue
          let fret = Number(ch)
          const next = lane[c + 1] ?? ''
          if (next >= '0' && next <= '9' && ((ch === '1') || (ch === '2' && next <= '4'))) { fret = Number(ch + next); c++ }
          notes.push({ b: (offset + c - (fret >= 10 ? 1 : 0)) / stepsPerBeat, s: string, f: fret })
        }
      }
      offset += width
    }
  }
  notes.sort((x, y) => x.b - y.b || x.s - y.s)
  // lengths: to the next note on the same string, at most two beats
  const lastOn = new Map<number, SongNote>()
  for (const n of notes) {
    const prev = lastOn.get(n.s)
    if (prev) prev.l = Math.max(1 / stepsPerBeat, Math.min(2, n.b - prev.b))
    lastOn.set(n.s, n)
  }
  for (const n of lastOn.values()) if (n.l === undefined) n.l = 1
  return notes
}
