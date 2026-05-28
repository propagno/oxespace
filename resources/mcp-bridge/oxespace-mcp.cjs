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

const PORT = process.env.OXESPACE_MCP_PORT
const TOKEN = process.env.OXESPACE_MCP_TOKEN
const WSID = process.env.OXESPACE_WORKSPACE_ID || ''
const PROTOCOL_VERSION = '2025-06-18'
const SERVER_NAME = 'oxespace'
const SERVER_VERSION = '0.1.0'

if (!PORT || !TOKEN) {
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

function err(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } })
}

/** POST a JSON-RPC request to the local OXESpace RPC server. */
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    const req = http.request(
      {
        host: '127.0.0.1',
        port: Number(PORT),
        path: '/rpc',
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + TOKEN,
          'X-OXE-Workspace-Id': WSID,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let chunks = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { chunks += c })
        res.on('end', () => {
          if (res.statusCode === 401) {
            reject({ code: -32003, message: 'OXESpace auth rejected — restart the app to refresh the token' })
            return
          }
          if (!res.statusCode || res.statusCode >= 500) {
            reject({ code: -32603, message: 'OXESpace main not reachable (status ' + res.statusCode + ')' })
            return
          }
          try {
            const parsed = JSON.parse(chunks)
            if (parsed && parsed.error) {
              reject(parsed.error)
            } else {
              resolve(parsed && parsed.result)
            }
          } catch (e) {
            reject({ code: -32603, message: 'OXESpace main returned invalid JSON', data: chunks.slice(0, 200) })
          }
        })
      }
    )
    req.on('error', (e) => {
      reject({ code: -32603, message: 'OXESpace main not reachable: ' + e.message })
    })
    req.write(body)
    req.end()
  })
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
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
    })
    return
  }

  if (msg.method === 'ping') {
    ok(msg.id, {})
    return
  }

  if (msg.method === 'tools/list') {
    try {
      const result = await rpc('tools/list', undefined)
      ok(msg.id, result || { tools: [] })
    } catch (e) {
      err(msg.id, e.code || -32603, e.message || 'tools/list failed', e.data)
    }
    return
  }

  if (msg.method === 'tools/call') {
    try {
      const result = await rpc('tools/call', msg.params)
      ok(msg.id, result || { content: [] })
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
