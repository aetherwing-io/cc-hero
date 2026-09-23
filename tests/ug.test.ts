import { describe, expect, test, tier } from 'claude-code/testing'
import { chordSheetOf, searchResultsOf, songOfPage, tabNotesOf, tabPageOf, unescapeHtml, type UgPage } from '../hooks/ug/parse.ts'
import { isChordSong, placeChords } from '../hooks/music/song.ts'
import { page as grace } from './fixtures/ug-amazing-grace.ts'
import { page as risingSun } from './fixtures/ug-rising-sun-tab.ts'

tier('user')

describe('ug', () => {
  test('the js-store JSON comes out of a page and search results are ranked', async () => {
    const store = { store: { page: { data: { results: [
      { id: 1, type: 'Chords', song_name: 'A', artist_name: 'X', votes: 5, rating: 4.5, tab_url: 'https://tabs.ultimate-guitar.com/tab/x/a-chords-1' },
      { id: 2, type: 'Tabs', song_name: 'A', artist_name: 'X', votes: 50, rating: 4.9, tab_url: 'https://tabs.ultimate-guitar.com/tab/x/a-tabs-2' },
      { id: 3, type: 'Pro', song_name: 'A', artist_name: 'X', votes: 500, tab_url: 'https://tabs.ultimate-guitar.com/tab/x/a-pro-3' },
    ] } } } }
    const html = `<html><div class="js-store" data-content="${JSON.stringify(store).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></div></html>`
    expect(unescapeHtml('&quot;a&quot; &amp; &#39;b&#39; &#x27;c&#x27;')).toBe(`"a" & 'b' 'c'`)
    const results = searchResultsOf(html)
    expect(results.map(r => r.id)).toEqual([2, 1]) // Pro dropped, most votes first
    expect(tabPageOf(html)).toBe(null)
  })

  test('a chords page becomes a chord sheet with lyrics under each chord', async () => {
    const song = songOfPage(grace as unknown as UgPage)
    expect(isChordSong(song)).toBe(true)
    if (!isChordSong(song)) return
    expect(song.title).toBe('Amazing Grace')
    expect(song.artist).toBe('Misc Praise Songs')
    expect(song.bpm).toBe(70) // from the sheet's strumming pattern
    // the first block is a G7 diagram in tab lines: not a chord of the song
    expect(song.chords[0]).toMatchObject({ name: 'G', section: 'Refrain', b: 0, l: 4 })
    // the sheet puts G7 over "Grace" and the last G over "sound"; a chord mid-word keeps the word
    expect(song.chords[0]?.lyric).toBe('Amazing')
    expect(song.chords[1]).toMatchObject({ name: 'G7', lyric: 'Grace, how' })
    expect(song.chords[2]).toMatchObject({ name: 'C', lyric: 'sweet the' })
    expect(song.chords[3]).toMatchObject({ name: 'G', lyric: 'sound That saved a' }) // pickup words of the next line
    expect(song.chords[4]).toMatchObject({ name: 'A', lyric: 'wretch like' })
    expect(song.chords.find(c => c.section === 'Verse 1')).toBeDefined()
    // shapes come from the page, high string first there, low string first here
    expect(song.chords[1]?.frets).toEqual([3, 2, 0, 0, 0, 1])
    const placed = placeChords(song)
    expect(placed[1]?.words.map(w => w.text)).toEqual(['Grace,', 'how'])
    expect(placed[0]?.pcs).toEqual([7, 11, 2])
    expect(placed[0]?.line).toBe(placed[3]?.line)
    expect(placed[4]?.line).not.toBe(placed[0]?.line)
  })

  test('a chord over the middle of a word keeps the word', async () => {
    const events = chordSheetOf('[tab]  [ch]D[/ch]     [ch]A[/ch]\nAmazing grace[/tab]', 4, {})
    expect(events.map(e => e.lyric)).toEqual(['Amazing', 'grace'])
  })

  test('words before the first chord of a line go to the chord before', async () => {
    const events = chordSheetOf('[tab]      [ch]C[/ch]\nOh the [ch]G[/ch]rain[/tab]\n[tab]   [ch]Am[/ch]\nand snow[/tab]', 2, {})
    expect(events.map(e => [e.name, e.lyric ?? ''])).toEqual([['C', 'Oh the'], ['G', 'rain and'], ['Am', 'snow']])
    expect(events[0]?.b).toBe(0)
    expect(events[2]?.b).toBe(4)
  })

  test('an ASCII tab page becomes notes, a column per step', async () => {
    const song = songOfPage(risingSun as unknown as UgPage)
    expect(isChordSong(song)).toBe(false)
    if (isChordSong(song)) return
    expect(song.notes.length).toBeGreaterThan(40)
    // the intro's first notes: open A, then D string fret 2, G string fret 2, B string fret 1, high e open
    expect(song.notes.slice(0, 5).map(n => [n.s, n.f])).toEqual([[5, 0], [4, 2], [3, 2], [2, 1], [1, 0]])
    expect(song.notes[0]?.b).toBe(0.25)
    expect(song.notes[1]!.b - song.notes[0]!.b).toBe(1)
    // the second system continues after the first, not on top of it
    const lastOfFirst = song.notes.filter(n => n.b < 24).length
    expect(lastOfFirst).toBeGreaterThan(20)
    expect(Math.max(...song.notes.map(n => n.b))).toBeGreaterThan(40)
  })

  test('two-digit frets and unlabeled systems', async () => {
    const notes = tabNotesOf('|---12---0---|\n|---0----1---|\n|------------|\n|------------|\n|------------|\n|---3--------|', 4)
    expect(notes.map(n => [n.s, n.f, n.b])).toEqual([[1, 12, 0.75], [2, 0, 0.75], [6, 3, 0.75], [1, 0, 2], [2, 1, 2]])
  })
})
