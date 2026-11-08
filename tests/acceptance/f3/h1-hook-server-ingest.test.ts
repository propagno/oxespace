// Frozen acceptance test for 1.5.0 A59 (OXE program, phase F3, item H1): the hook server hands every authenticated
// event to the HTTP audit after mapping its state, and a failing audit never breaks the pane status. Written by the
// planner; the executor must not edit it. A local server on 127.0.0.1 only.
import { request } from 'node:http'
import { afterEach, describe, expect, test } from 'vitest'
import { AgentHookServer } from '../../../electron/main/services/agent-hooks/server'
import type { AgentHookStatusEvent } from '../../../shared/types/agent-hooks'

let server: AgentHookServer | null = null
afterEach(() => { server?.stop(); server = null })

function post(port: number, body: unknown): Promise<number> {
  const text = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/hook', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)) })
    req.on('error', reject)
    req.end(text)
  })
}
const settle = () => new Promise(resolve => setTimeout(resolve, 50))
const delivery = (payload: Record<string, unknown>) => ({ executionId: 'exec-1', token: 'token-1', workspaceId: 'ws-1', agent: 'claude-code', payload })
const authenticate = (input: { executionId: string; token: string }) => (input.executionId === 'exec-1' && input.token === 'token-1' ? { paneId: 'p1', workspaceId: 'ws-1' } : null)

describe('A59 · the hook server feeds the HTTP audit', () => {
  test('A59: an authenticated event reaches httpAudit.ingest with the pane, workspace, agent, session and record', async () => {
    const ingested: unknown[] = []
    server = new AgentHookServer({ authenticate, onStatus: () => undefined, httpAudit: { ingest: input => { ingested.push(input) } }, now: () => 4242 })
    const port = await server.start()
    const record = { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'toolu_1', session_id: 'sess-1', tool_input: { command: 'curl https://a.test' } }
    await post(port, delivery(record))
    await settle()
    expect(ingested).toEqual([{ paneId: 'p1', workspaceId: 'ws-1', agent: 'claude-code', sessionId: 'sess-1', at: 4242, record }])
  })

  test('A59: an unauthenticated event never reaches the audit', async () => {
    const ingested: unknown[] = []
    server = new AgentHookServer({ authenticate, onStatus: () => undefined, httpAudit: { ingest: input => { ingested.push(input) } } })
    const port = await server.start()
    expect(await post(port, { ...delivery({ hook_event_name: 'PostToolUse' }), token: 'wrong' })).toBe(403)
    await settle()
    expect(ingested).toEqual([])
  })

  test('A59: a throwing audit never breaks the pane status, and the server keeps working', async () => {
    const statuses: AgentHookStatusEvent[] = []
    server = new AgentHookServer({ authenticate, onStatus: event => { statuses.push(event) }, httpAudit: { ingest: () => { throw new Error('disk full') } } })
    const port = await server.start()
    await post(port, delivery({ hook_event_name: 'UserPromptSubmit', session_id: 'sess-1' }))
    await post(port, delivery({ hook_event_name: 'Stop', session_id: 'sess-1' }))
    await settle()
    expect(statuses.map(status => status.state)).toEqual(['working', 'done'])
  })
})
