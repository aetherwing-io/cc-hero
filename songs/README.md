# Song files

`/hero play path/to/song.json` loads one of these. A song is:

```json
{
  "title": "Name",
  "bpm": 100,
  "beatsPerBar": 4,
  "tuning": "standard",
  "notes": [ { "b": 0, "s": 4, "f": 2, "l": 1 } ]
}
```

- `b` the beat the note starts on (0-based, fractions allowed: `0.5` is an eighth)
- `s` the string, 1 (high e) to 6 (low E)
- `f` the fret, 0 for open
- `l` the length in beats (1 when left out)
- `tuning` one of `standard`, `drop-d`, `half-down`

Notes at the same beat draw stacked; the listener is monophonic, so it hears one of them.

## Chord sheets

A chord song has `"kind": "chords"` and a `chords` array instead of `notes`:

```json
{
  "kind": "chords",
  "title": "Name",
  "artist": "Who",
  "bpm": 80,
  "beatsPerBar": 4,
  "chords": [
    { "b": 0, "l": 4, "name": "G", "lyric": "Amazing Grace, how", "section": "Verse", "line": 1 },
    { "b": 4, "l": 4, "name": "G7", "lyric": "sweet the", "line": 1 },
    { "b": 8, "l": 4, "name": "C", "lyric": "sound", "line": 1, "frets": [-1, 3, 2, 0, 1, 0] }
  ]
}
```

- `name` any chord a sheet writes: `Am`, `G7`, `F#m7`, `Dsus4`, `Cadd9`, `G/B`
- `lyric` the words sung from this chord to the next; they light up in turn while the chord lasts
- `line` which line of the sheet the chord sits on, so a line's words show together
- `frets` a shape to draw, strings 6 (low E) to 1, `-1` for a muted string; left out, the built-in open shape or a barre at the root
- `l` beats the chord lasts; left out, until the next chord

`/hero play <Ultimate Guitar chords URL>` builds one of these from a page.
