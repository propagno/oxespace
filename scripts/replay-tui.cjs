#!/usr/bin/env node
/**
 * Plays back a recording made by scripts/capture-tui.cjs into the terminal it runs in, at the recorded pace, over
 * and over: the bytes and timing of a real agent CLI without running the agent. Used by the terminal bench (F16).
 *
 *   node scripts/replay-tui.cjs <recording.jsonl>
 */
const { readFileSync } = require('node:fs')

const [file] = process.argv.slice(2)
if (!file) { console.error('usage: replay-tui.cjs <recording.jsonl>'); process.exit(2) }
const [header, ...rest] = readFileSync(file, 'utf8').trim().split('\n')
const { ms } = JSON.parse(header)
const chunks = rest.map(line => { const { t, d } = JSON.parse(line); return { t, data: Buffer.from(d, 'base64') } })

// The recording ends where the CLI quit; a short pause before it starts again, like a person between turns.
const loop = ms + 1000
let started = Date.now()
let next = 0
setInterval(() => {
  const now = Date.now() - started
  while (next < chunks.length && chunks[next].t <= now) process.stdout.write(chunks[next++].data)
  if (now >= loop) { started = Date.now(); next = 0 }
}, 4)
