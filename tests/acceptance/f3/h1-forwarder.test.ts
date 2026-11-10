// Frozen acceptance test for 1.5.0 A58 (OXE program, phase F3, item H1): the hook forwarder never loses an event to a
// large output. Written by the planner; the executor must not edit it. It runs the real forwarder script against a local
// HTTP server in the test; no app, no agent, the live app's OXESPACE_* variables stripped.
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { NODE_EXECUTABLE } from '../../helpers/node-child'

const SCRIPT = join(process.cwd(), 'resources', 'agent-hooks', 'oxespace-status-hook.cjs')
const MIB = 1024 * 1024
let server: Server | null = null
afterEach(() => { server?.close(); server = null })

interface Received { bytes: number; delivery: { agent: string; payload: Record<string, unknown> } }

/** Runs the forwarder with `input` on stdin and returns what the app's endpoint received, plus the script's output. */
async function forward(input: string, agent = 'claude-code'): Promise<{ received: Received[]; stdout: string; code: number | null }> {
  const received: Received[] = []
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      received.push({ bytes: body.length, delivery: JSON.parse(body.toString('utf8')) as Received['delivery'] })
      res.statusCode = 204; res.end()
    })
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const port = (server!.address() as AddressInfo).port
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OXESPACE_')))
  Object.assign(env, { OXESPACE_AGENT_HOOK_PORT: String(port), OXESPACE_EXECUTION_ID: 'exec-1', OXESPACE_EXECUTION_TOKEN: 'token-1', OXESPACE_WORKSPACE_ID: 'ws-1' })
  const child = spawn(NODE_EXECUTABLE, [SCRIPT, agent === 'codex' ? 'codex' : 'claude'], { env, stdio: ['pipe', 'pipe', 'ignore'] })
  let stdout = ''
  child.stdout.on('data', chunk => { stdout += String(chunk) })
  const exit = new Promise<number | null>(resolve => child.on('exit', resolve))
  child.stdin.end(input)
  const code = await exit
  return { received, stdout, code }
}

const bash = (stdout: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'toolu_big', session_id: 'sess-1', cwd: '/repo',
  tool_input: { command: 'curl -s https://api.example.com/v1/export' },
  tool_response: { stdout, stderr: 'warn: slow', interrupted: false },
  ...extra
})

describe('A58 · the hook forwarder keeps events with large outputs', () => {
  test('A58: a Bash call with 5 MiB of output still arrives, cut and marked, with its status fields', async () => {
    const big = 'x'.repeat(5 * MIB)
    const { received, stdout, code } = await forward(bash(big))
    expect(code).toBe(0)
    expect(stdout.trim()).toBe('{}')
    expect(received).toHaveLength(1)
    expect(received[0].bytes).toBeLessThan(MIB)
    const payload = received[0].delivery.payload
    expect(payload).toMatchObject({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'toolu_big', session_id: 'sess-1' })
    expect((payload.tool_input as { command: string }).command).toBe('curl -s https://api.example.com/v1/export')
    const response = payload.tool_response as Record<string, unknown>
    expect(response).toMatchObject({ truncated: true, keptBytes: 4096, totalBytes: 5 * MIB, interrupted: false, stderrHead: 'warn: slow' })
    expect(String(response.stdoutHead)).toHaveLength(4096)
    expect(response).not.toHaveProperty('stdout')
  })

  test('A58: a command longer than 8 KiB is cut to 8 KiB', async () => {
    const { received } = await forward(bash('ok', { tool_input: { command: `echo ${'a'.repeat(20_000)}` } }))
    expect(((received[0].delivery.payload.tool_input as { command: string }).command).length).toBeLessThanOrEqual(8192)
  })

  test('A58: past the 8 MiB read limit, the event still arrives with what identifies it, marked, with no totalBytes', async () => {
    const { received, code } = await forward(bash('y'.repeat(9 * MIB)))
    expect(code).toBe(0)
    expect(received).toHaveLength(1)
    expect(received[0].bytes).toBeLessThan(MIB)
    const payload = received[0].delivery.payload
    expect(payload).toMatchObject({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'toolu_big', session_id: 'sess-1' })
    expect(payload.tool_response).toMatchObject({ truncated: true, keptBytes: 0 })
    expect(payload.tool_response).not.toHaveProperty('totalBytes')
  })

  test('A58: a small event passes through unchanged', async () => {
    const small = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'toolu_small', session_id: 'sess-1', tool_input: { command: 'ls' } }
    const { received } = await forward(JSON.stringify(small))
    expect(received[0].delivery.payload).toEqual(small)
    expect(received[0].delivery.agent).toBe('claude-code')
  })
})
