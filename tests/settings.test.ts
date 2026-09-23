import { describe, expect, mock, test, tier } from 'claude-code/testing'
import { DEFAULTS, parseSetting, settingsOf } from '../hooks/settings.ts'

tier('user')

describe('settings', () => {
  test('values parse by kind and fall back on nonsense', async () => {
    expect(parseSetting('latency', '80')).toEqual({ value: 80 })
    expect(parseSetting('latency', 'soon')).toEqual({ error: 'latency is a number' })
    expect(parseSetting('latency', '5000')).toEqual({ error: 'latency is at most 1000' })
    expect(parseSetting('coach', 'Haiku')).toEqual({ value: 'haiku' })
    expect(parseSetting('coach', 'gpt')).toEqual({ error: 'coach is one of sonnet, haiku, opus' })
    expect(parseSetting('device', ' 2 ')).toEqual({ value: '2' })
    expect(settingsOf({ latencyMs: 60, coachModel: 'opus', paneRows: 'tall', micDevice: '' })).toEqual({ ...DEFAULTS, latency: 60, coach: 'opus' })
  })

  test('/hero config reads the manifest options, writes the config row, and survives a reload', async ($, on) => {
    mock.clock(on)
    mock.store(on, {})
    const written: Record<string, unknown> = {}
    on('config.set', ($, e) => { written[e.key] = e.value; return { value: e.value } })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const run = (args: string) => $.command.run({ command: 'hero', args, origin: { kind: 'composer' } } as never)
    expect((await run('config')).text).toContain('latency  0')
    expect((await run('config latency 75')).text).toBe('latency set to 75')
    expect(written['cc-hero.latencyMs']).toBe(75)
    expect((await run('latency')).text).toContain('75 ms')
    expect((await run('config coach haiku')).text).toBe('coach set to haiku')
    expect((await run('config coach gpt')).text).toContain('one of sonnet, haiku, opus')
    expect((await run('import beats 2')).text).toContain('beats set to 2')
    expect(written['cc-hero.beatsPerChord']).toBe(2)
    expect((await run('config strum hello')).text).toContain('a pattern is beats')
    expect((await run('config strum D DU')).text).toBe('strum set to D DU')
    expect((await run('config')).text).toContain('(default 0)')
  })
})
