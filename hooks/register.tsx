/* @jsx h */
// cc-hero's hooks module: /hero and its pane, the song loader, the microphone
// listener's lifecycle, and the best scores. The board (./board/hero.tsx) draws
// and judges; this module feeds it props and answers what it posts.

import type { EngineInterface, Register } from 'claude-code'
import type { BoardPost, BoardProps, MicProps } from './board/props.ts'
import { parseMicState, STALE_MS, type MicState } from './mic/state.ts'
import { chordLengthOf, isChordSong, lengthOf, parseSong, place, placeChords, STARTERS, type AnySong, type PlacedChord, type PlacedNote } from './music/song.ts'
import { DEFAULT_IMPORT, searchResultsOf, songOfPage, tabPageOf, type ImportOptions, type UgResult } from './ug/parse.ts'

const PANE = 'hero'
const PANE_ROWS = 26
const USAGE = [
  '/hero play [song | path.json | url | #n]   open the pane with a song (default: ode)',
  '/hero search <song or artist>   look a song up on Ultimate Guitar: pick in the pane with ↑↓ and enter, or /hero play #n',
  '/hero import beats|steps|bpm <n>  chord sheets: beats per chord (4); tabs: columns per beat (4), tempo (90)',
  '/hero list                      the built-in songs and the file format',
  '/hero tune                      the tuner (starts the microphone)',
  '/hero mic on|off|status         the microphone listener',
  '/hero mic file <audio> [lead]   feed a recording to the listener instead of the microphone; with a lead in seconds the song starts itself',
  '/hero latency [ms]              how late the listener hears you; subtracted from every note',
  '/hero stop                      close the pane and stop listening',
  '',
  'in the pane (click it first): enter starts · space strums · p pause · r restart · +/- tempo · m mic · t tuner · ? keys · esc back',
].join('\n')

type Loaded = { key: string; song: AnySong; notes: PlacedNote[]; chords: PlacedChord[] }

let loaded: Loaded | undefined
let lastSearch: UgResult[] = []
let importOptions: ImportOptions = { ...DEFAULT_IMPORT }
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
let view: 'play' | 'tune' | 'search' = 'play'
let lastQuery = ''
let busy: string | undefined
let best: Record<string, number> = {}
let paneOpen = false

// the listener: a child streamed through $.process.spawn, its last state kept here
let micWanted = false
let micState: MicState | undefined
let micMessage: string | undefined
let micStop: (() => void) | undefined
let micStartedAt = 0
// a recording played along to: the song starts on its own, `lead` seconds into the audio
let pendingLead: number | undefined
let startAt: number | undefined
// how late the listener hears a note, in milliseconds: subtracted from every onset
let latencyMs = 0

const micProps = (nowMs: number): MicProps => {
  const alive = micState !== undefined && micState.error === undefined && nowMs - micState.t < STALE_MS
  const message = micState?.error ?? micState?.message ?? micMessage
  return {
    on: micWanted,
    alive,
    ...(message ? { message } : {}),
    now: alive ? micState!.now : null,
    onsets: alive ? micState!.onsets.map(o => (latencyMs ? { ...o, t: o.t - latencyMs } : o)) : [],
  }
}

const boardProps = (nowMs: number): BoardProps => ({
  songKey: loaded?.key ?? '',
  song: loaded ? { kind: isChordSong(loaded.song) ? 'chords' : 'notes', title: loaded.song.artist ? `${loaded.song.title} · ${loaded.song.artist}` : loaded.song.title, bpm: loaded.song.bpm, beatsPerBar: loaded.song.beatsPerBar, tuning: isChordSong(loaded.song) ? 'standard' : loaded.song.tuning, notes: loaded.notes, chords: loaded.chords } : null,
  mic: micProps(nowMs),
  best: loaded ? best[loaded.key] ?? 0 : 0,
  view,
  ...(startAt !== undefined ? { startAt } : {}),
  ...(lastQuery ? { search: { query: lastQuery, results: lastSearch.map(r => ({ type: r.type, song: r.song, artist: r.artist, votes: r.votes, rating: r.rating })) } } : {}),
  ...(busy ? { busy } : {}),
})

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const stored = await $.store.get('best').catch(() => undefined)
    if (typeof stored === 'object' && stored !== null) best = { ...(stored as Record<string, number>) }
    const lat = await $.store.get('latency').catch(() => undefined)
    if (typeof lat === 'number') latencyMs = lat
    const imp = await $.store.get('import').catch(() => undefined)
    if (typeof imp === 'object' && imp !== null) importOptions = { ...importOptions, ...(imp as Partial<ImportOptions>) }
    await $.command.register({
      name: 'hero',
      description: 'Guitar practice: a song as tab and staff scrolling past a now-marker, scored from the microphone (cc-hero)',
      argumentHint: '[play <song|file> | list | tune | mic on|off | stop]',
      immediate: true,
    }).catch(err => $.ui.log(`cc-hero: /hero not registered: ${err}`))
    return r
  })

  on('session.end', async ($, e, next) => {
    stopMic()
    return next(e)
  })

  on('command.run', { command: 'hero' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ')
    const open = async () => {
      await $.ui.open({ id: PANE, title: 'cc-hero', focus: true, rows: PANE_ROWS })
      paneOpen = true
      $.ui.invalidate('ui.render')
      // the focus a command's own open asks for is refused while the command is still
      // running; ask again once the prompt is idle so enter starts the song at once
      $.clock.after(400, () => { void $.ui.open({ id: PANE, title: 'cc-hero', focus: true, rows: PANE_ROWS }).catch(() => undefined) })
    }
    switch (verb.toLowerCase()) {
      case '':
      case 'help':
        return { text: USAGE }
      case 'list': {
        const rows = Object.entries(STARTERS).map(([k, s]) => `${k.padEnd(12)}${s.title} · ${s.bpm} bpm · ${s.notes.length} notes`)
        return { text: [...rows, '', 'a song file is JSON: { "title", "bpm", "beatsPerBar", "tuning": "standard", "notes": [{ "b": beat, "s": string 1-6, "f": fret, "l": beats }] }', 'see songs/ in the plugin folder for examples'].join('\n') }
      }
      case 'play':
      case 'song': {
        const name = arg || 'ode'
        try {
          loaded = await load($, name)
        } catch (err) {
          return { text: `cc-hero: ${err instanceof Error ? err.message : String(err)}` }
        }
        view = 'play'
        await $.store.set('song', loaded.key).catch(() => undefined)
        await open()
        const chordy = isChordSong(loaded.song)
        const bars = Math.ceil((chordy ? chordLengthOf(loaded.chords) : lengthOf(loaded.notes)) / loaded.song.beatsPerBar)
        const what = chordy ? `${loaded.chords.length} chords` : `${loaded.notes.length} notes`
        return { text: `♪ ${loaded.song.title}${loaded.song.artist ? ` · ${loaded.song.artist}` : ''} · ${loaded.song.bpm} bpm · ${bars} bars · ${what} · click the pane, then enter starts (space strums without a mic; m turns the mic on)` }
      }
      case 'search': {
        if (!arg) return { text: '/hero search <song or artist>' }
        let results: UgResult[]
        try {
          results = searchResultsOf(await fetchText($, `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(arg)}`))
        } catch (err) {
          return { text: `cc-hero: search failed: ${err instanceof Error ? err.message : String(err)}` }
        }
        lastSearch = results.slice(0, 15)
        lastQuery = arg
        if (lastSearch.length === 0) return { text: `cc-hero: nothing on Ultimate Guitar for "${arg}" (chords and tabs only)` }
        view = 'search'
        await open()
        const rows = lastSearch.map((r, i) => `${String(i + 1).padStart(2)}. ${r.type.padEnd(6)} ${r.song} · ${r.artist} · ${r.votes} votes${r.rating ? ` · ${r.rating.toFixed(1)}★` : ''}`)
        return { text: [...rows, '', 'click the pane and pick with ↑↓ and enter, or /hero play #n (chords play as a chord sheet with lyrics; tabs as notes)'].join('\n') }
      }
      case 'import': {
        const [what = '', value = ''] = arg.split(/\s+/)
        const n = Number(value)
        const key = what === 'beats' ? 'beatsPerChord' : what === 'steps' ? 'stepsPerBeat' : what === 'bpm' ? 'bpm' : undefined
        if (!key) return { text: `import: beats per chord ${importOptions.beatsPerChord} · tab columns per beat ${importOptions.stepsPerBeat} · default bpm ${importOptions.bpm} · /hero import beats|steps|bpm <n>` }
        if (!Number.isFinite(n) || n <= 0) return { text: `cc-hero: /hero import ${what} <number>` }
        importOptions = { ...importOptions, [key]: n }
        await $.store.set('import', importOptions).catch(() => undefined)
        return { text: `import ${what} set to ${n} · reload the song with /hero play to apply` }
      }
      case 'tune':
        view = 'tune'
        await open()
        if (!micWanted) startMic($)
        return { text: 'tuner open · play one string · t goes back to the song' }
      case 'mic': {
        const what = arg.toLowerCase()
        if (what === 'on') { startMic($); $.ui.invalidate('ui.render'); return { text: 'microphone listener starting (ffmpeg; macOS asks once for microphone access)' } }
        if (what.startsWith('file ')) {
          // /hero mic file <path> [lead seconds]: with a lead, the song starts itself so that
          // beat 0 lands `lead` seconds into the recording (a one-bar count-in shows first)
          const parts = arg.slice(5).trim().split(/\s+/)
          const maybeLead = Number(parts[parts.length - 1])
          const hasLead = parts.length > 1 && Number.isFinite(maybeLead)
          const path = (hasLead ? parts.slice(0, -1) : parts).join(' ')
          stopMic()
          pendingLead = hasLead ? maybeLead : undefined
          startMic($, path)
          if (paneOpen) await open()
          else $.ui.invalidate('ui.render')
          return { text: `listener playing ${path} as if it were the microphone${hasLead ? ` · the song starts on its own, beat 0 at ${maybeLead}s` : ''}` }
        }
        if (what === 'off') { stopMic(); $.ui.invalidate('ui.render'); return { text: 'microphone listener stopped' } }
        const m = micProps(Date.now())
        const sync = startAt !== undefined ? ` · beat 0 at ${new Date(startAt).toISOString().slice(11, 23)}` : pendingLead !== undefined ? ` · waiting for audio to start (lead ${pendingLead}s)` : ''
        return { text: `mic ${m.on ? (m.alive ? 'on · listening' : 'on · not alive yet') : 'off'}${m.message ? ` · ${m.message}` : ''}${m.now ? ` · hearing midi ${m.now.midi} (${m.now.hz} Hz)` : ''}${micState?.started ? ` · audio started ${new Date(micState.started).toISOString().slice(11, 23)}` : ''}${sync} · latency ${latencyMs} ms` }
      }
      case 'latency': {
        const ms = Number(arg)
        if (!arg) return { text: `mic latency offset: ${latencyMs} ms · /hero latency <ms> sets it (how late the listener hears you; try 60-120)` }
        if (!Number.isFinite(ms) || ms < -500 || ms > 1000) return { text: 'cc-hero: latency is a number of milliseconds between -500 and 1000' }
        latencyMs = Math.round(ms)
        await $.store.set('latency', latencyMs).catch(() => undefined)
        return { text: `mic latency offset set to ${latencyMs} ms` }
      }
      case 'stop':
      case 'close':
        stopMic()
        if (paneOpen) await $.ui.close({ id: PANE }).catch(() => undefined)
        paneOpen = false
        return { text: 'cc-hero closed' }
      default:
        return { text: `cc-hero: no verb "${verb}"\n${USAGE}` }
    }
  })

  on('ui.close', ($, e, next) => {
    if (e.id === PANE) paneOpen = false
    return next(e)
  })

  // the board posts: a poll for fresh mic data, a view switch, a mic toggle, a finished run
  on('ui.message', async ($, e, next) => {
    const post = e.data as BoardPost | null
    if (!post || typeof post !== 'object' || !('kind' in post)) return next(e)
    switch (post.kind) {
      case 'poll': break
      case 'view': view = post.view; break
      case 'pick': {
        const r = lastSearch[post.index]
        if (!r) break
        busy = `fetching ${r.song} · ${r.artist}…`
        try {
          loaded = await load($, r.url)
          view = 'play'
          await $.store.set('song', loaded.key).catch(() => undefined)
          $.ui.toast(`cc-hero: ♪ ${loaded.song.title}${loaded.song.artist ? ` · ${loaded.song.artist}` : ''} · enter starts`)
        } catch (err) {
          $.ui.toast(`cc-hero: ${err instanceof Error ? err.message : String(err)}`)
        }
        busy = undefined
        break
      }
      case 'mic': post.on ? startMic($) : stopMic(); break
      case 'close':
        stopMic()
        await $.ui.close({ id: PANE }).catch(() => undefined)
        paneOpen = false
        break
      case 'result': {
        const prev = best[post.songKey] ?? 0
        if (post.score > prev) {
          best[post.songKey] = post.score
          await $.store.set('best', best).catch(err => $.ui.log(`cc-hero: store write failed: ${err}`))
          $.ui.toast(`cc-hero: new best on ${post.title}: ${post.score} pts (${post.accuracy}%, ${post.verdict})`)
        } else $.ui.toast(`cc-hero: ${post.title} · ${post.score} pts · ${post.accuracy}% · ${post.verdict}`)
        break
      }
    }
    return { props: boardProps(Date.now()) }
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    paneOpen = true
    if (!loaded) {
      // a reload (--plugin-dir on a save) drops this module's state: pick the song back up
      const key = await $.store.get('song').catch(() => undefined)
      if (typeof key === 'string') {
        const name = key.startsWith('file:') ? key.slice(5) : key.startsWith('ug:') ? `https://tabs.ultimate-guitar.com/tab/${key.slice(3)}` : key
        loaded = await load($, name).catch(() => undefined)
      }
    }
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text>cc-hero draws in the terminal for now</Text>
    }
    const { Client } = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    const rows = e.props.placement === 'dock' ? Math.max(12, (e.viewport?.rows ?? 30) - 3) : PANE_ROWS
    return <Client key="hero" module="./board/hero.tsx" width={columns} height={rows} props={boardProps(Date.now())} />
  })
}

const placedOf = (key: string, song: AnySong): Loaded =>
  isChordSong(song) ? { key, song, notes: [], chords: placeChords(song) } : { key, song, notes: place(song), chords: [] }

async function fetchText($: EngineInterface, url: string): Promise<string> {
  const r = await $.http.fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' } })
  if (!r.ok) throw new Error(`${url} answered ${r.status}`)
  return r.text
}

async function load($: EngineInterface, name: string): Promise<Loaded> {
  const starter = STARTERS[name.toLowerCase()]
  if (starter) return placedOf(name.toLowerCase(), starter)
  const pick = /^#?(\d{1,2})$/.exec(name)
  if (pick) {
    const r = lastSearch[Number(pick[1]) - 1]
    if (!r) throw new Error(lastSearch.length ? `pick 1 to ${lastSearch.length} from the last search` : 'no search to pick from · /hero search <song> first')
    return load($, r.url)
  }
  if (/^https?:\/\//.test(name)) {
    const id = /(\d+)\/?$/.exec(name)?.[1]
    const key = id ? `ug:${id}` : `ug:${name}`
    const cached = await $.store.get(key).catch(() => undefined)
    if (cached) {
      try { return placedOf(key, parseSong(cached)) } catch { /* stale cache: fetch again */ }
    }
    const page = tabPageOf(await fetchText($, name))
    if (!page) throw new Error('that page has no tab in it (is it an Ultimate Guitar tab or chords page?)')
    const song = songOfPage(page, importOptions)
    await $.store.set(key, song).catch(() => undefined)
    return placedOf(key, song)
  }
  if (!/\.json$/i.test(name)) throw new Error(`no song "${name}" · /hero list shows them, /hero search finds one, or give a path to a .json file`)
  const text = await $.fs.read(name)
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error(`${name} is not JSON`) }
  const song = parseSong(raw)
  return placedOf(`file:${name}`, song)
}

function startMic($: EngineInterface, input?: string) {
  if (micWanted) return
  micWanted = true
  micState = undefined
  micMessage = 'starting the listener…'
  micStartedAt = Date.now()
  const root = $.plugin.root
  const script = `${root}/listen/listen.ts`
  const extra = input ? ['--input', input] : []
  const runtimes = [['bun', script, '--out', '-', ...extra], ['node', script, '--out', '-', ...extra]]
  void (async () => {
    for (const argv of runtimes) {
      if (!micWanted) return
      const stream = $.process.spawn({ argv })
      let sawState = false
      let stopped = false
      micStop = () => { stopped = true; void stream.return(undefined as never).catch(() => undefined) }
      let buffer = ''
      try {
        for await (const chunk of stream) {
          if (chunk.stream === 'stderr') { micMessage = chunk.text.trim().slice(0, 200); continue }
          buffer += chunk.text
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          const last = lines[lines.length - 1]
          if (last === undefined) continue
          const parsed = parseMicState(last)
          if (!parsed) continue
          micState = parsed
          sawState = true
          // a recording with a lead: beat 0 is `lead` seconds after the audio began
          if (pendingLead !== undefined && parsed.started) {
            startAt = parsed.started + pendingLead * 1000
            pendingLead = undefined
          }
        }
        const result = await stream.result
        if (stopped || !micWanted) return
        micMessage = `listener exited (${result.code ?? result.signal})`
        if (sawState) break // it ran and ended on its own: report, do not retry with the other runtime
      } catch (err) {
        if (stopped || !micWanted) return
        micMessage = `${argv[0]} could not run the listener: ${err instanceof Error ? err.message : String(err)}`
      }
    }
    micWanted = false
    micStop = undefined
  })()
}

function stopMic() {
  micWanted = false
  pendingLead = undefined
  micStop?.()
  micStop = undefined
  micState = undefined
  micMessage = undefined
}
