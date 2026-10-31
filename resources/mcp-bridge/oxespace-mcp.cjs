#!/usr/bin/env node
// OXESpace MCP bridge — spawned by agent CLIs (Claude Code, Copilot, Codex)
// when they parse `.mcp.json`. Speaks MCP JSON-RPC 2.0 over stdio outward,
// forwards every `tools/list` / `tools/call` to a localhost HTTP endpoint
// running inside OXESpace main. Holds zero business logic — pure forwarder.
//
// Env contract (set by mcp-sync.service.ts when writing per-workspace .mcp.json):
//   OXESPACE_MCP_PORT     – TCP port of the local RPC server (127.0.0.1)
//   OXESPACE_MCP_TOKEN    – Bearer token for /rpc (constant-time validated)
//   OXESPACE_WORKSPACE_ID – workspace UUID scope (per .mcp.json)
//
// MCP protocol version: 2025-06-18 (same as the in-app McpManager).

'use strict'

const http = require('node:http')
const { randomUUID } = require('node:crypto')

const PORT = process.env.OXESPACE_MCP_PORT
const TOKEN = process.env.OXESPACE_MCP_TOKEN
const WSID = process.env.OXESPACE_WORKSPACE_ID || ''
const MEMORY_RUN = process.env.OXESPACE_MEMORY_RUN_ID || ''
const OPTIONAL_MEMORY = process.argv.includes('--optional-memory')
// The workspace's .mcp.json entry, started by an agent that OXESpace launched with its own bridge: list nothing, so the
// agent pays for the OXESpace tools once (bridge-plan.ts, PROJECT_ENTRY_FLAG and PANE_BRIDGE_ENV).
const STEPS_ASIDE = process.argv.includes('--project-entry') && process.env.OXESPACE_PANE_BRIDGE === '1'
const allowIndex = process.argv.indexOf('--allowed-tools')
const allowedTools = allowIndex < 0 ? null : new Set(JSON.parse(process.argv[allowIndex + 1]))
// Groups this session may turn on with oxespace_tools_enable: { group: [tool, ...] } (B7.2). Off groups are never here.
const enableIndex = process.argv.indexOf('--enableable-groups')
const enableable = enableIndex < 0 || !allowedTools ? null : JSON.parse(process.argv[enableIndex + 1])
const enabledGroups = new Set()
const PROTOCOL_VERSION = '2025-06-18'
const SERVER_NAME = 'oxespace'
const SERVER_VERSION = '0.1.0'
const MAX_READ_RETRIES = 2
const READ_ONLY_TOOLS = new Set([
  'oxespace_ping', 'oxespace_list_workspaces', 'oxespace_list_panes', 'oxespace_list_scripts',
  'oxespace_list_background_jobs', 'oxespace_get_job_output', 'oxespace_list_worktrees',
  'oxespace_capabilities', 'oxespace_execution_context', 'oxespace_semantic_search',
  'oxespace_hybrid_explore', 'oxespace_project_context', 'oxespace_quality_check',
  'oxespace_memory_search', 'oxespace_memory_sessions', 'oxespace_memory_handoffs',
  'oxespace_memory_diagnostics', 'oxespace_delegation_status', 'oxespace_delegation_result',
  'oxespace_delegation_inbox', 'oxespace_delegation_targets', 'oxespace_delegation_preflight',
  'oxespace_documentation_get', 'oxespace_documentation_list', 'oxespace_git',
  'oxespace_github', 'oxespace_threads', 'oxespace_tasks', 'oxespace_skills', 'oxespace_automations', 'oxespace_linear',
  'oxespace_terminal', 'oxespace_mcp_servers', 'oxespace_search', 'oxespace_usage', 'oxespace_settings', 'oxespace_integration',
  'oxespace_diagnostics'
])

if ((!PORT || !TOKEN) && !OPTIONAL_MEMORY) {
  process.stderr.write('[oxespace-mcp] missing OXESPACE_MCP_PORT/TOKEN env — is OXESpace running?\n')
  process.exit(2)
}

/** Write a JSON-RPC envelope to stdout, newline-delimited. */
function send(envelope) {
  process.stdout.write(JSON.stringify(envelope) + '\n')
}

function ok(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

const textResult = (data, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(data) }], ...(isError ? { isError: true } : {}) })

/**
 * oxespace_tools_enable, answered here: the bridge owns this session's tool list. Turning a group on adds its tools and
 * tells the client the list changed; policy and each tool's own level still apply when a tool is called.
 */
function enableGroup(args) {
  const group = args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length === 1 ? args.group : undefined
  if (typeof group !== 'string') return textResult({ status: 'error', code: 'INVALID_ARGUMENTS', message: 'Pass { "group": "<name>" }.' }, true)
  if (group === 'team' || group === 'worker') return textResult({ status: 'error', code: 'ROLE_GROUP', message: `The ${group} tools follow the conversation's role and cannot be turned on.` }, true)
  const tools = enableable && Object.prototype.hasOwnProperty.call(enableable, group) ? enableable[group] : null
  if (!tools) return textResult({ status: 'error', code: 'GROUP_UNAVAILABLE', message: `The ${group} group is already offered, turned off for this project, or unknown. oxespace_capabilities lists the groups.` }, true)
  const already = enabledGroups.has(group)
  enabledGroups.add(group)
  for (const tool of tools) allowedTools.add(tool)
  if (!already) send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
  return textResult({ status: 'ok', group, tools, note: 'If these tools do not appear in your tool list, this client did not reload it: ask the person to start a new conversation, or to set the group to always in Settings > Tools.' })
}

/** Adds this session's groups to oxespace_capabilities: which were turned on here and which still can be. */
function withSessionGroups(result) {
  if (!enableable || !result || !Array.isArray(result.content) || !result.content[0] || typeof result.content[0].text !== 'string') return result
  try {
    const body = JSON.parse(result.content[0].text)
    if (!body || typeof body !== 'object' || !body.data || typeof body.data !== 'object') return result
    body.data.sessionToolGroups = { enabled: [...enabledGroups], available: Object.keys(enableable).filter(group => !enabledGroups.has(group)), enableWith: 'oxespace_tools_enable' }
    return { ...result, content: [{ ...result.content[0], text: JSON.stringify(body) }, ...result.content.slice(1)] }
  } catch {
    return result
  }
}

function err(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } })
}

/** One POST attempt to the local OXESpace RPC server. */
function rpcOnce(method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID()
    const body = JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      callback(value)
    }
    const deadline = setTimeout(() => req.destroy(Object.assign(new Error(`OXESpace RPC deadline exceeded (${timeoutMs} ms)`), { code: 'ETIMEDOUT' })), timeoutMs)
    const req = http.request(
      {
        host: '127.0.0.1',
        port: Number(PORT),
        path: '/rpc',
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + TOKEN,
          'X-OXE-Workspace-Id': WSID,
          'X-OXE-Memory-Run-Id': MEMORY_RUN,
          'X-OXE-Execution-Id': process.env.OXESPACE_EXECUTION_ID || '',
          'X-OXE-Execution-Token': process.env.OXESPACE_EXECUTION_TOKEN || '',
          'X-OXE-Request-Id': requestId,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let chunks = ''
        res.setEncoding('utf8')
        res.on('error', (e) => finish(reject, { code: -32603, message: 'OXESpace main response failed: ' + e.message, data: { category: 'infrastructure', retryable: true, requestId } }))
        res.on('data', (c) => { chunks += c })
        res.on('end', () => {
          if (res.statusCode === 401) {
            finish(reject, { code: -32003, message: 'OXESpace auth rejected — restart the app to refresh the token' })
            return
          }
          if (!res.statusCode || res.statusCode >= 500) {
            finish(reject, { code: -32603, message: 'OXESpace main unavailable (status ' + res.statusCode + ')', data: { category: 'infrastructure', retryable: true, requestId } })
            return
          }
          try {
            const parsed = JSON.parse(chunks)
            if (parsed && parsed.error) {
              finish(reject, parsed.error)
            } else {
              finish(resolve, parsed && parsed.result)
            }
          } catch (e) {
            finish(reject, { code: -32603, message: 'OXESpace main returned invalid JSON', data: { category: 'infrastructure', requestId } })
          }
        })
      }
    )
    req.on('error', (e) => {
      finish(reject, { code: -32603, message: 'OXESpace main unavailable: ' + e.message, data: { category: 'infrastructure', retryable: true, requestId } })
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('request timed out')))
    req.write(body)
    req.end()
  })
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

/** Retry transport failures only when repeating the operation cannot create side effects. */
async function rpc(method, params, retryable) {
  const toolName = method === 'tools/call' ? params && params.name : ''
  const timeoutMs = method === 'tools/list' || toolName === 'oxespace_capabilities' || toolName === 'oxespace_open_web_preview' ? 10000 : retryable ? 20000 : 120000
  const attempts = retryable && toolName !== 'oxespace_capabilities' ? MAX_READ_RETRIES + 1 : 1
  let last
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await rpcOnce(method, params, timeoutMs) }
    catch (error) {
      last = error
      if (!retryable || error.code !== -32603 || attempt === attempts) break
      await wait(attempt === 1 ? 150 : 400)
    }
  }
  if (retryable && last && last.code === -32603) {
    throw { ...last, message: `OXESpace main unavailable after ${attempts} attempts: ${last.message}`, data: { ...(last.data || {}), category: 'infrastructure', retryable: true, attempts } }
  }
  if (!retryable && last && last.code === -32603) {
    throw { ...last, data: { ...(last.data || {}), category: 'infrastructure', retryable: false, delivery: 'unknown', attempts: 1 } }
  }
  throw last
}

/** Handle one parsed JSON-RPC request from the agent CLI. */
async function dispatch(msg) {
  // Notifications carry no id and never get a response.
  if (msg.id === undefined || msg.id === null) {
    // notifications/initialized is the most common; everything else: ignore.
    return
  }

  if (msg.method === 'initialize') {
    ok(msg.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: enableable ? { listChanged: true } : {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
    })
    return
  }

  if (msg.method === 'ping') {
    ok(msg.id, {})
    return
  }

  if (msg.method === 'tools/list') {
    if (STEPS_ASIDE) return ok(msg.id, { tools: [] })
    if (OPTIONAL_MEMORY && (!PORT || !TOKEN || !MEMORY_RUN)) return ok(msg.id, { tools: [] })
    try {
      const result = await rpc('tools/list', undefined, true)
      if (allowedTools && result) result.tools = (result.tools || []).filter(tool => allowedTools.has(tool.name))
      ok(msg.id, result || { tools: [] })
    } catch (e) {
      err(msg.id, e.code || -32603, e.message || 'tools/list failed', e.data)
    }
    return
  }

  if (msg.method === 'tools/call') {
    if (STEPS_ASIDE) return err(msg.id, -32602, 'OXESpace started this agent with its own OXESpace server (oxespace-delegation); use its tools')
    if (allowedTools && !allowedTools.has(msg.params && msg.params.name)) return err(msg.id, -32602, 'This tool is not available in Thread')
    if (OPTIONAL_MEMORY && (!PORT || !TOKEN || !MEMORY_RUN)) return err(msg.id, -32602, 'Memory is not bound to an OXESpace execution')
    if (enableable && msg.params.name === 'oxespace_tools_enable') return ok(msg.id, enableGroup(msg.params.arguments))
    try {
      const result = await rpc('tools/call', msg.params, READ_ONLY_TOOLS.has(msg.params && msg.params.name))
      ok(msg.id, msg.params && msg.params.name === 'oxespace_capabilities' ?withSessionGroups(result || { content: [] }) : result || { content: [] })
    } catch (e) {
      err(msg.id, e.code || -32603, e.message || 'tools/call failed', e.data)
    }
    return
  }

  err(msg.id, -32601, 'Method not found: ' + msg.method)
}

// Line-delimited JSON parsing over stdin. MCP framing per the spec.
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let nl
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    if (!line) continue
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      // Malformed line — surface as a parse error with null id.
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      continue
    }
    // Fire-and-forget; dispatch handles its own errors.
    void dispatch(parsed)
  }
})

process.stdin.on('end', () => {
  process.exit(0)
})
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
