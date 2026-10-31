#!/usr/bin/env node
'use strict'
/**
 * Release check for the provider protocol surface Thread mode relies on, run
 * against the installed `claude` and `codex`. No prompt is sent to either, so
 * it spends no inference quota.
 *
 * Claude: starts with the launch flags Thread uses (stream-json, host
 * permission prompts, --permission-mode acceptEdits, --disallowedTools for an
 * MCP tool), then checks that `initialize` and a cooperative `interrupt` with
 * `cancel_queued` are answered with success.
 *
 * Codex: starts `app-server` with a disabled MCP server carrying
 * `disabled_tools` (the override Thread uses for denied tools), then checks
 * `initialize`, `thread/start` in a read-only sandbox and `mcpServerStatus/list`.
 *
 *   node scripts/probe-providers.cjs [--provider claude|codex] [--json <file>]
 *
 * Exit code 0 = every required check passed for every probed provider.
 */
const { spawn } = require('node:child_process')
const { existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { delimiter, dirname, extname, join } = require('node:path')

const TIMEOUT_MS = 30_000
const argv = process.argv.slice(2)
const option = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined }
const only = option('--provider')
const jsonPath = option('--json')

/**
 * Spawns without a shell, as Thread does, so arguments reach the CLI exactly
 * (a shell would strip the quotes of JSON values). An npm shim for Codex on
 * Windows runs its JS entry; any other shim falls back to the shell.
 */
function resolveCommand(name, args) {
  if (process.platform !== 'win32') return { command: name, args, shell: false }
  const candidates = (process.env.PATH ?? process.env.Path ?? '').split(delimiter).flatMap(path => [join(path, `${name}.exe`), join(path, `${name}.cmd`)])
  const found = candidates.find(path => existsSync(path))
  if (found && extname(found).toLowerCase() === '.exe') return { command: found, args, shell: false }
  const entry = found && join(dirname(found), 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
  if (name === 'codex' && entry && existsSync(entry)) return { command: process.execPath, args: [entry, ...args], shell: false }
  return { command: name, args, shell: true }
}

/** Line-delimited JSON over a child's stdio; resolves `wait(predicate)` when a matching message arrives. */
function lineProcess(name, commandArgs, cwd) {
  const resolved = resolveCommand(name, commandArgs)
  const child = spawn(resolved.command, resolved.args, { cwd, shell: resolved.shell, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const messages = [], waiters = []
  let buffer = '', stderr = '', exited = null
  child.stdout.on('data', chunk => {
    buffer += chunk.toString()
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
      let message
      try { message = JSON.parse(line) } catch { continue }
      messages.push(message)
      for (const waiter of [...waiters]) if (waiter.match(message)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(message) }
    }
  })
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000) })
  child.on('exit', code => { exited = code; for (const waiter of waiters.splice(0)) waiter.reject(new Error(`exited with code ${code}: ${stderr.trim().split('\n').slice(-3).join(' ')}`)) })
  child.on('error', error => { for (const waiter of waiters.splice(0)) waiter.reject(error) })
  return {
    send: value => child.stdin.write(JSON.stringify(value) + '\n'),
    wait: (match, label) => new Promise((resolve, reject) => {
      const found = messages.find(match)
      if (found) return resolve(found)
      if (exited !== null) return reject(new Error(`exited with code ${exited}: ${stderr.trim().split('\n').slice(-3).join(' ')}`))
      const timer = setTimeout(() => reject(new Error(`no answer to ${label} within ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)
      waiters.push({ match, resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
    }),
    /** Ends the process and waits briefly for it to release its working folder. */
    stop: () => new Promise(resolve => {
      if (exited !== null) return resolve()
      const timer = setTimeout(resolve, 3000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
      try { child.stdin.end(); child.kill() } catch { resolve() }
    })
  }
}

/** A child on Windows may hold its folder a moment longer; a leftover empty temp folder is harmless. */
function removeFolder(path) {
  try { rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* left for the OS to clean */ }
}

async function check(results, name, required, run) {
  try {
    const detail = await run()
    results.push({ name, ok: true, required, ...(detail ? { detail } : {}) })
  } catch (error) {
    results.push({ name, ok: false, required, detail: error instanceof Error ? error.message : String(error) })
  }
}

async function probeClaude() {
  const results = []
  const cwd = mkdtempSync(join(tmpdir(), 'oxe-probe-claude-'))
  const claude = lineProcess('claude', ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--permission-mode', 'acceptEdits', '--permission-prompts', 'host', '--permission-prompt-tool', 'stdio', '--disallowedTools', 'mcp__oxespace-probe__nothing'], cwd)
  const control = id => message => message.type === 'control_response' && message.response && message.response.request_id === id
  let version
  try {
    await check(results, 'initialize (with acceptEdits and --disallowedTools)', true, async () => {
      claude.send({ type: 'control_request', request_id: 'initialize', request: { subtype: 'initialize' } })
      const answer = (await claude.wait(control('initialize'), 'initialize')).response
      if (answer.subtype !== 'success') throw new Error(`answered ${answer.subtype}: ${answer.error ?? ''}`)
      version = answer.response && answer.response.claude_code_version
      return version ? `claude ${version}` : undefined
    })
    if (results[0].ok) await check(results, 'interrupt{cancel_queued}', true, async () => {
      claude.send({ type: 'control_request', request_id: 'probe-interrupt', request: { subtype: 'interrupt', cancel_queued: true } })
      const answer = (await claude.wait(control('probe-interrupt'), 'interrupt')).response
      if (answer.subtype !== 'success') throw new Error(`answered ${answer.subtype}: ${answer.error ?? ''}`)
    })
  } finally {
    await claude.stop()
    removeFolder(cwd)
  }
  return { provider: 'claude', version, results }
}

async function probeCodex() {
  const results = []
  const cwd = mkdtempSync(join(tmpdir(), 'oxe-probe-codex-'))
  const codex = lineProcess('codex', ['-c', 'mcp_servers.oxespace-probe.command="node"', '-c', 'mcp_servers.oxespace-probe.enabled=false',
    '-c', 'mcp_servers.oxespace-probe.disabled_tools=["nothing"]', 'app-server', '--listen', 'stdio://'], cwd)
  let id = 0
  const request = async (method, params) => {
    const requestId = ++id
    codex.send({ id: requestId, method, params })
    const answer = await codex.wait(message => message.id === requestId && !message.method, method)
    if (answer.error) throw new Error(`${method}: ${answer.error.message ?? JSON.stringify(answer.error)}`)
    return answer.result ?? {}
  }
  let version, threadId
  try {
    await check(results, 'initialize (with disabled_tools override)', true, async () => {
      const handshake = await request('initialize', { clientInfo: { name: 'oxespace-probe', title: 'OXESpace probe', version: '0' }, capabilities: { experimentalApi: true } })
      version = (handshake.serverInfo && handshake.serverInfo.version) || handshake.userAgent
      codex.send({ method: 'initialized' })
      return version ? String(version).slice(0, 80) : undefined
    })
    if (results[0].ok) await check(results, 'thread/start (read-only sandbox)', true, async () => {
      const response = await request('thread/start', { cwd, modelProvider: 'openai', approvalPolicy: 'on-request', sandbox: 'read-only' })
      threadId = response.thread && response.thread.id
      if (!threadId) throw new Error('no thread id returned')
    })
    if (threadId) await check(results, 'mcpServerStatus/list (starts your configured MCP servers; informational)', false, async () => {
      const response = await request('mcpServerStatus/list', { limit: 100, threadId })
      if (!Array.isArray(response.data)) throw new Error('no server list returned')
      return `${response.data.length} servers`
    })
    if (results[0].ok) await check(results, 'account/rateLimits/read', false, async () => { await request('account/rateLimits/read', {}) })
  } finally {
    await codex.stop()
    removeFolder(cwd)
  }
  return { provider: 'codex', version, results }
}

;(async () => {
  const reports = []
  if (!only || only === 'claude') reports.push(await probeClaude())
  if (!only || only === 'codex') reports.push(await probeCodex())
  let failed = false
  for (const report of reports) {
    console.log(`${report.provider}${report.version ? ` (${report.version})` : ''}`)
    for (const result of report.results) {
      if (!result.ok && result.required) failed = true
      console.log(`  ${result.ok ? 'OK  ' : result.required ? 'FAIL' : 'WARN'} ${result.name}${result.detail ? ` — ${result.detail}` : ''}`)
    }
  }
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ checkedAt: new Date().toISOString(), reports }, null, 2) + '\n')
  process.exit(failed ? 1 : 0)
})()
