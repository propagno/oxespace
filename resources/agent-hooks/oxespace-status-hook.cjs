#!/usr/bin/env node
'use strict'
// Forwards an agent lifecycle hook to the OXESpace app that launched it, so the
// pane status comes from the agent itself instead of from output timing.
// Fail-open: this runs inside the agent's turn, so every path ends in `{}` on
// stdout and exit 0 -- a missing app, bad port or slow server must never block
// or fail the agent. Hooks outside an OXESpace terminal are inert.
const http = require('node:http')
const agent = process.argv[2] === 'codex' ? 'codex' : 'claude-code'
let input = ''
let finished = false
function finish() {
  if (finished) return
  finished = true
  process.stdout.write('{}\n')
  process.exit(0)
}
setTimeout(finish, 2500).unref()
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { if (input.length < 1024 * 1024) input += chunk })
process.stdin.on('error', finish)
process.stdin.on('end', () => {
  const port = Number(process.env.OXESPACE_AGENT_HOOK_PORT)
  const executionId = process.env.OXESPACE_EXECUTION_ID
  const token = process.env.OXESPACE_EXECUTION_TOKEN
  const workspaceId = process.env.OXESPACE_WORKSPACE_ID
  if (!port || !executionId || !token || !workspaceId) return finish()
  let payload
  try { payload = JSON.parse(input) } catch { return finish() }
  const body = JSON.stringify({ executionId, token, workspaceId, agent, payload })
  const req = http.request({
    host: '127.0.0.1', port, path: '/hook', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, (res) => { res.resume(); res.on('end', finish) })
  req.setTimeout(1500, () => { req.destroy(); finish() })
  req.on('error', finish)
  req.end(body)
})
