# cc-hero

Guitar practice in a Claude Code pane. `/hero` scrolls a song past a now-marker
as tablature and standard notation, Guitar Hero style, and scores what you play.
With the microphone listener on it hears the guitar, judges each note's pitch and
timing, and doubles as a tuner. Without it, the space bar strums for timing practice.

A Claude Code **mod** (a plugin whose behaviour is a function-hooks module), so it
needs the early-access flag:

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir /path/to/cc-hero
```

then, inside the session:

```
/hero play ode        # a built-in song: /hero list shows them
/hero play my.json    # your own (see songs/README.md)
/hero search wonderwall           # look a song up on Ultimate Guitar: the pane lists the results
/hero play #2                     # or open one by number: chords play as a chord sheet, tabs as notes
/hero play https://tabs.ultimate-guitar.com/tab/...   # or paste a page's URL
/hero tune            # the tuner
/hero mic on          # start listening (ffmpeg; macOS asks once for microphone access)
/hero latency 80      # if hits read late: how many ms behind the listener hears you
/hero stop
```

Use fullscreen rendering (`/tui fullscreen` once, or `CLAUDE_CODE_NO_FLICKER=1`):
it captures the mouse so you can click the pane, and in a terminal 110 columns
or wider it docks the pane beside the transcript, floor to ceiling.

After a search, click the pane and pick a result with **↑**/**↓** (or j/k), **enter**
to open it, a digit to jump, **t** to go back to the song.

Click the pane to give it the keyboard, then: **enter** starts (with a one-bar
count-in), **space** strums, **p** pauses, **r** restarts, **+**/**-** change the
tempo, **m** toggles the microphone, **t** toggles the tuner, **?** shows the keys,
**esc** hands the keys back to the prompt.

## What you see

```
♪ Ode to Joy · 100 bpm · 340 pts · combo 4 · 92%
e|─────────│─────────────────────────────────────
B|─────────│─────────────────────────────────────
G|─────────│──────────0═══──0═══─────────────────
D|────2════│2═══──3═══──────────3═══──2═══──0═══─
A|─────────│─────────────────────────────────────
E|─────────│─────────────────────────────────────
  ·    ·   ▼    ·    2    ·    ·    ·    3    ·
  ─────────│─────────────────────────────────────
  ─────────│─────────────────────────────────────
𝄞 ─────────│─────────●────●──────────────────────
  ─────────│─●─●─────────────●────●──────────────
  ─────────│─────────────────────────●────●──────
                                            ●
PERFECT (+12ms) · mic ● E3 +4¢
```

Notes turn green when hit (bright for a perfect), yellow for a loose hit, magenta
for a wrong pitch, red for a miss. The magenta diamond on the staff is the pitch
the microphone hears right now.

## Exercises

```
/hero progression G pop            # I V vi IV in G, strummed D DU UDU (pop, axis, doowop, blues, jazz, folk, andalusian, canon)
/hero progression Am i bVII bVI V  # roman numerals or chord names, in any key
/hero pick travis G pop            # fingerpicking over a progression: travis, arp, folk, waltz, pinch
/hero scale pentatonic A 1         # a scale box, up and back: major, minor, pentatonic, majorpentatonic, blues, dorian, mixolydian
/hero caged C                      # the five CAGED forms of a chord up the neck
/hero drill                        # something at random
/hero strum "D DU UDU"             # a strumming pattern for the loaded chord sheet (D, U, X muted, - rest, one token a beat)
```

Options ride along: `--bpm 60`, `--x 3` (repeats), `--beats 2` (beats a chord).
Fingerpicking shows the picking finger (p i m a) above each note and the chord
it belongs to on the ruler. A chord sheet with a strumming pattern shows arrows
under the chord lane, one target a strum; Ultimate Guitar chords pages bring
their own pattern.

## Progress and the coach

```
/hero stats                        # recent runs and the weak spots of the current song
/hero coach                        # Claude reads your run data and says what to work on
/hero lesson chord changes in G    # Claude plans 3-6 drills with accuracy goals
/hero next                         # run the current step; the goal is checked when the run ends
```

Every finished run is recorded in the plugin store: score, accuracy, timing
offsets, and which chords or notes were missed. The coach and the lesson planner
get that data as text through the session's own model access, nothing else.

## Chord sheets

A chords page (or a JSON file with `"kind": "chords"`) opens in chord mode: the
chord names scroll along a lane past the now-marker, the current and the next
shape are drawn as diagrams, and the words of the current line light up as they
are sung, the next line dim below. Each chord lasts one bar unless the file says
otherwise (`/hero import beats 2` halves that for the next import). The tempo
comes from the page's strumming pattern when it has one, else 90 bpm; `+`/`-`
change it while you play.

Strums are judged by chroma: the listener measures how much energy each pitch
class carries and compares it with the chord's template, so an Am strum counts
for Am and not for C, even though they share two notes. Without the microphone,
space strums.

Ultimate Guitar pages are fetched as your browser would and cached in the plugin
store. They are for your own practice; the site's terms apply to what you do with
them.

## The listener

`listen/listen.ts` is a small process the mod starts through `$.process.spawn`
(bun, or node 22+). It captures audio with `ffmpeg` (avfoundation on macOS, pulse
on Linux, dshow on Windows), runs YIN pitch detection on 93 ms windows every 23 ms,
and streams one JSON line per frame with what it hears and the recent note onsets.
Nothing leaves the machine.

- `brew install ffmpeg` if you do not have it.
- macOS asks once for microphone access for the terminal app you run Claude in.
- A different input: `/hero mic devices` lists them and `/hero mic device <n or name>`
  picks one. A guitar with a USB audio output (the Donner HUSH-I PRO, for one) or
  any USB guitar interface shows up there and gives a far cleaner signal than a
  microphone. A guitar with only a 1/4" jack (the plain HUSH-I) needs a small
  interface between it and the Mac.

Test it without a guitar:

```sh
ffmpeg -f lavfi -i "sine=frequency=110:duration=2" -ar 22050 /tmp/a.wav
bun listen/listen.ts --out - --input /tmp/a.wav | head -3
```

or play a recording through the whole thing: `/hero mic file take.wav 3.5` feeds
the file as if it were the microphone and starts the song so that beat 0 lands
3.5 seconds into it (with the one-bar count-in shown first). Without the number,
you start the song yourself with enter.

## Development

```sh
claude -p '/plugin-types'                     # writes .claude/types/ (the API contract)
bunx tsc -p tsconfig.json                     # typecheck hooks and tests
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test .
claude plugin validate .
```

Layout: `hooks/register.tsx` is the hooks module (the `/hero` command, the pane,
the listener's lifecycle, best scores in `$.store`); `hooks/board/hero.tsx` is
the surface module that draws and judges on the drawing thread; `hooks/music/`
holds the pure logic (pitches, staff positions, songs, scoring); `listen/` is the
microphone helper.

The function-hooks API is early access and may change between Claude Code releases.
