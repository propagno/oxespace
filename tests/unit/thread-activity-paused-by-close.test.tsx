import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deriveThreadActivity } from '../../src/components/Threads/deriveThreadActivity'
import { NowLine } from '../../src/components/Threads/NowLine'
import type { ThreadEvent, ThreadSnapshot } from '../../shared/types/thread'

const turn: ThreadEvent[] = [
  { type: 'message', id: 'turn-1', role: 'user', text: 'Refactor the price module' },
  { type: 'message', id: 'a1', role: 'assistant', text: 'Reading the module' }
]

function interrupted(settled: ThreadEvent): ThreadSnapshot {
  return {
    thread: { id: 'thread', workspaceId: 'ws', projectId: 'p', rootPath: '/repo', provider: 'claude', title: 'T', status: 'interrupted', lastTurnStatus: 'interrupted', createdAt: 1, updatedAt: 2 },
    events: [...turn, settled],
    turns: [{ id: 'turn-1', status: 'interrupted', startedAt: 1, completedAt: 2 }]
  } as unknown as ThreadSnapshot
}

afterEach(cleanup)

describe("the status line for an MCP server's request (CHAT-15)", () => {
  const waiting = (title: string) => {
    const snapshot = { ...interrupted({ type: 'completed', status: 'completed' }), thread: { id: 'thread', workspaceId: 'ws', projectId: 'p', rootPath: '/repo', provider: 'codex', title: 'T', status: 'approval', createdAt: 1, updatedAt: 2 }, turns: [{ id: 'turn-1', status: 'running', startedAt: 1 }] } as unknown as ThreadSnapshot
    const ask = { id: 'mcp', nativeId: 'mcp', nativeMethod: 'mcpServer/elicitation/request', kind: 'elicitation' as const, title, detail: 'Allow the server to run a tool?', generation: 1, createdAt: 7, state: 'pending' as const }
    return deriveThreadActivity(snapshot, [ask])
  }

  it('names the server it comes from, not "asks to" and the server', () => {
    const activity = waiting('oxespace-delegation')
    expect(activity).toEqual({ kind: 'needs-you', at: 7, requestId: 'mcp', reason: 'mcp', text: 'oxespace-delegation' })
    const { container } = render(<NowLine activity={activity!} agent="Codex" onAction={vi.fn()} />)
    expect(container).toHaveTextContent('Needs you. Codex has a request from oxespace-delegation.')
    expect(container).not.toHaveTextContent('asks to')
  })

  it('without a server name it says the agent waits for an answer', () => {
    const activity = waiting('MCP input required')
    expect(activity).toEqual({ kind: 'needs-you', at: 7, requestId: 'mcp', reason: 'mcp' })
    const { container } = render(<NowLine activity={activity!} agent="Codex" onAction={vi.fn()} />)
    expect(container).toHaveTextContent('Needs you. Codex is waiting for your answer.')
  })
})

describe('the status line for a plan to review (CHAT-7)', () => {
  it('has its own words, whatever the agent called the request', () => {
    const snapshot = { ...interrupted({ type: 'completed', status: 'completed' }), thread: { id: 'thread', workspaceId: 'ws', projectId: 'p', rootPath: '/repo', provider: 'claude', title: 'T', status: 'approval', createdAt: 1, updatedAt: 2 }, turns: [{ id: 'turn-1', status: 'running', startedAt: 1 }] } as unknown as ThreadSnapshot
    const plan = { id: 'plan', nativeId: 'plan', nativeMethod: 'can_use_tool:ExitPlanMode', kind: 'approval' as const, title: 'Aprovar o plano?', detail: '# Plan', generation: 1, createdAt: 5, state: 'pending' as const }
    const activity = deriveThreadActivity(snapshot, [plan])
    expect(activity).toEqual({ kind: 'needs-you', at: 5, requestId: 'plan', reason: 'plan' })
    const { container } = render(<NowLine activity={activity!} agent="Claude" onAction={vi.fn()} />)
    expect(container).toHaveTextContent('Needs you. Claude asks you to review its plan.')
    expect(container).not.toHaveTextContent('aprovar')
  })
})

describe('the status line of a paused conversation says who paused it (CHAT-1)', () => {
  it('a turn the person stopped: "You stopped it"', () => {
    const activity = deriveThreadActivity(interrupted({ type: 'completed', status: 'interrupted' }), [])
    expect(activity).toEqual({ kind: 'paused', at: 2 })
    const { container } = render(<NowLine activity={activity!} agent="Claude" onAction={vi.fn()} />)
    expect(container).toHaveTextContent('Paused. You stopped it. Send a message to continue.')
  })

  it('a turn the app cut short when it closed: it says so, as the note under the turn does', () => {
    const activity = deriveThreadActivity(interrupted({ type: 'completed', status: 'interrupted', error: 'OXESpace closed before this turn completed.' }), [])
    expect(activity).toEqual({ kind: 'paused', at: 2, reason: 'app-closed' })
    const { container } = render(<NowLine activity={activity!} agent="Claude" onAction={vi.fn()} />)
    expect(container).toHaveTextContent('Paused. OXESpace closed before this turn finished. Send a message to continue.')
    expect(container).not.toHaveTextContent('You stopped it')
  })
})
