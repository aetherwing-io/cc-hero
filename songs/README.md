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
