import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

// the kit's environment has timers; the es2023 lib the tsconfig names does not declare them
declare function setTimeout(fn: () => void, ms: number): unknown

tier('user')

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

// the board keeps song time by the wall clock, so this test waits for real
async function boot($: Engine, on: On) {
  mock.clock(on)
  mock.store(on, {})
  const opened: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', ($, e) => { opened.push(e.id); return { value: { isPlaced: true } } })
  on('ui.close', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  return opened
}

const PANE = { title: 'cc-hero', isFocused: true, bodyColumns: 120, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 26 }, view: {} }

describe('board', () => {
  test('/hero play opens the pane and draws the song as tab and staff', async ($, on) => {
    const opened = await boot($, on)
    const { text } = await $.command.run({ command: 'hero', args: 'play ode', origin: { kind: 'composer' } } as never)
    expect(text).toContain('Ode to Joy')
    expect(opened).toEqual(['hero'])
    const ui = await $.ui.mount({ plugin: 'cc-hero', surface: 'terminal', component: 'Pane', requestId: 'hero', props: PANE, viewport: { columns: 150, rows: 45 } })
    await ui.advance(50)
    expect(await ui.find({ type: 'Text', text: /Ode to Joy · 100 bpm/, in: 'hero' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /space or enter starts/, in: 'hero' })).toBeDefined()
    // the six tab lines carry their labels, the staff its clef
    for (const label of ['e', 'B', 'G', 'D', 'A', 'E']) expect(await ui.find({ type: 'Text', text: new RegExp(`^${label}\\|─`), in: 'hero' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /𝄞/, in: 'hero' })).toBeDefined()
    await ui.unmount()
  })

  test('enter counts in, a strum on the beat scores, and the run ends with a verdict', async ($, on) => {
    await boot($, on)
    await $.command.run({ command: 'hero', args: 'play cmajor', origin: { kind: 'composer' } } as never)
    const ui = await $.ui.mount({ plugin: 'cc-hero', surface: 'terminal', component: 'Pane', requestId: 'hero', props: PANE, viewport: { columns: 150, rows: 45 } })
    await ui.advance(50)
    await ui.key({ key: 'return', in: 'hero' })
    await ui.advance(50)
    expect(await ui.find({ type: 'Text', text: /count-in/, in: 'hero' })).toBeDefined()
    // C major at 90 bpm: a 4-beat count-in is 2667 ms; strum just after beat 0
    await sleep(2667 + 40)
    await ui.advance(50)
    await ui.key({ key: ' ', in: 'hero' })
    await ui.advance(50)
    expect(await ui.find({ type: 'Text', text: /PERFECT|great/, in: 'hero' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /combo 1/, in: 'hero' })).toBeDefined()
    await ui.unmount()
  })

  test('the tuner view and the mic toggle post back to the hooks', async ($, on) => {
    await boot($, on)
    await $.command.run({ command: 'hero', args: 'play ode', origin: { kind: 'composer' } } as never)
    const ui = await $.ui.mount({ plugin: 'cc-hero', surface: 'terminal', component: 'Pane', requestId: 'hero', props: PANE, viewport: { columns: 150, rows: 45 } })
    await ui.advance(50)
    await ui.key({ key: 't', in: 'hero' })
    await ui.advance(100)
    expect(await ui.find({ type: 'Text', text: /cc-hero tuner/, in: 'hero' })).toBeDefined()
    await ui.key({ key: 't', in: 'hero' })
    await ui.advance(100)
    expect(await ui.find({ type: 'Text', text: /space or enter starts/, in: 'hero' })).toBeDefined()
    await ui.unmount()
  })
})

describe('search', () => {
  test('/hero search opens a picker; arrows and enter open a result', async ($, on) => {
    const { page } = await import('./fixtures/ug-amazing-grace.ts')
    const wrap = (data: unknown) => `<html><div class="js-store" data-content="${JSON.stringify({ store: { page: { data } } }).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></div></html>`
    const searchHtml = wrap({ results: [
      { id: 1, type: 'Tabs', song_name: 'Amazing Grace', artist_name: 'Trad', votes: 90, rating: 4.5, tab_url: 'https://tabs.ultimate-guitar.com/tab/trad/amazing-grace-tabs-1' },
      { id: 614298, type: 'Chords', song_name: 'Amazing Grace', artist_name: 'Misc Praise Songs', votes: 50, rating: 4.9, tab_url: 'https://tabs.ultimate-guitar.com/tab/misc-praise-songs/amazing-grace-chords-614298' },
    ] })
    // hooks beneath the plugin register before the first call on $
    on('http.fetch', ($, e) => ({ value: { status: 200, ok: true, headers: {}, text: e.url.includes('search.php') ? searchHtml : wrap(page) } }))
    await boot($, on)
    const { text } = await $.command.run({ command: 'hero', args: 'search amazing grace', origin: { kind: 'composer' } } as never)
    expect(text).toContain('1. Tabs')
    const ui = await $.ui.mount({ plugin: 'cc-hero', surface: 'terminal', component: 'Pane', requestId: 'hero', props: PANE, viewport: { columns: 150, rows: 45 } })
    await ui.advance(50)
    expect(await ui.find({ type: 'Text', text: /search: amazing grace · 2 results/, in: 'hero' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▶  1\. Tabs/, in: 'hero' })).toBeDefined()
    await ui.key({ key: 'down', in: 'hero' })
    await ui.advance(50)
    expect(await ui.find({ type: 'Text', text: /▶  2\. Chords/, in: 'hero' })).toBeDefined()
    await ui.key({ key: 'return', in: 'hero' })
    // the pick posts on the next frame; the hooks fetch the page and switch to the song
    await ui.advance(50)
    await ui.advance(50)
    await ui.advance(50)
    expect(await ui.find({ type: 'Text', text: /Amazing Grace · Misc Praise Songs · chords · .*70 bpm/, in: 'hero' })).toBeDefined()
    await ui.unmount()
  })
})
