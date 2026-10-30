#!/usr/bin/env node
/**
 * Records what a real agent CLI draws in a full-screen terminal, for the terminal bench (F16): every chunk of
 * output with its time, nothing else. Run it in a throwaway test folder; it sends a couple of short prompts and exits.
 *
 *   ELECTRON_RUN_AS_NODE=1 npx electron scripts/capture-tui.cjs <claude|codex> <out.jsonl> [cwd]
 *
 * node-pty is built for Electron's ABI in this repository, hence Electron as Node. Before writing, the recording is
 * scrubbed of the user name, the home folder, the machine name and any e-mail address, each replaced by a
 * placeholder of the same length so the byte counts and the screen layout stay the same.
 * Each line of the output: {"t": <ms since start>, "d": "<base64 of the bytes>"}. The first line is a header.
 */
const { spawn } = require('node-pty')
const { writeFileSync } = require('node:fs')
const os = require('node:os')

const [cli, out, cwd = process.cwd()] = process.argv.slice(2)
if (!cli || !out) { console.error('usage: capture-tui.cjs <claude|codex> <out.jsonl> [cwd]'); process.exit(2) }

const COLS = 120, ROWS = 36
const PROMPTS = ['Say hello in one short sentence.', 'What is 2 + 2? Answer with the number only.']
const command = process.platform === 'win32' ? (cli === 'codex' ? 'codex.cmd' : 'claude.exe') : cli
const term = spawn(command, [], { name: 'xterm-256color', cols: COLS, rows: ROWS, cwd, env: process.env })

const start = Date.now()
const chunks = []
let last = Date.now()
term.onData(data => { chunks.push({ t: Date.now() - start, d: data }); last = Date.now() })

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
/** Waits until the screen has been still for `quiet` ms (the agent finished drawing), at most `max` ms. */
async function settle(quiet, max) { const until = Date.now() + max; while (Date.now() < until && Date.now() - last < quiet) await sleep(200) }
async function type(text) { for (const char of text) { term.write(char); await sleep(25) } await sleep(300); term.write('\r') }

/** Same-length replacements, so the recording keeps its byte counts and layout. */
function scrub(text) {
  const same = (value, fill) => fill.repeat(Math.max(1, value.length)).slice(0, value.length)
  const secrets = [os.homedir(), os.userInfo().username, os.hostname()].filter(value => value && value.length >= 3)
  let result = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, match => same(match, 'x'))
  for (const secret of secrets.sort((a, b) => b.length - a.length)) result = result.split(secret).join(same(secret, 'u'))
  return result
}

;(async () => {
  await settle(2500, 20000) // the welcome screen
  // A fresh folder asks first whether to work in it (the throwaway test folder, so yes): Claude Code defaults to
  // "No, exit" and needs ↓ then Enter; Codex defaults to yes.
  // Words on a TUI are placed with cursor moves, not spaces: strip the escapes and allow for missing blanks.
  const screen = chunks.map(chunk => chunk.d).join('').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
  if (/trust\s*this\s*folder|work\s*in\s*this\s*folder|allow\s*Codex/i.test(screen)) {
    if (cli === 'claude') { term.write('\x1b[B'); await sleep(400) }
    term.write('\r')
    await settle(2500, 20000)
  }
  for (const prompt of PROMPTS) { await type(prompt); await sleep(1500); await settle(4000, 90000) }
  term.write(cli === 'codex' ? '\x03' : '/exit\r')
  await sleep(1500)
  try { term.kill() } catch { /* already gone */ }
  const header = { cli, cols: COLS, rows: ROWS, ms: Date.now() - start, chunks: chunks.length }
  // Scrub the whole stream at once (a name can be split across two chunks), then cut it back at the same places:
  // every replacement has the length of what it replaces.
  const clean = scrub(chunks.map(chunk => chunk.d).join(''))
  let offset = 0
  const lines = [JSON.stringify(header), ...chunks.map(chunk => {
    const piece = clean.slice(offset, offset + chunk.d.length)
    offset += chunk.d.length
    return JSON.stringify({ t: chunk.t, d: Buffer.from(piece, 'utf8').toString('base64') })
  })]
  writeFileSync(out, lines.join('\n') + '\n')
  console.log(`[capture-tui] ${cli}: ${chunks.length} chunks over ${(header.ms / 1000).toFixed(1)} s → ${out}`)
  process.exit(0)
})()
