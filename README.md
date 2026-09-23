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
/hero tune            # the tuner
/hero mic on          # start listening (ffmpeg; macOS asks once for microphone access)
/hero latency 80      # if hits read late: how many ms behind the listener hears you
/hero stop
```

Use fullscreen rendering (`/tui fullscreen` once, or `CLAUDE_CODE_NO_FLICKER=1`):
it captures the mouse so you can click the pane, and in a terminal 110 columns
or wider it docks the pane beside the transcript, floor to ceiling.

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

## The listener

`listen/listen.ts` is a small process the mod starts through `$.process.spawn`
(bun, or node 22+). It captures audio with `ffmpeg` (avfoundation on macOS, pulse
on Linux, dshow on Windows), runs YIN pitch detection on 93 ms windows every 23 ms,
and streams one JSON line per frame with what it hears and the recent note onsets.
Nothing leaves the machine.

- `brew install ffmpeg` if you do not have it.
- macOS asks once for microphone access for the terminal app you run Claude in.
- A different input: `/hero mic on` uses device 0; edit `--device` in
  `hooks/register.tsx` for now (`ffmpeg -f avfoundation -list_devices true -i ""`
  lists them).

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
