#!/usr/bin/env node
'use strict'
/**
 * Release check for the Claude stream-json control protocol Thread mode relies
 * on. It starts the installed `claude`, sends `initialize` and a cooperative
 * `interrupt` (with `cancel_queued`) and verifies both are answered with a
 * success response. No prompt is sent, so it spends no inference quota.
 *
 *   node scripts/probe-claude-protocol.cjs
 *
 * Exit code 0 = the protocol surface is as Thread mode expects.
 */
const { spawn } = require('node:child_process')

const TIMEOUT_MS = 20_000
const child = spawn(
  'claude',
  ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompts', 'host'],
  { shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] }
)

const responses = new Map()
let version = null
let buffer = ''
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString()
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    try {
      const message = JSON.parse(line)
      if (message.type === 'control_response') {
        const response = message.response ?? {}
        responses.set(response.request_id, response)
        if (response.request_id === 'initialize') version = response.response?.claude_code_version ?? null
      }
    } catch { /* non-JSON diagnostics */ }
  }
})

const send = (value) => child.stdin.write(JSON.stringify(value) + '\n')
const finish = (code, message) => {
  console.log(message)
  child.kill()
  process.exit(code)
}

const timer = setTimeout(() => finish(1, 'FAIL: no answer from claude within the timeout'), TIMEOUT_MS)
child.on('error', (error) => finish(1, `FAIL: could not start claude: ${error.message}`))

send({ type: 'control_request', request_id: 'initialize', request: { subtype: 'initialize' } })
const poll = setInterval(() => {
  const init = responses.get('initialize')
  if (init && !responses.has('probe-interrupt') && !poll.sent) {
    poll.sent = true
    if (init.subtype !== 'success') return finish(1, `FAIL: initialize answered ${init.subtype}`)
    send({ type: 'control_request', request_id: 'probe-interrupt', request: { subtype: 'interrupt', cancel_queued: true } })
  }
  const interrupt = responses.get('probe-interrupt')
  if (interrupt) {
    clearInterval(poll)
    clearTimeout(timer)
    if (interrupt.subtype !== 'success') return finish(1, `FAIL: interrupt answered ${interrupt.subtype}: ${interrupt.error ?? ''}`)
    const keys = Object.keys(interrupt.response ?? {})
    finish(0, `OK: claude ${version ?? '?'} accepts initialize and interrupt{cancel_queued} (response keys: ${keys.join(', ') || 'none'})`)
  }
}, 100)
