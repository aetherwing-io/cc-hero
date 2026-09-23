// The microphone listener: a small process the mod starts (`/hero mic on`) that
// captures audio through ffmpeg (avfoundation on macOS), detects pitch with YIN
// and keeps one JSON file current with what it hears. Runs under bun or node 22+.
//
//   bun listen/listen.ts --out ~/.cc-hero/mic.json [--device 0] [--rate 22050]
//
// Only node APIs, so either runtime works; no third-party packages.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { yin, rmsOf } from './yin.ts'
import { chromaOf } from './chroma.ts'
import { bestChord } from '../hooks/music/chords.ts'

type Onset = { t: number; midi: number; hz: number; cents: number; rms: number; chroma?: number[]; chord?: string; chordScore?: number }
type Now = { hz: number; midi: number; cents: number; rms: number; chord?: string; chordScore?: number } | null

const args = process.argv.slice(2)
const argOf = (name: string, fallback: string) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? String(args[i + 1]) : fallback
}
const out = argOf('--out', '')
if (!out) { console.error('listen: --out <file> is required'); process.exit(2) }
const device = argOf('--device', '0')
const rate = Number(argOf('--rate', '22050'))
// YIN reads the newest PITCH_WINDOW samples; chroma reads the whole WINDOW
const WINDOW = 4096
const PITCH_WINDOW = 2048
const HOP = 512
const GATE = Number(argOf('--gate', '0.012'))
const RING = 32

const state = { t: Date.now(), pid: process.pid, started: 0, now: null as Now, onsets: [] as Onset[], message: 'starting', error: undefined as string | undefined }
let lastWrite = 0
// stdout carries the same state as the file, one JSON line per write, for a
// parent that streams it instead of polling the file
const emit = process.argv.includes('--stdout')
let lastEmit = 0

const candidates = ['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']
const ffmpeg = candidates.find(c => c === 'ffmpeg' ? Boolean(process.env.PATH) : existsSync(c)) ?? 'ffmpeg'
// --input <audio file> plays a recording at its real pace instead of opening a microphone
const file = argOf('--input', '')
const input = file ? ['-re', '-i', file]
  : process.platform === 'darwin' ? ['-f', 'avfoundation', '-i', `:${device}`]
  : process.platform === 'linux' ? ['-f', 'pulse', '-i', device === '0' ? 'default' : device]
  : ['-f', 'dshow', '-i', `audio=${device}`]

const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...input, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], { stdio: ['ignore', 'pipe', 'pipe'] })
let stderr = ''
child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); if (stderr.length > 4000) stderr = stderr.slice(-4000) })
child.on('error', err => { state.error = `ffmpeg did not start: ${err.message}`; state.message = state.error; write(true); process.exit(1) })
child.on('exit', code => {
  if (state.error === undefined) state.error = file && code === 0 ? `finished ${file}` : `ffmpeg exited (${code}): ${stderr.trim() || 'no output; on macOS check the microphone permission of your terminal app'}`
  state.message = state.error
  state.now = null
  write(true)
  process.exit(code ?? 1)
})
const stop = () => { state.error = 'stopped'; state.message = 'stopped'; state.now = null; write(true); child.kill('SIGTERM'); setTimeout(() => process.exit(0), 100) }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)

state.message = file ? `playing ${file}` : `listening on device ${device} at ${rate} Hz`
write(true)
setInterval(() => write(true), 250) // heartbeat through silence

// a circular buffer of the last WINDOW samples, analysed every HOP samples
const circ = new Float32Array(WINDOW)
const ring = new Float32Array(WINDOW)
let head = 0
let filled = 0
let pendingBytes = Buffer.alloc(0)
let sinceHop = 0
let prevMidi = -1
let stable = 0
let silentFrames = 99
let lastOnsetMidi = -1
let lastOnsetAt = 0
const hopMs = (HOP / rate) * 1000

function write(force = false) {
  const t = Date.now()
  if (!force && t - lastWrite < 30) return
  lastWrite = t
  state.t = t
  const text = JSON.stringify(state)
  if (out !== '-') {
    const dir = dirname(out)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${out}.${process.pid}.tmp`
    writeFileSync(tmp, text)
    renameSync(tmp, out)
  }
  if (emit || out === '-') {
    if (force || t - lastEmit >= 30) { lastEmit = t; process.stdout.write(text + '\n') }
  }
}

function linearize() {
  // oldest sample first
  const first = WINDOW - head
  ring.set(circ.subarray(head), 0)
  ring.set(circ.subarray(0, head), first)
}

// the levels of the last few hops: a hop well above all of them is an attack
const recentHops: number[] = []
const MIN_GAP_MS = 150
const SETTLE_FRAMES = 3
// an attack or a pitch change arms an onset; it fires once the pitch has held a few
// frames past the arming, stamped with the time it was armed, so a re-pluck of the same note counts
// and a new note is never stamped with the old note's pitch
let armedAt = -1
// audio time: the wall clock when the first sample arrived, plus samples since, so an
// onset's stamp does not jitter with how the pipe delivers chunks
let samplesSeen = 0

let armedFrames = 0

function frame() {
  linearize()
  const t = state.started + (samplesSeen / rate) * 1000
  const pitchBuf = ring.subarray(WINDOW - PITCH_WINDOW)
  const rms = rmsOf(pitchBuf)
  const hopRms = rmsOf(ring.subarray(WINDOW - HOP))
  const floor = recentHops.length ? Math.max(...recentHops) : 0
  const attack = hopRms > floor * 1.5 && hopRms > GATE * 1.5
  recentHops.push(hopRms)
  if (recentHops.length > 4) recentHops.shift()
  if (attack) { armedAt = t; armedFrames = 0; stable = 0 } // count settled frames from the attack, not before it
  if (rms < GATE) {
    state.now = null
    silentFrames++
    stable = 0
    prevMidi = -1
    armedAt = -1
    write()
    return
  }
  // what the chord templates make of the window: names a strum no single pitch fits
  const chroma = chromaOf(ring, rate)
  const chord = bestChord(chroma)
  const p = yin(pitchBuf, rate)
  const pitched = p !== null && p.clarity >= 0.6
  let midi = -1
  let cents = 0
  let hz = 0
  if (pitched) {
    const exact = 69 + 12 * Math.log2(p.hz / 440)
    midi = Math.round(exact)
    cents = Math.round((exact - midi) * 100)
    hz = Math.round(p.hz * 10) / 10
  }
  const now: Now = { hz, midi, cents, rms: Math.round(rms * 1000) / 1000 }
  if (chord) { now.chord = chord.name; now.chordScore = Math.round(chord.score * 100) / 100 }
  state.now = now
  if (pitched) {
    if (midi !== prevMidi) {
      stable = 1
      // a new pitch arms an onset, except in the wake of one just fired: a strum's strings
      // settle one after another, and that is one strum, not several notes
      if ((midi !== lastOnsetMidi || silentFrames >= 2) && t - lastOnsetAt > 180) { armedAt = t; armedFrames = 0 }
    } else stable++
  } else stable = 0
  if (armedAt >= 0) armedFrames++
  if (armedAt >= 0 && t - armedAt > 300) armedAt = -1 // never settled: a scrape, not a note
  // fire once the pitch has held, or after a few frames of sound with no single pitch (a strum)
  const settled = armedAt >= 0 && ((pitched && stable >= SETTLE_FRAMES) || (!pitched && armedFrames >= SETTLE_FRAMES + 1))
  if (settled) {
    const at = Math.round(armedAt - hopMs)
    armedAt = -1
    if (at - lastOnsetAt > MIN_GAP_MS) {
      const onset: Onset = { t: at, midi, hz, cents, rms: now.rms, chroma }
      if (chord) { onset.chord = chord.name; onset.chordScore = Math.round(chord.score * 100) / 100 }
      state.onsets.push(onset)
      if (state.onsets.length > RING) state.onsets.splice(0, state.onsets.length - RING)
      lastOnsetMidi = midi
      lastOnsetAt = at
      write(true)
    }
  } else write()
  silentFrames = 0
  prevMidi = midi
}

child.stdout.on('data', (chunk: Buffer) => {
  pendingBytes = pendingBytes.length ? Buffer.concat([pendingBytes, chunk]) : chunk
  const usable = pendingBytes.length - (pendingBytes.length % 4)
  const samples = new Float32Array(pendingBytes.buffer.slice(pendingBytes.byteOffset, pendingBytes.byteOffset + usable))
  pendingBytes = pendingBytes.subarray(usable)
  if (!state.started && samples.length) state.started = Date.now() - (samples.length / rate) * 1000
  for (let i = 0; i < samples.length; i++) {
    samplesSeen++
    circ[head] = samples[i] ?? 0
    head = (head + 1) % WINDOW
    filled = Math.min(WINDOW, filled + 1)
    if (++sinceHop >= HOP && filled === WINDOW) {
      sinceHop = 0
      frame()
    }
  }
})
