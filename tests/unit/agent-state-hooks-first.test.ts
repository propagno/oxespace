// @vitest-environment node
// Frozen acceptance test for 1.5.2 Desempenho (program 152perf, Jira OXE-123, A2 and A3). Written by the planner; the
// executor must not edit it. Red on main 8388aa419: AgentStateService creates an @xterm/headless PaneScreen as soon as a
// pane is identified as Claude Code, and feeds it every chunk even while the agent's hooks report its state.
// Contract (electron/main/services/agent-state/agent-state.service.ts):
// - an agent whose hooks answer (a hook arrived for the pane) gets its state only from them: no PaneScreen is created
//   for it and none is fed; a screen created while waiting is disposed the moment a hook arrives;
// - an agent with no hooks (copilot) reads the screen as before, and a hook-capable agent whose hooks stay silent for
//   10 s of terminal activity falls back to the screen, seeded with the output the pane already printed.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const screens = vi.hoisted(() => ({ created: 0, disposed: 0, writes: 0, live: new Set<object>(), text: '' }))

vi.mock('../../electron/main/services/agent-state/screen', () => ({
  PaneScreen: class {
    constructor() { screens.created += 1; screens.live.add(this) }
    write(): Promise<void> { if (screens.live.has(this)) screens.writes += 1; return Promise.resolve() }
    get busy(): boolean { return false }
    resize(): void { /* no view */ }
    read() { return { screen: screens.text, oscTitle: '', oscProgress: '' } }
    dispose(): void { screens.disposed += 1; screens.live.delete(this) }
  }
}))

import { loadManifests } from '../../electron/main/services/agent-state/manifest'
import { AgentStateService, type PaneAgentState } from '../../electron/main/services/agent-state/agent-state.service'

const { manifests } = loadManifests('resources/agent-detection')
const MB = 'x'.repeat(1024)

function make(history: string | null = null) {
  const events: Array<PaneAgentState | { cleared: true }> = []
  const seeded: string[] = []
  const service = new AgentStateService({
    manifests: () => manifests,
    emit: event => events.push(event as PaneAgentState),
    history: paneId => { seeded.push(paneId); return history }
  })
  return { service, events, seeded }
}

beforeEach(() => {
  vi.useFakeTimers()
  screens.created = 0; screens.disposed = 0; screens.writes = 0; screens.live.clear(); screens.text = ''
})
afterEach(() => { vi.useRealTimers() })

describe('OXE-123 · agent state from hooks first, the screen only as the fallback', () => {
  test('skips allocating or feeding @xterm/headless when lifecycle hooks are active for the pane', async () => {
    const { service } = make()
    service.start('p1', 'w1', 120, 40, 'claude')
    service.hook('p1', 'claude', 'working')
    for (let i = 0; i < 1024; i += 1) service.output('p1', MB)
    await vi.advanceTimersByTimeAsync(15_000)
    for (let i = 0; i < 1024; i += 1) service.output('p1', MB)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(screens.created, 'no screen for a pane whose hooks answer').toBe(0)
    expect(screens.writes).toBe(0)
    expect(service.get('p1')).toMatchObject({ agent: 'claude', state: 'working', source: 'hook' })
    service.hook('p1', 'claude', 'waiting')
    expect(service.get('p1')).toMatchObject({ state: 'blocked', source: 'hook' })

    // A pane that fell back to the screen while its hooks were silent drops it the moment a hook arrives.
    screens.text = '✻ Thinking… (3s · esc to interrupt)'
    service.start('p2', 'w1', 120, 40, 'claude')
    service.output('p2', 'starting')
    await vi.advanceTimersByTimeAsync(10_500)
    service.output('p2', MB)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(screens.created).toBe(1)
    service.hook('p2', 'claude', 'working')
    expect(screens.disposed, 'the fallback screen is disposed on the first hook').toBe(1)
    const writes = screens.writes
    for (let i = 0; i < 64; i += 1) service.output('p2', MB)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(screens.writes, 'nothing feeds a disposed screen').toBe(writes)
    expect(screens.live.size).toBe(0)
    expect(service.get('p2')).toMatchObject({ state: 'working', source: 'hook' })
  })

  test('falls back to @xterm/headless screen detection when agent has no hooks or hook handshake times out', async () => {
    screens.text = '✻ Thinking… (3s · esc to interrupt)'
    const { service, seeded } = make('earlier output')

    // No hooks at all: the screen is read as today.
    service.start('c1', 'w1', 120, 40, 'copilot')
    service.output('c1', 'hello')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(screens.created).toBe(1)
    expect(service.get('c1')?.source).toBe('screen')

    // Hook-capable but silent: no screen while the handshake window is open, then the seeded fallback.
    service.start('p3', 'w1', 120, 40, 'claude')
    service.output('p3', 'starting')
    await vi.advanceTimersByTimeAsync(5_000)
    service.output('p3', MB)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(screens.created, 'still waiting for the hooks').toBe(1)
    await vi.advanceTimersByTimeAsync(5_000)
    service.output('p3', MB)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(screens.created, 'the fallback screen after 10 s without a hook').toBe(2)
    expect(seeded).toContain('p3')
    expect(service.get('p3')).toMatchObject({ agent: 'claude', state: 'working', source: 'screen' })
  })
})
