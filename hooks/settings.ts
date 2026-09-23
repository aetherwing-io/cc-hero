// The settings a person can change: declared in plugin.json as userConfig (so
// they show in /config and persist with Claude Code's plugin configuration),
// read here from the options register() receives, and written back through
// $.config.set. Pure definitions and parsing; the hooks module holds the values.

export type SettingKey = 'device' | 'latency' | 'beats' | 'steps' | 'bpm' | 'strum' | 'coach' | 'rows'

export type Settings = {
  device: string
  latency: number
  beats: number
  steps: number
  bpm: number
  strum: string
  coach: string
  rows: number
}

export const DEFAULTS: Settings = { device: '0', latency: 0, beats: 4, steps: 4, bpm: 90, strum: 'D DU UDU', coach: 'sonnet', rows: 28 }

/** The plugin.json field each setting lives in, and how to read a value for it. */
export const FIELDS: { key: SettingKey; field: string; label: string; kind: 'text' | 'number' | 'choice'; min?: number; max?: number; options?: readonly string[]; help: string }[] = [
  { key: 'device', field: 'micDevice', label: 'mic device', kind: 'text', help: 'the audio input the listener opens; /hero mic devices lists them' },
  { key: 'latency', field: 'latencyMs', label: 'mic latency (ms)', kind: 'number', min: -500, max: 1000, help: 'how late the listener hears you; subtracted from every note' },
  { key: 'beats', field: 'beatsPerChord', label: 'beats per chord', kind: 'number', min: 0.5, max: 16, help: 'how long a chord lasts on an imported chord sheet' },
  { key: 'steps', field: 'stepsPerBeat', label: 'tab columns per beat', kind: 'number', min: 1, max: 8, help: 'how an imported tab page reads its dashes' },
  { key: 'bpm', field: 'importBpm', label: 'import tempo', kind: 'number', min: 20, max: 400, help: 'tempo for an imported page that names none' },
  { key: 'strum', field: 'defaultStrum', label: 'default strum', kind: 'text', help: 'the strumming pattern a progression exercise starts with' },
  { key: 'coach', field: 'coachModel', label: 'coach model', kind: 'choice', options: ['sonnet', 'haiku', 'opus'], help: 'the model the coach and the lesson planner use' },
  { key: 'rows', field: 'paneRows', label: 'pane rows', kind: 'number', min: 12, max: 60, help: 'rows the pane asks for when it opens above the prompt' },
]

export const fieldOf = (key: SettingKey) => FIELDS.find(f => f.key === key)!

/** A setting's value from text (or a config value), or a reason it is not one. */
export function parseSetting(key: SettingKey, raw: unknown): { value: Settings[SettingKey] } | { error: string } {
  const f = fieldOf(key)
  const text = String(raw ?? '').trim()
  if (f.kind === 'number') {
    const n = Number(text)
    if (!text || !Number.isFinite(n)) return { error: `${key} is a number` }
    if (f.min !== undefined && n < f.min) return { error: `${key} is at least ${f.min}` }
    if (f.max !== undefined && n > f.max) return { error: `${key} is at most ${f.max}` }
    return { value: n }
  }
  if (f.kind === 'choice') {
    const pick = f.options!.find(o => o.toLowerCase() === text.toLowerCase())
    return pick ? { value: pick } : { error: `${key} is one of ${f.options!.join(', ')}` }
  }
  if (!text) return { error: `${key} needs a value` }
  return { value: text }
}

/** Settings from the options register() gets (userConfig fields, defaults filled in), unknown or bad ones falling back. */
export function settingsOf(options: Readonly<Record<string, unknown>>, fallback: Settings = DEFAULTS): Settings {
  const out: Settings = { ...fallback }
  for (const f of FIELDS) {
    const raw = options[f.field]
    if (raw === undefined || raw === null || raw === '') continue
    const parsed = parseSetting(f.key, raw)
    if ('value' in parsed) (out as Record<string, unknown>)[f.key] = parsed.value
  }
  return out
}

export const settingsText = (s: Settings): string =>
  FIELDS.map(f => `${f.key.padEnd(8)} ${String(s[f.key]).padEnd(10)} ${f.help}${s[f.key] === DEFAULTS[f.key] ? '' : `  (default ${DEFAULTS[f.key]})`}`).join('\n')
