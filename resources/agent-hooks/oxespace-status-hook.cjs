#!/usr/bin/env node
'use strict'
// Forwards an agent lifecycle hook to the OXESpace app that launched it, so the
// pane status comes from the agent itself instead of from output timing.
// Fail-open: this runs inside the agent's turn, so every path ends in `{}` on
// stdout and exit 0 -- a missing app, bad port or slow server must never block
// or fail the agent. Hooks outside an OXESpace terminal are inert.
const http = require('node:http')
const agent = process.argv[2] === 'codex' ? 'codex' : 'claude-code'
const MAX_READ = 8 * 1024 * 1024
const HEAD_BYTES = 4096
const CMD_BYTES = 8192
const IDENT_BYTES = 64 * 1024
let input = ''
let overflowed = false
let finished = false
function finish() {
  if (finished) return
  finished = true
  process.stdout.write('{}\n')
  process.exit(0)
}
function cutUtf8(str, maxBytes) {
  if (typeof str !== 'string') return ''
  if (Buffer.byteLength(str, 'utf8') <= maxBytes) return str
  return Buffer.from(str, 'utf8').subarray(0, maxBytes).toString('utf8')
}
function shrinkToolResponse(payload) {
  if (!payload || typeof payload !== 'object') return payload
  if (payload.tool_input && typeof payload.tool_input === 'object' && typeof payload.tool_input.command === 'string') {
    if (Buffer.byteLength(payload.tool_input.command, 'utf8') > CMD_BYTES) {
      payload.tool_input = { ...payload.tool_input, command: cutUtf8(payload.tool_input.command, CMD_BYTES) }
    }
  }
  const isPost = payload.hook_event_name === 'PostToolUse'
  const isShell = payload.tool_name === 'Bash' || payload.tool_name === 'shell'
  const resp = payload.tool_response
  if (!isPost || !isShell || !resp || typeof resp !== 'object') return payload
  const stdout = typeof resp.stdout === 'string' ? resp.stdout : ''
  const stderr = typeof resp.stderr === 'string' ? resp.stderr : ''
  const stdoutBytes = Buffer.byteLength(stdout, 'utf8')
  const stderrBytes = Buffer.byteLength(stderr, 'utf8')
  if (stdoutBytes <= HEAD_BYTES && stderrBytes <= HEAD_BYTES && Buffer.byteLength(input, 'utf8') < 512 * 1024) return payload
  const stdoutHead = cutUtf8(stdout, HEAD_BYTES)
  const stderrHead = cutUtf8(stderr, HEAD_BYTES)
  const next = {
    stdoutHead,
    stderrHead,
    interrupted: Boolean(resp.interrupted),
    truncated: true,
    keptBytes: Buffer.byteLength(stdoutHead, 'utf8'),
    totalBytes: stdoutBytes
  }
  if (resp.error !== undefined) next.error = resp.error
  payload.tool_response = next
  return payload
}
function recoverOversize(head) {
  const payload = { tool_response: { truncated: true, keptBytes: 0 } }
  for (const key of ['hook_event_name', 'tool_name', 'tool_use_id', 'session_id', 'cwd']) {
    const match = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(head)
    if (match) {
      try { payload[key] = JSON.parse(`"${match[1]}"`) } catch { payload[key] = match[1] }
    }
  }
  return payload
}
setTimeout(finish, 2500).unref()
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  if (overflowed) return
  if (input.length + chunk.length > MAX_READ) {
    if (input.length < IDENT_BYTES) input += chunk.slice(0, IDENT_BYTES - input.length)
    else input = input.slice(0, IDENT_BYTES)
    overflowed = true
    return
  }
  input += chunk
})
process.stdin.on('error', finish)
process.stdin.on('end', () => {
  const port = Number(process.env.OXESPACE_AGENT_HOOK_PORT)
  const executionId = process.env.OXESPACE_EXECUTION_ID
  const token = process.env.OXESPACE_EXECUTION_TOKEN
  const workspaceId = process.env.OXESPACE_WORKSPACE_ID
  if (!port || !executionId || !token || !workspaceId) return finish()
  let payload
  if (overflowed) {
    payload = recoverOversize(input.slice(0, IDENT_BYTES))
  } else {
    try { payload = shrinkToolResponse(JSON.parse(input)) } catch { return finish() }
  }
  const body = JSON.stringify({ executionId, token, workspaceId, agent, payload })
  const req = http.request({
    host: '127.0.0.1', port, path: '/hook', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, (res) => { res.resume(); res.on('end', finish) })
  req.setTimeout(1500, () => { req.destroy(); finish() })
  req.on('error', finish)
  req.end(body)
})
