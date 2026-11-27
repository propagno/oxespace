#!/usr/bin/env node
// OXESpace local cross-provider CLI (`oxe`).
// Speaks exclusively to the localhost RPC server on 127.0.0.1 using credentials
// injected into the pane environment (never command-line arguments).
'use strict'

const http = require('node:http')
const { randomUUID } = require('node:crypto')

const FORBIDDEN_TOKEN_FLAGS = new Set([
  '--token',
  '--mcp-token',
  '--execution-token',
  '--bearer',
  '--auth-token'
])

function fail(message, code = 1) {
  process.stderr.write(`oxe: ${message}\n`)
  process.exit(code)
}

function parseFlags(tokens) {
  const positionals = []
  const flags = {}
  for (let i = 0; i < tokens.length; i += 1) {
    const raw = tokens[i]
    const eqIndex = raw.indexOf('=')
    const flagName = eqIndex >= 0 ? raw.slice(0, eqIndex) : raw
    if (FORBIDDEN_TOKEN_FLAGS.has(flagName)) {
      throw new Error('Security refusal: tokens must come from OXESPACE_MCP_TOKEN / OXESPACE_EXECUTION_TOKEN environment variables, never command-line arguments.')
    }
    if (raw === '--json' || raw === '--wait' || raw === '--include-acked') {
      flags[raw.slice(2)] = true
      continue
    }
    if (raw.startsWith('--')) {
      const key = flagName.slice(2)
      if (eqIndex >= 0) {
        flags[key] = raw.slice(eqIndex + 1)
      } else {
        const next = tokens[i + 1]
        if (next === undefined || next.startsWith('--')) {
          flags[key] = true
        } else {
          flags[key] = next
          i += 1
        }
      }
      continue
    }
    positionals.push(raw)
  }
  return { positionals, flags }
}

function parsePayload(raw) {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') return raw
  const trimmed = raw.trim()
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return JSON.parse(trimmed) } catch { /* treat as string */ }
  }
  return raw
}

function parseOxeCliArgs(argv) {
  const { positionals, flags } = parseFlags(argv)
  const [group, subcommand, ...rest] = positionals
  const jsonOutput = Boolean(flags.json)

  if (!group || group === 'help' || flags.help) {
    return {
      help: true,
      jsonOutput,
      usage: [
        'Usage: oxe <group> <command> [options]',
        '  oxe agents list [--workspace <id>] [--json]',
        '  oxe agents read <paneId> [--mode auto|screen|tail] [--max-chars <n>] [--workspace <id>] [--json]',
        '  oxe agents wait <paneId> [--until idle,done,blocked] [--timeout <ms>] [--workspace <id>] [--json]',
        '  oxe agents start --provider <p> [--name <n>] [--model <m>] [--worktree <path>] [--git-ref <ref>] [--json]',
        '  oxe agents prompt <paneId> <text> [--wait] [--timeout <ms>] [--workspace <id>] [--json]',
        '  oxe agents interrupt <paneId> [--workspace <id>] [--json]',
        '  oxe agents close <paneId> [--json]',
        '  oxe bus send --to <paneId> --topic <t> [--payload <json|text>] [--correlation-id <id>] [--reply-to <id>] [--ttl <ms>] [--workspace <id>] [--json]',
        '  oxe bus inbox [--topic <t>] [--correlation-id <id>] [--include-acked] [--limit <n>] [--json]',
        '  oxe bus ack <messageId> [--json]',
        '  oxe bus watch [--reply-to <id>] [--correlation-id <id>] [--topic <t>] [--timeout <ms>] [--json]'
      ].join('\n')
    }
  }

  if (group === 'agents') {
    if (subcommand === 'list') {
      return {
        tool: 'oxespace_agents',
        args: { action: 'list', ...(flags.workspace ? { workspaceId: String(flags.workspace) } : {}) },
        jsonOutput
      }
    }
    if (subcommand === 'read') {
      const paneId = rest[0] || (flags.pane ? String(flags.pane) : '')
      if (!paneId) throw new Error('oxe agents read requires <paneId>.')
      return {
        tool: 'oxespace_agents',
        args: {
          action: 'read',
          paneId,
          ...(flags.mode ? { mode: String(flags.mode) } : {}),
          ...(flags['max-chars'] ? { maxChars: Number(flags['max-chars']) } : {}),
          ...(flags.workspace ? { workspaceId: String(flags.workspace) } : {})
        },
        jsonOutput
      }
    }
    if (subcommand === 'wait') {
      const paneId = rest[0] || (flags.pane ? String(flags.pane) : '')
      if (!paneId) throw new Error('oxe agents wait requires <paneId>.')
      const until = flags.until ? String(flags.until).split(',').map((s) => s.trim()).filter(Boolean) : undefined
      return {
        tool: 'oxespace_agents',
        args: {
          action: 'wait',
          paneId,
          ...(until ? { until } : {}),
          ...(flags.timeout ? { timeoutMs: Number(flags.timeout) } : {}),
          ...(flags.workspace ? { workspaceId: String(flags.workspace) } : {})
        },
        jsonOutput
      }
    }
    if (subcommand === 'start') {
      const agent = flags.provider || flags.agent || rest[0]
      if (!agent) throw new Error('oxe agents start requires --provider <name>.')
      return {
        tool: 'oxespace_agents_change',
        args: {
          action: 'start',
          agent: String(agent),
          ...(flags.name ? { name: String(flags.name) } : {}),
          ...(flags.model ? { model: String(flags.model) } : {}),
          ...(flags.worktree ? { worktree: String(flags.worktree) } : {}),
          ...(flags['git-ref'] ? { gitRef: String(flags['git-ref']) } : {})
        },
        jsonOutput
      }
    }
    if (subcommand === 'prompt') {
      const paneId = rest[0] || (flags.pane ? String(flags.pane) : '')
      const text = flags.text ? String(flags.text) : rest.slice(1).join(' ')
      if (!paneId || !text) throw new Error('oxe agents prompt requires <paneId> <text>.')
      return {
        tool: 'oxespace_agents_change',
        args: {
          action: 'prompt',
          paneId,
          text,
          ...(flags.wait ? { wait: true } : {}),
          ...(flags.timeout ? { timeoutMs: Number(flags.timeout) } : {}),
          ...(flags.workspace ? { workspaceId: String(flags.workspace) } : {})
        },
        jsonOutput
      }
    }
    if (subcommand === 'interrupt') {
      const paneId = rest[0] || (flags.pane ? String(flags.pane) : '')
      if (!paneId) throw new Error('oxe agents interrupt requires <paneId>.')
      return {
        tool: 'oxespace_agents_change',
        args: {
          action: 'interrupt',
          paneId,
          ...(flags.workspace ? { workspaceId: String(flags.workspace) } : {})
        },
        jsonOutput
      }
    }
    if (subcommand === 'close') {
      const paneId = rest[0] || (flags.pane ? String(flags.pane) : '')
      if (!paneId) throw new Error('oxe agents close requires <paneId>.')
      return {
        tool: 'oxespace_agents_change',
        args: { action: 'close_pane', paneId },
        jsonOutput
      }
    }
    throw new Error(`Unknown agents subcommand "${subcommand || ''}".`)
  }

  if (group === 'bus') {
    if (subcommand === 'send') {
      const toPaneId = flags.to || rest[0]
      const topic = flags.topic || rest[1]
      if (!toPaneId || !topic) throw new Error('oxe bus send requires --to <paneId> --topic <topic>.')
      const attachments = flags.attachments ? String(flags.attachments).split(',').map((s) => s.trim()).filter(Boolean) : undefined
      return {
        tool: 'oxespace_agents_change',
        args: {
          action: 'bus_send',
          toPaneId: String(toPaneId),
          topic: String(topic),
          ...(flags.payload !== undefined ? { payload: parsePayload(flags.payload) } : {}),
          ...(flags['correlation-id'] ? { correlationId: String(flags['correlation-id']) } : {}),
          ...(flags['reply-to'] ? { replyToId: String(flags['reply-to']) } : {}),
          ...(flags.ttl ? { ttlMs: Number(flags.ttl) } : {}),
          ...(attachments ? { attachments } : {}),
          ...(flags.workspace ? { workspaceId: String(flags.workspace) } : {})
        },
        jsonOutput
      }
    }
    if (subcommand === 'inbox') {
      return {
        tool: 'oxespace_agents',
        args: {
          action: 'bus_inbox',
          ...(flags.topic ? { topic: String(flags.topic) } : {}),
          ...(flags['correlation-id'] ? { correlationId: String(flags['correlation-id']) } : {}),
          ...(flags['include-acked'] ? { includeAcked: true } : {}),
          ...(flags.limit ? { limit: Number(flags.limit) } : {})
        },
        jsonOutput
      }
    }
    if (subcommand === 'ack') {
      const messageId = rest[0] || (flags.id ? String(flags.id) : '')
      if (!messageId) throw new Error('oxe bus ack requires <messageId>.')
      return {
        tool: 'oxespace_agents_change',
        args: { action: 'bus_ack', messageId },
        jsonOutput
      }
    }
    if (subcommand === 'watch' || subcommand === 'wait') {
      return {
        tool: 'oxespace_agents',
        args: {
          action: 'bus_wait',
          ...(flags['reply-to'] ? { replyToId: String(flags['reply-to']) } : {}),
          ...(flags['correlation-id'] ? { correlationId: String(flags['correlation-id']) } : {}),
          ...(flags.topic ? { topic: String(flags.topic) } : {}),
          ...(flags.timeout ? { timeoutMs: Number(flags.timeout) } : {})
        },
        jsonOutput
      }
    }
    throw new Error(`Unknown bus subcommand "${subcommand || ''}".`)
  }

  throw new Error(`Unknown command group "${group}". Run "oxe help".`)
}

function callLocalRpc(tool, args, env) {
  const port = Number(env.OXESPACE_MCP_PORT)
  const token = env.OXESPACE_MCP_TOKEN
  if (!Number.isInteger(port) || port <= 0 || !token) {
    return Promise.reject(new Error('Missing OXESPACE_MCP_PORT or OXESPACE_MCP_TOKEN in environment. Run inside an OXESpace terminal.'))
  }
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'tools/call',
    params: { name: tool, arguments: args }
  })
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body).toString(),
    Authorization: `Bearer ${token}`,
    'X-OXE-Request-Id': randomUUID()
  }
  if (env.OXESPACE_WORKSPACE_ID) headers['X-OXE-Workspace-Id'] = env.OXESPACE_WORKSPACE_ID
  if (env.OXESPACE_EXECUTION_ID) headers['X-OXE-Execution-Id'] = env.OXESPACE_EXECUTION_ID
  if (env.OXESPACE_EXECUTION_TOKEN) headers['X-OXE-Execution-Token'] = env.OXESPACE_EXECUTION_TOKEN

  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/rpc', method: 'POST', headers, timeout: 110_000 },
      (res) => {
        let chunks = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { chunks += chunk })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`RPC server returned HTTP ${res.statusCode}`))
            return
          }
          try {
            resolve(JSON.parse(chunks))
          } catch {
            reject(new Error('Invalid JSON response from OXESpace RPC server'))
          }
        })
      }
    )
    req.on('error', (err) => reject(new Error(`Cannot reach OXESpace RPC server on 127.0.0.1:${port}: ${err.message}`)))
    req.on('timeout', () => { req.destroy(new Error('OXESpace RPC request timed out')) })
    req.end(body)
  })
}

function extractEnvelope(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return null }
}

async function runOxeCli(argv = process.argv.slice(2), env = process.env) {
  const parsed = parseOxeCliArgs(argv)
  if (parsed.help) {
    process.stdout.write(`${parsed.usage}\n`)
    return 0
  }
  const rpc = await callLocalRpc(parsed.tool, parsed.args, env)
  if (rpc.error) {
    process.stderr.write(`oxe: ${rpc.error.message || 'RPC error'}\n`)
    return 1
  }
  const contentText = rpc.result && Array.isArray(rpc.result.content) && rpc.result.content[0] ? String(rpc.result.content[0].text || '') : ''
  const envelope = extractEnvelope(contentText)
  if (rpc.result?.isError || (envelope && envelope.ok === false)) {
    const msg = envelope?.message || contentText || 'Command failed'
    process.stderr.write(`oxe: ${msg}\n`)
    return 1
  }
  if (parsed.jsonOutput) {
    const out = envelope && 'result' in envelope ? envelope.result : (envelope ?? contentText)
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
    return 0
  }
  const out = envelope && 'result' in envelope ? envelope.result : contentText
  process.stdout.write(`${typeof out === 'string' ? out : JSON.stringify(out, null, 2)}\n`)
  return 0
}

if (require.main === module) {
  runOxeCli().then((code) => { process.exit(code) }).catch((err) => {
    fail(err instanceof Error ? err.message : String(err), 1)
  })
}

module.exports = { parseOxeCliArgs, runOxeCli }
