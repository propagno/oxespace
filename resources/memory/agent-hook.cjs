#!/usr/bin/env node
'use strict'
// Metadata only goes to OXESpace. The official native hook owns payload capture,
// sanitization, spool and consolidation. Never read or persist terminal output.
const { readFileSync } = require('node:fs')
const { spawn } = require('node:child_process')
const http = require('node:http')
const event = process.argv[2]
const agent = process.argv[3]
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { input += chunk; if (input.length > 1024 * 1024) process.exit(0) })
process.stdin.on('end', () => { main().catch(() => process.stdout.write('{}\n')) })
async function main() {
  const configPath = process.env.OXESPACE_MEMORY_RUN
  if (!configPath) return process.stdout.write('{}\n') // Hooks outside OXESpace are inert.
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const payload = JSON.parse(input)
  const sessionId = payload.session_id || payload.sessionId || payload.thread_id
  const cwd = payload.cwd
  if (typeof sessionId !== 'string' || typeof cwd !== 'string') return process.stdout.write('{}\n')
  const decision = await rpc(config, { runId: config.runId, agent, sessionId, cwd, event })
  if (!decision || !decision.allowed) return process.stdout.write('{}\n')
  // Disabling automatic context must not consume a single-use native handoff.
  // Later substantive events create the upstream session through normal admission.
  const capture = decision.capture && (event !== 'session-start' || decision.context)
  let response = {}
  if (capture) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('AI_MEMORY_')))
    const output = await new Promise(resolve => {
      const child = spawn(config.executable, ['--data-dir', config.dataDir, '--config', config.configPath, 'hook', '--event', event, '--agent', agent,
        '--server-url', config.url, '--capture-mode', 'allowlist', ...(agent === 'claude-code' ? ['--capture-assistant'] : [])], { env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'] })
      let out = ''
      child.stdout.on('data', chunk => { if (out.length < 32768) out += chunk.toString() })
      child.stdin.on('error', () => {})
      child.stdin.end(input)
      const timer = setTimeout(() => { child.kill(); resolve('') }, 7500)
      child.on('error', () => { clearTimeout(timer); resolve('') })
      child.on('close', () => { clearTimeout(timer); resolve(out) })
    })
    try { response = JSON.parse(output) } catch { /* Fail open, without showing payloads. */ }
  }
  if (event === 'session-start' && decision.context) {
    const native = response.hookSpecificOutput?.additionalContext || ''
    response = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: [decision.brief || '', native].filter(Boolean).join('\n\n').slice(0, 8000) } }
  }
  process.stdout.write(JSON.stringify(response) + '\n')
}
function rpc(config, metadata) {
  return new Promise(resolve => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'memory/session', params: metadata })
    const req = http.request({ host: '127.0.0.1', port: config.port, path: '/rpc', method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let text = ''
      res.on('data', chunk => { if (text.length < 32768) text += chunk.toString() })
      res.on('end', () => { try { resolve(JSON.parse(text).result) } catch { resolve(null) } })
    })
    req.setTimeout(4000, () => { req.destroy(); resolve(null) })
    req.on('error', () => resolve(null))
    req.end(body)
  })
}
