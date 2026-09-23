/* @jsx h */
// cc-hero's hooks module: /hero and its pane, songs and exercises, the listener's
// lifecycle, run history, and the coach. The board (./board/hero.tsx) draws and
// judges; this module feeds it props and answers what it posts.

import type { EngineInterface, Register } from 'claude-code'
import type { BoardPost, BoardProps, MicProps, RunSummary } from './board/props.ts'
import { parseMicState, STALE_MS, type MicState } from './mic/state.ts'
import { parseChord } from './music/chords.ts'
import { cagedSong, fingerpickSong, parseKey, PICK_PATTERNS, progressionSong, PROGRESSIONS, randomOf, rootName, scaleSong, SCALES, type Key } from './music/exercise.ts'
import { chordLengthOf, isChordSong, lengthOf, parseSong, parseStrumText, place, placeChords, placeStrums, STARTERS, strumText, type AnySong, type PlacedChord, type PlacedNote, type StrumTarget } from './music/song.ts'
import { coachNotes, weakSpots, whenOf, withRun, type RunRecord } from './music/stats.ts'
import { searchResultsOf, songOfPage, tabPageOf, type ImportOptions, type UgResult } from './ug/parse.ts'
import { DEFAULTS, FIELDS, fieldOf, parseSetting, settingsOf, settingsText, type SettingKey, type Settings } from './settings.ts'

const PANE = 'hero'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const USAGE = [
  'songs',
  '  /hero play [song | path.json | url | #n]    open a song (built-in, file, Ultimate Guitar page, search pick)',
  '  /hero search <song or artist>              look it up on Ultimate Guitar; pick in the pane with ↑↓ and enter',
  '  /hero list                                 the built-in songs and the file format',
  'exercises',
  '  /hero progression <key> <chords or numerals | pop|blues|jazz|...>   e.g. progression G pop · progression Am i bVII bVI V',
  '  /hero pick <travis|arp|folk|waltz|pinch> <key> <progression>          fingerpicking over a progression',
  '  /hero scale <major|minor|pentatonic|blues|...> <key> [box 1-5] [8ths]  a scale box, up and down',
  '  /hero caged <chord>                        the five CAGED forms of a chord up the neck',
  '  /hero drill [key]                          something at random',
  '  /hero strum <pattern | off | page>         a strumming pattern for the chord sheet: "D DU UDU", "D - DU -"',
  'listening',
  '  /hero mic on|off|status · mic devices · mic device <n|name> · mic file <audio> [lead]',
  '  /hero tune · /hero latency [ms]',
  'progress',
  '  /hero stats                                recent runs and weak spots',
  '  /hero coach                                what Claude makes of your last run',
  '  /hero lesson <what you want to work on>    a plan of drills with goals; /hero next moves on',
  '  /hero config [key value | reset]        settings, kept across sessions: device, latency, beats, steps, bpm, strum, coach, rows',
  '  /hero stop',
  '',
  'in the pane (click it first): enter starts · space strums · p pause · r restart · +/- tempo · m mic · t tuner · ? keys · esc back',
].join('\n')

type Loaded = { key: string; cmd: string; song: AnySong; notes: PlacedNote[]; chords: PlacedChord[]; strums: StrumTarget[] }
type Lesson = { title: string; goal: string; steps: { command: string; goal: number; why: string }[]; step: number; done: boolean[] }

let loaded: Loaded | undefined
let view: BoardProps['view'] = 'play'
let best: Record<string, number> = {}
let paneOpen = false
let lastSearch: UgResult[] = []
let lastQuery = ''
let busy: string | undefined
let settings: Settings = { ...DEFAULTS }
const importOptions = (): ImportOptions => ({ beatsPerChord: settings.beats, stepsPerBeat: settings.steps, bpm: settings.bpm })
let runs: RunRecord[] = []
let lesson: Lesson | undefined
let lastCoach: string | undefined

// the listener: a child streamed through $.process.spawn, its last state kept here
let micWanted = false
let micState: MicState | undefined
let micMessage: string | undefined
let micStop: (() => void) | undefined
let pendingLead: number | undefined
let startAt: number | undefined

const micProps = (nowMs: number): MicProps => {
  const alive = micState !== undefined && micState.error === undefined && nowMs - micState.t < STALE_MS
  const message = micState?.error ?? micState?.message ?? micMessage
  return {
    on: micWanted,
    alive,
    ...(message ? { message } : {}),
    now: alive ? micState!.now : null,
    onsets: alive ? micState!.onsets.map(o => (settings.latency ? { ...o, t: o.t - settings.latency } : o)) : [],
  }
}

const summaryOf = (r: RunRecord, nowMs: number): RunSummary => ({ title: r.title, when: whenOf(r.at, nowMs), score: r.score, accuracy: r.accuracy, bestCombo: r.bestCombo, tempo: r.tempo })

const lessonLine = (): string | undefined => {
  if (!lesson) return undefined
  const step = lesson.steps[lesson.step]
  return lesson.step >= lesson.steps.length ? `lesson "${lesson.title}" done` : `lesson "${lesson.title}" · step ${lesson.step + 1}/${lesson.steps.length}: ${step?.command} · goal ${step?.goal}% · /hero next`
}

const boardProps = (nowMs: number): BoardProps => ({
  songKey: loaded?.key ?? '',
  song: loaded
    ? {
        kind: isChordSong(loaded.song) ? 'chords' : 'notes',
        title: loaded.song.artist ? `${loaded.song.title} · ${loaded.song.artist}` : loaded.song.title,
        bpm: loaded.song.bpm,
        beatsPerBar: loaded.song.beatsPerBar,
        tuning: isChordSong(loaded.song) ? 'standard' : loaded.song.tuning,
        notes: loaded.notes,
        chords: loaded.chords,
        strums: loaded.strums,
        ...(isChordSong(loaded.song) && loaded.song.strum ? { strumText: strumText(loaded.song.strum) } : {}),
      }
    : null,
  mic: micProps(nowMs),
  best: loaded ? best[loaded.key] ?? 0 : 0,
  view,
  ...(startAt !== undefined ? { startAt } : {}),
  ...(lastQuery ? { search: { query: lastQuery, results: lastSearch.map(r => ({ type: r.type, song: r.song, artist: r.artist, votes: r.votes, rating: r.rating })) } } : {}),
  ...(busy ? { busy } : {}),
  ...(view === 'stats' ? { stats: { runs: runs.slice(0, 12).map(r => summaryOf(r, nowMs)), weak: weakSpots(runs, loaded?.key), ...(lessonLine() ? { lesson: lessonLine()! } : {}) } } : {}),
})

export const register: Register = (on, options) => {
  // settings: plugin.json's userConfig fields, as Claude Code keeps them between sessions
  settings = settingsOf(options)

  // the person changing a row in /config
  on('config.set', async ($, e, next) => {
    const r = await next(e)
    const field = FIELDS.find(f => e.key === `cc-hero.${f.field}`)
    if (field && !r.deny) {
      const parsed = parseSetting(field.key, r.value)
      if ('value' in parsed) applySetting($, field.key, parsed.value)
    }
    return r
  })

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const get = async (key: string) => $.store.get(key).catch(() => undefined)
    const stored = await get('best')
    if (typeof stored === 'object' && stored !== null) best = { ...(stored as Record<string, number>) }
    // settings saved by an earlier build in the store, where the manifest's rows are still at their defaults
    const legacy = await get('settings')
    if (typeof legacy === 'object' && legacy !== null) settings = settingsOf(legacy as Record<string, unknown>, settings)
    const rs = await get('runs')
    if (Array.isArray(rs)) runs = rs.filter((x): x is RunRecord => typeof x === 'object' && x !== null && typeof (x as RunRecord).accuracy === 'number')
    const ls = await get('lesson')
    if (typeof ls === 'object' && ls !== null && Array.isArray((ls as Lesson).steps)) lesson = ls as Lesson
    await $.command.register({
      name: 'hero',
      description: 'Guitar practice: songs, chord sheets and exercises scrolling past a now-marker, scored from the microphone (cc-hero)',
      argumentHint: '[play | search | progression | pick | scale | caged | drill | strum | tune | mic | stats | coach | lesson | stop]',
      immediate: true,
    }).catch(err => $.ui.log(`/hero not registered: ${err}`))
    return r
  })

  on('session.end', async ($, e, next) => {
    stopMic()
    return next(e)
  })

  on('command.run', { command: 'hero' }, async ($, e) => runHero($, e.args))

  on('ui.close', ($, e, next) => {
    if (e.id === PANE) paneOpen = false
    return next(e)
  })

  // the board posts: a poll for fresh mic data, a view switch, a mic toggle, a pick, a finished run
  on('ui.message', async ($, e, next) => {
    const post = e.data as BoardPost | null
    if (!post || typeof post !== 'object' || !('kind' in post)) return next(e)
    switch (post.kind) {
      case 'poll': break
      case 'view': view = post.view; break
      case 'mic': post.on ? startMic($) : stopMic(); break
      case 'close':
        stopMic()
        await $.ui.close({ id: PANE }).catch(() => undefined)
        paneOpen = false
        break
      case 'pick': {
        const r = lastSearch[post.index]
        if (!r) break
        busy = `fetching ${r.song} · ${r.artist}…`
        try {
          await setLoaded($, await load($, r.url), `play ${r.url}`)
          view = 'play'
          $.ui.toast(`♪ ${loaded!.song.title}${loaded!.song.artist ? ` · ${loaded!.song.artist}` : ''} · enter starts`)
        } catch (err) {
          $.ui.toast(`${err instanceof Error ? err.message : String(err)}`)
        }
        busy = undefined
        break
      }
      case 'result': {
        const nowMs = Date.now()
        const prev = best[post.songKey] ?? 0
        if (post.score > prev) {
          best[post.songKey] = post.score
          await $.store.set('best', best).catch(err => $.ui.log(`store write failed: ${err}`))
        }
        const record: RunRecord = { key: post.songKey, title: post.title, at: nowMs, bpm: loaded?.song.bpm ?? 0, tempo: post.tempo, score: post.score, accuracy: post.accuracy, bestCombo: post.bestCombo, grades: post.grades, hits: post.hits, misses: post.misses, timing: post.timing }
        runs = withRun(runs, record)
        await $.store.set('runs', runs).catch(() => undefined)
        let note = post.score > prev ? `new best ${post.score} pts` : `${post.score} pts`
        // a lesson step met or not
        const step = lesson?.steps[lesson.step]
        if (lesson && step && loaded && loaded.cmd === step.command) {
          if (post.accuracy >= step.goal) {
            lesson.done[lesson.step] = true
            lesson.step++
            note += lesson.step < lesson.steps.length ? ` · goal met! /hero next for step ${lesson.step + 1}` : ' · lesson complete!'
          } else note += ` · goal ${step.goal}%: again, or /hero coach`
          await $.store.set('lesson', lesson).catch(() => undefined)
        }
        $.ui.toast(`${post.title} · ${post.accuracy}% · ${post.verdict} · ${note}`)
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
      const cmd = await $.store.get('songCmd').catch(() => undefined)
      if (typeof cmd === 'string') await runHero($, cmd, true).catch(() => undefined)
    }
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text>cc-hero draws in the terminal for now</Text>
    }
    const { Client } = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    const rows = e.props.placement === 'dock' ? Math.max(12, (e.viewport?.rows ?? 30) - 3) : settings.rows
    return <Client key="hero" module="./board/hero.tsx" width={columns} height={rows} props={boardProps(Date.now())} />
  })
}

// ---- commands ----

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: 'cc-hero', focus: true, rows: settings.rows })
  paneOpen = true
  $.ui.invalidate('ui.render')
  // the focus a command's own open asks for is refused while the command is still
  // running; ask again once the prompt is idle so enter starts the song at once
  $.clock.after(400, () => { void $.ui.open({ id: PANE, title: 'cc-hero', focus: true, rows: settings.rows }).catch(() => undefined) })
}

/** Takes a setting's new value: into this module now, into Claude Code's plugin config for next time. */
function applySetting($: EngineInterface, key: SettingKey, value: Settings[SettingKey]) {
  const before = settings[key]
  ;(settings as Record<string, unknown>)[key] = value
  if (key === 'device' && micWanted && before !== value) { stopMic(); startMic($) }
}

async function saveSetting($: EngineInterface, key: SettingKey, value: Settings[SettingKey]): Promise<string> {
  applySetting($, key, value)
  // the store copy serves a build whose manifest lacks the row, and a config write that is refused
  await $.store.set('settings', { ...(await $.store.get('settings').catch(() => ({})) as object), [fieldOf(key).field]: value }).catch(() => undefined)
  try {
    const r = await $.config.set({ key: `cc-hero.${fieldOf(key).field}`, value })
    return r.deny ? ` (kept for this session; the config row refused: ${r.deny})` : ''
  } catch {
    return ' (kept in the plugin store; no config row for it in this build)'
  }
}

const describe = (l: Loaded): string => {
  const chordy = isChordSong(l.song)
  const bars = Math.ceil((chordy ? chordLengthOf(l.chords) : lengthOf(l.notes)) / l.song.beatsPerBar)
  const what = chordy ? `${l.chords.length} chords${l.strums.length ? `, ${l.strums.length} strums (${strumText((l.song as { strum?: never } & AnySong & { strum?: Parameters<typeof strumText>[0] }).strum!)})` : ''}` : `${l.notes.length} notes`
  return `♪ ${l.song.title}${l.song.artist ? ` · ${l.song.artist}` : ''} · ${l.song.bpm} bpm · ${bars} bars · ${what}`
}

async function setLoaded($: EngineInterface, l: Omit<Loaded, 'cmd'>, cmd: string) {
  loaded = { ...l, cmd }
  await $.store.set('songCmd', cmd).catch(() => undefined)
}

/** Runs one /hero command line; `quiet` restores a song without opening the pane. */
async function runHero($: EngineInterface, line: string, quiet = false): Promise<{ text: string }> {
  const [verb = '', ...rest] = line.trim().split(/\s+/)
  const arg = rest.join(' ')
  const cmd = line.trim()
  const show = async (l: Omit<Loaded, 'cmd'>, hint = 'click the pane, then enter starts (space strums without a mic; m turns the mic on)') => {
    await setLoaded($, l, cmd)
    view = 'play'
    if (!quiet) await openPane($)
    return { text: `${describe(loaded!)} · ${hint}` }
  }
  switch (verb.toLowerCase()) {
    case '':
    case 'help':
      return { text: USAGE }
    case 'list': {
      const rows = Object.entries(STARTERS).map(([k, s]) => `${k.padEnd(12)}${s.title} · ${s.bpm} bpm · ${s.notes.length} notes`)
      return { text: [...rows, '', 'a song file is JSON: { "title", "bpm", "beatsPerBar", "tuning": "standard", "notes": [{ "b": beat, "s": string 1-6, "f": fret, "l": beats }] }, or { "kind": "chords", "chords": [...] }', 'see songs/ in the plugin folder for examples; /hero help lists the exercises'].join('\n') }
    }
    case 'play':
    case 'song': {
      const name = arg || 'ode'
      try {
        const l = await load($, name)
        return show(l, 'click the pane, then enter starts (space strums without a mic; m turns the mic on)')
      } catch (err) {
        return { text: `${err instanceof Error ? err.message : String(err)}` }
      }
    }
    case 'search': {
      if (!arg) return { text: '/hero search <song or artist>' }
      let results: UgResult[]
      try {
        results = searchResultsOf(await fetchText($, `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(arg)}`))
      } catch (err) {
        return { text: `search failed: ${err instanceof Error ? err.message : String(err)}` }
      }
      lastSearch = results.slice(0, 15)
      lastQuery = arg
      if (lastSearch.length === 0) return { text: `nothing on Ultimate Guitar for "${arg}" (chords and tabs only)` }
      view = 'search'
      await openPane($)
      const rows = lastSearch.map((r, i) => `${String(i + 1).padStart(2)}. ${r.type.padEnd(6)} ${r.song} · ${r.artist} · ${r.votes} votes${r.rating ? ` · ${r.rating.toFixed(1)}★` : ''}`)
      return { text: [...rows, '', 'click the pane and pick with ↑↓ and enter, or /hero play #n (chords play as a chord sheet with lyrics; tabs as notes)'].join('\n') }
    }
    case 'import': {
      const [what = '', value = ''] = arg.split(/\s+/)
      if (what !== 'beats' && what !== 'steps' && what !== 'bpm') return { text: `import: beats per chord ${settings.beats} · tab columns per beat ${settings.steps} · default bpm ${settings.bpm} · /hero import beats|steps|bpm <n>` }
      const r = await runHero($, `config ${what} ${value}`, quiet)
      return { text: `${r.text} · reload the song with /hero play to apply` }
    }
    case 'config':
    case 'settings': {
      const [what = '', ...vals] = arg.split(/\s+/)
      if (!what) return { text: `settings (kept across sessions; also under cc-hero in /config)\n${settingsText(settings)}\n/hero config <key> <value> sets one · /hero config reset` }
      if (what === 'reset') {
        const notes: string[] = []
        for (const f of FIELDS) notes.push(await saveSetting($, f.key, DEFAULTS[f.key]))
        return { text: `settings back to their defaults${notes.find(n => n) ?? ''}` }
      }
      const key = FIELDS.find(f => f.key === what.toLowerCase())?.key
      if (!key) return { text: `no setting "${what}" · ${FIELDS.map(f => f.key).join(', ')}` }
      const value = vals.join(' ')
      if (!value) return { text: `${key}: ${settings[key]} · ${fieldOf(key).help}` }
      if (key === 'strum' && !parseStrumText(value.replace(/^"|"$/g, ''))) return { text: 'a pattern is beats separated by spaces, each beat D, U, X (muted), x or - (rest)' }
      const parsed = parseSetting(key, value.replace(/^"|"$/g, ''))
      if ('error' in parsed) return { text: `${parsed.error}` }
      const note = await saveSetting($, key, parsed.value)
      return { text: `${key} set to ${parsed.value}${note}` }
    }
    case 'progression':
    case 'prog':
    case 'pick':
    case 'scale':
    case 'caged':
    case 'drill': {
      try {
        const built = buildExercise(verb.toLowerCase(), rest, Math.random, settings.strum)
        return show(placedOf(`ex:${built.cmd}`, built.song), built.hint)
      } catch (err) {
        return { text: `${err instanceof Error ? err.message : String(err)}` }
      }
    }
    case 'strum': {
      if (!loaded || !isChordSong(loaded.song)) return { text: 'load a chord sheet first (/hero play <chords page>, /hero progression …)' }
      const song = loaded.song
      if (!arg) return { text: song.strum ? `strumming: ${strumText(song.strum)} · /hero strum <pattern> changes it, /hero strum off removes it` : 'no strumming pattern: one strum a chord · /hero strum "D DU UDU" sets one' }
      if (arg === 'off') delete song.strum
      else {
        const p = parseStrumText(arg.replace(/^"|"$/g, ''))
        if (!p) return { text: 'a pattern is beats separated by spaces, each beat D, U, X (muted), x or - (rest): "D DU UDU", "D - DU -"' }
        song.strum = p
      }
      loaded.strums = placeStrums(song, loaded.chords)
      loaded.cmd = cmd === loaded.cmd ? cmd : loaded.cmd
      $.ui.invalidate('ui.render')
      return { text: song.strum ? `strumming ${strumText(song.strum)} · ${loaded.strums.length} strums to hit` : 'strumming off: one strum a chord' }
    }
    case 'tune':
      view = 'tune'
      await openPane($)
      if (!micWanted) startMic($)
      return { text: 'tuner open · play one string · t goes back to the song' }
    case 'mic':
      return micCommand($, arg)
    case 'latency':
      if (!arg) return { text: `mic latency offset: ${settings.latency} ms · /hero latency <ms> sets it (how late the listener hears you; try 60-120)` }
      return runHero($, `config latency ${arg}`, quiet)
    case 'stats': {
      view = 'stats'
      await openPane($)
      const weak = weakSpots(runs, loaded?.key, 5)
      const recent = runs.slice(0, 5).map(r => `${whenOf(r.at, Date.now()).padEnd(11)} ${String(r.accuracy).padStart(3)}% · ${r.score} pts · ${r.title}`)
      return { text: [`${runs.length} run(s) recorded`, ...recent, ...(weak.length ? ['weak spots: ' + weak.map(w => `${w.label} (${w.misses} missed)`).join(', ')] : []), 't in the pane returns to the song'].join('\n') }
    }
    case 'coach':
      return coach($)
    case 'lesson':
      return lessonCommand($, arg)
    case 'next': {
      if (!lesson) return { text: 'no lesson in progress · /hero lesson <what you want to work on>' }
      const step = lesson.steps[lesson.step]
      if (!step) return { text: `lesson "${lesson.title}" is complete · /hero lesson <goal> starts another` }
      const r = await runHero($, step.command)
      return { text: `step ${lesson.step + 1}/${lesson.steps.length} · ${step.why} · goal ${step.goal}%\n${r.text}` }
    }
    case 'stop':
    case 'close':
      stopMic()
      if (paneOpen) await $.ui.close({ id: PANE }).catch(() => undefined)
      paneOpen = false
      return { text: 'cc-hero closed' }
    default:
      return { text: `no verb "${verb}"\n${USAGE}` }
  }
}

// ---- exercises ----

const keyOrDefault = (token: string | undefined, fallback = 'G'): { key: Key; used: boolean } => {
  const k = token ? parseKey(token) : null
  return k && token && !PROGRESSIONS[token.toLowerCase()] && !/^(i|ii|iii|iv|v|vi|vii)/i.test(token) ? { key: k, used: true } : { key: parseKey(fallback)!, used: false }
}

const progressionTokens = (tokens: string[]): string[] => {
  const named = tokens.length === 1 ? PROGRESSIONS[tokens[0]!.toLowerCase()] : undefined
  if (named) return named
  if (tokens.length === 0) return PROGRESSIONS.pop!
  return tokens
}

/** Builds an exercise from a verb and its words; throws with a reason a person can act on. */
export function buildExercise(verb: string, words: string[], rand = Math.random, defaultStrum = DEFAULTS.strum): { cmd: string; song: AnySong; hint: string } {
  const opts: Record<string, number> = {}
  const plain: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    if (w.startsWith('--') && words[i + 1] !== undefined && Number.isFinite(Number(words[i + 1]))) { opts[w.slice(2)] = Number(words[i + 1]); i++ }
    else plain.push(w)
  }
  const bpm = opts.bpm
  const repeats = opts.repeats ?? opts.x
  if (verb === 'drill') {
    const key = plain[0] && parseKey(plain[0]) ? plain[0]! : randomOf(['G', 'C', 'D', 'A', 'E', 'Am', 'Em'], rand)
    const kind = randomOf(['progression', 'pick', 'scale', 'caged'] as const, rand)
    if (kind === 'progression') return buildExercise('progression', [key, randomOf(Object.keys(PROGRESSIONS), rand)], rand, defaultStrum)
    if (kind === 'pick') return buildExercise('pick', [randomOf(Object.keys(PICK_PATTERNS), rand), key, randomOf(Object.keys(PROGRESSIONS), rand)], rand, defaultStrum)
    if (kind === 'scale') return buildExercise('scale', [randomOf(['pentatonic', 'major', 'minor', 'blues'], rand), key.replace(/m$/, ''), String(1 + Math.floor(rand() * 5))], rand, defaultStrum)
    return buildExercise('caged', [key], rand, defaultStrum)
  }
  if (verb === 'progression' || verb === 'prog') {
    const { key, used } = keyOrDefault(plain[0])
    const tokens = progressionTokens(used ? plain.slice(1) : plain)
    const song = progressionSong(key, tokens, { beatsPerChord: opts.beats ?? 4, repeats: repeats ?? 2, bpm: bpm ?? 80 })
    if (opts.strum === undefined) song.strum = parseStrumText(defaultStrum) ?? parseStrumText(DEFAULTS.strum)!
    return { cmd: `progression ${key.name} ${tokens.join(' ')}${optText(opts)}`, song, hint: `strum ${strumText(song.strum!)} · /hero strum changes the pattern` }
  }
  if (verb === 'pick') {
    const pattern = PICK_PATTERNS[(plain[0] ?? '').toLowerCase()]
    if (!pattern) throw new Error(`patterns: ${Object.entries(PICK_PATTERNS).map(([k, p]) => `${k} (${p.blurb})`).join(' · ')}`)
    const { key, used } = keyOrDefault(plain[1])
    const tokens = progressionTokens(used ? plain.slice(2) : plain.slice(1))
    const song = fingerpickSong(key, tokens, pattern, { repeats: repeats ?? 2, bpm: bpm ?? 70 })
    return { cmd: `pick ${plain[0]!.toLowerCase()} ${key.name} ${tokens.join(' ')}${optText(opts)}`, song, hint: 'p i m a above the tab name the picking finger; +/- change the tempo' }
  }
  if (verb === 'scale') {
    const scale = SCALES[(plain[0] ?? '').toLowerCase()]
    if (!scale) throw new Error(`scales: ${Object.keys(SCALES).join(', ')}`)
    const key = parseKey(plain[1] ?? 'A')
    if (!key) throw new Error(`/hero scale ${plain[0]} <key> [box]`)
    const box = Math.max(1, Math.min(5, Number(plain[2]) || 1))
    const eighths = plain.includes('8ths') || plain.includes('eighths')
    const song = scaleSong(key.root, scale, box, { bpm: bpm ?? 80, eighths })
    return { cmd: `scale ${plain[0]!.toLowerCase()} ${rootName(key.root)} ${box}${eighths ? ' 8ths' : ''}${optText(opts)}`, song, hint: 'up the box and back down · +/- change the tempo · the staff shows the notes' }
  }
  if (verb === 'caged') {
    const chord = plain[0] ? parseChord(plain[0]) : null
    if (!chord) throw new Error('/hero caged <chord>, a major or minor chord: caged C, caged Am')
    const song = cagedSong(chord, { bpm: bpm ?? 70 })
    return { cmd: `caged ${chord.name}${optText(opts)}`, song, hint: 'each form in turn up the neck; the diagram shows where' }
  }
  throw new Error(`no exercise "${verb}"`)
}

const optText = (opts: Record<string, number>): string => Object.entries(opts).map(([k, v]) => ` --${k} ${v}`).join('')

// ---- songs ----

const placedOf = (key: string, song: AnySong): Omit<Loaded, 'cmd'> => {
  if (isChordSong(song)) {
    const chords = placeChords(song)
    return { key, song, notes: [], chords, strums: placeStrums(song, chords) }
  }
  return { key, song, notes: place(song), chords: [], strums: [] }
}

/** A path as typed, with a leading ~ made absolute (a spawned child gets no shell to expand it). */
async function expandHome($: EngineInterface, path: string): Promise<string> {
  if (!path.startsWith('~/')) return path
  const home = await $.env.get('HOME').catch(() => undefined)
  return home ? `${home}${path.slice(1)}` : path
}

async function fetchText($: EngineInterface, url: string): Promise<string> {
  const r = await $.http.fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' } })
  if (!r.ok) throw new Error(`${url} answered ${r.status}`)
  return r.text
}

async function load($: EngineInterface, name: string): Promise<Omit<Loaded, 'cmd'>> {
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
    const song = songOfPage(page, importOptions())
    await $.store.set(key, song).catch(() => undefined)
    return placedOf(key, song)
  }
  if (!/\.json$/i.test(name)) throw new Error(`no song "${name}" · /hero list shows them, /hero search finds one, or give a path to a .json file`)
  const text = await $.fs.read(await expandHome($, name))
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error(`${name} is not JSON`) }
  const song = parseSong(raw)
  return placedOf(`file:${name}`, song)
}

// ---- the listener ----

async function micCommand($: EngineInterface, arg: string): Promise<{ text: string }> {
  const what = arg.toLowerCase()
  if (what === 'on') { startMic($); $.ui.invalidate('ui.render'); return { text: `microphone listener starting on device ${settings.device} (ffmpeg; macOS asks once for microphone access)` } }
  if (what === 'off') { stopMic(); $.ui.invalidate('ui.render'); return { text: 'microphone listener stopped' } }
  if (what === 'devices') {
    const devices = await listDevices($)
    if (devices.length === 0) return { text: 'no audio input devices found (is ffmpeg installed?)' }
    return { text: [...devices.map(d => `${d.index === settings.device ? '▶' : ' '} ${d.index}: ${d.name}`), '', '/hero mic device <number or name> picks one (a USB guitar interface shows up here once plugged in)'].join('\n') }
  }
  if (what.startsWith('device')) {
    const want = arg.slice(6).trim()
    if (!want) return { text: `mic device: ${settings.device} · /hero mic devices lists them` }
    const devices = await listDevices($)
    const found = devices.find(d => d.index === want) ?? devices.find(d => d.name.toLowerCase().includes(want.toLowerCase()))
    const wasOn = micWanted
    const note = await saveSetting($, 'device', found?.index ?? want)
    return { text: `mic device set to ${settings.device}${found ? ` (${found.name})` : ' (not in the device list; trying anyway)'}${wasOn ? ' · listener restarted' : ''}${note}` }
  }
  if (what.startsWith('file ')) {
    // /hero mic file <path> [lead seconds]: with a lead, the song starts itself so that
    // beat 0 lands `lead` seconds into the recording (a one-bar count-in shows first)
    const parts = arg.slice(5).trim().split(/\s+/)
    const maybeLead = Number(parts[parts.length - 1])
    const hasLead = parts.length > 1 && Number.isFinite(maybeLead)
    const path = await expandHome($, (hasLead ? parts.slice(0, -1) : parts).join(' '))
    stopMic()
    pendingLead = hasLead ? maybeLead : undefined
    startMic($, path)
    if (paneOpen) await openPane($)
    else $.ui.invalidate('ui.render')
    return { text: `listener playing ${path} as if it were the microphone${hasLead ? ` · the song starts on its own, beat 0 at ${maybeLead}s` : ''}` }
  }
  const m = micProps(Date.now())
  const sync = startAt !== undefined ? ` · beat 0 at ${new Date(startAt).toISOString().slice(11, 23)}` : pendingLead !== undefined ? ` · waiting for audio to start (lead ${pendingLead}s)` : ''
  return { text: `mic ${m.on ? (m.alive ? 'on · listening' : 'on · not alive yet') : 'off'} · device ${settings.device}${m.message ? ` · ${m.message}` : ''}${m.now ? ` · hearing ${m.now.midi >= 0 ? `midi ${m.now.midi} (${m.now.hz} Hz)` : 'a strum'}${m.now.chord ? `, chord ${m.now.chord}` : ''}` : ''}${sync} · latency ${settings.latency} ms` }
}

/** Audio input devices as ffmpeg lists them on this platform. */
async function listDevices($: EngineInterface): Promise<{ index: string; name: string }[]> {
  const platform = (await $.env.get('OS')) === 'Windows_NT' ? 'win' : (await $.env.get('HOME'))?.startsWith('/Users/') ? 'mac' : 'linux'
  try {
    if (platform === 'mac') {
      const r = await $.process.run(['ffmpeg', '-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { timeoutMs: 15000 })
      const text = `${r.stderr}\n${r.stdout}`
      const audio = text.split(/AVFoundation audio devices:/)[1] ?? ''
      return [...audio.matchAll(/\[(\d+)\]\s+(.+)/g)].map(m => ({ index: m[1]!, name: m[2]!.trim() }))
    }
    if (platform === 'linux') {
      const r = await $.process.run(['pactl', 'list', 'short', 'sources'], { timeoutMs: 15000 })
      return r.stdout.split('\n').filter(Boolean).map(l => { const [i = '', name = ''] = l.split('\t'); return { index: name, name: `${i} ${name}` } })
    }
    const r = await $.process.run(['ffmpeg', '-hide_banner', '-f', 'dshow', '-list_devices', 'true', '-i', 'dummy'], { timeoutMs: 15000 })
    return [...`${r.stderr}`.matchAll(/"([^"]+)" \(audio\)/g)].map(m => ({ index: m[1]!, name: m[1]! }))
  } catch {
    return []
  }
}

function startMic($: EngineInterface, input?: string) {
  if (micWanted) return
  micWanted = true
  micState = undefined
  micMessage = 'starting the listener…'
  const root = $.plugin.root
  const script = `${root}/listen/listen.ts`
  const extra = input ? ['--input', input] : ['--device', settings.device]
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

// ---- the coach ----

const COACH_SYSTEM = 'You are a patient, specific guitar teacher. You get a data summary of a player\'s practice runs in a terminal practice tool: accuracy, timing offsets (late is positive), and which chords or notes they missed. Answer in plain prose, at most 120 words, no headings: name the one or two things the data actually shows, say what to practise and how (tempo, isolating a change, a fingering), and end with one concrete next drill from this list, written exactly as a command: /hero progression <key> <chords>, /hero pick <travis|arp|folk|waltz|pinch> <key> <chords>, /hero scale <pentatonic|major|minor|blues> <key> <box>, /hero caged <chord>. Do not invent data.'

async function coach($: EngineInterface): Promise<{ text: string }> {
  if (runs.length === 0) return { text: 'no runs yet · play something through, then /hero coach' }
  const notes = coachNotes(runs, loaded?.key, Date.now())
  const song = loaded ? `Current song: "${loaded.song.title}" (${isChordSong(loaded.song) ? `chords: ${[...new Set(loaded.chords.map(c => c.name))].join(' ')}` : `${loaded.notes.length} notes`}) at ${loaded.song.bpm} bpm.` : ''
  const r = await $.model.complete({ model: settings.coach, system: COACH_SYSTEM, prompt: `${song}\n${notes}`, maxTokens: 400, effort: 'low', timeoutMs: 60000 })
  if (!r.isAnswered) return { text: `the coach did not answer (${r.reason})` }
  lastCoach = r.text.trim()
  return { text: `coach:\n${lastCoach}` }
}

const LESSON_SYSTEM = 'You plan guitar practice for a terminal tool that scores what a player plays. Reply with JSON only, no prose: {"title": "...", "steps": [{"command": "...", "goal": 85, "why": "..."}]}. 3 to 6 steps, easy to hard, each "command" exactly one of these forms with real values: "progression <key> <chords or roman numerals>" (e.g. "progression G I V vi IV", "progression Am Am F C G"), "pick <travis|arp|folk|waltz|pinch> <key> <chords>", "scale <pentatonic|major|minor|blues|majorpentatonic|dorian|mixolydian> <key> <box 1-5>", "caged <chord>", "play <ode|twinkle|cmajor|chromatic|pentatonic>". Options may follow: "--bpm 60", "--x 3" (repeats), "--beats 2". "goal" is the accuracy percentage to reach (60-95). "why" is one short sentence.'

async function lessonCommand($: EngineInterface, arg: string): Promise<{ text: string }> {
  if (!arg) {
    if (!lesson) return { text: 'no lesson · /hero lesson <what you want to work on> (e.g. "chord changes in G", "fingerpicking", "the pentatonic scale")' }
    const rows = lesson.steps.map((s, i) => `${lesson!.done[i] ? '✓' : i === lesson!.step ? '▶' : ' '} ${i + 1}. ${s.command} · goal ${s.goal}% · ${s.why}`)
    return { text: [`lesson: ${lesson.title}`, ...rows, '', lesson.step < lesson.steps.length ? '/hero next runs the current step · /hero coach after a run · /hero lesson stop ends it' : 'complete · /hero lesson <goal> starts another'].join('\n') }
  }
  if (arg === 'stop' || arg === 'off') { lesson = undefined; await $.store.delete('lesson').catch(() => undefined); return { text: 'lesson ended' } }
  const history = runs.length ? coachNotes(runs, undefined, Date.now()) : 'No runs recorded yet.'
  const r = await $.model.complete({ model: settings.coach, system: LESSON_SYSTEM, prompt: `The player wants to work on: ${arg}\n\nTheir recent history:\n${history}`, maxTokens: 800, effort: 'low', timeoutMs: 60000 })
  if (!r.isAnswered) return { text: `no plan came back (${r.reason})` }
  const m = /\{[\s\S]*\}/.exec(r.text)
  let plan: { title?: unknown; steps?: unknown }
  try { plan = JSON.parse(m?.[0] ?? '') } catch { return { text: `the plan was not JSON:\n${r.text.slice(0, 400)}` } }
  const steps: Lesson['steps'] = []
  const rejected: string[] = []
  for (const s of Array.isArray(plan.steps) ? plan.steps : []) {
    if (typeof s !== 'object' || s === null || typeof (s as { command?: unknown }).command !== 'string') continue
    const command = (s as { command: string }).command.replace(/^\/hero\s+/, '').trim()
    const goal = Math.max(50, Math.min(98, Math.round(Number((s as { goal?: unknown }).goal) || 85)))
    const why = String((s as { why?: unknown }).why ?? '')
    const [verb = '', ...words] = command.split(/\s+/)
    try {
      if (verb === 'play') { if (!STARTERS[words[0] ?? '']) throw new Error('unknown song') }
      else buildExercise(verb, words)
      steps.push({ command, goal, why })
    } catch (err) {
      rejected.push(`${command} (${err instanceof Error ? err.message.slice(0, 60) : 'bad'})`)
    }
  }
  if (steps.length === 0) return { text: `none of the plan's steps were runnable${rejected.length ? `: ${rejected.join('; ')}` : ''}` }
  lesson = { title: typeof plan.title === 'string' ? plan.title : arg, goal: arg, steps, step: 0, done: steps.map(() => false) }
  await $.store.set('lesson', lesson).catch(() => undefined)
  const rows = steps.map((s, i) => `${i === 0 ? '▶' : ' '} ${i + 1}. ${s.command} · goal ${s.goal}% · ${s.why}`)
  return { text: [`lesson: ${lesson.title}`, ...rows, ...(rejected.length ? [`(skipped: ${rejected.join('; ')})`] : []), '', '/hero next runs step 1 · after each run the goal is checked · /hero coach for feedback'].join('\n') }
}
