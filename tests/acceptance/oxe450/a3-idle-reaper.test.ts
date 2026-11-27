// @vitest-environment node
// Frozen acceptance test for OXE-450 A3 (163-roadmap / F1): AgentIdleReaper gracefully closes idle managed
// ACP/CLI sessions past TTL while preserving nativeSessionId for transparent resume, never reaping active/held sessions.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, test, vi } from 'vitest'

async function load<T>(rel: string): Promise<T> {
  const file = join(process.cwd(), `${rel}.ts`)
  if (!existsSync(file)) throw new Error(`${rel}.ts does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

const MIN = 60_000

describe('OXE-450 A3 · AgentIdleReaper preserving nativeSessionId', () => {
  test('A3: AgentIdleReaper gracefully closes idle managed ACP/CLI sessions past TTL while preserving nativeSessionId', async () => {
    const { ManagedAgentProcessRegistry } = await load<typeof import('../../../electron/main/services/diagnostics/agent-process-registry')>('electron/main/services/diagnostics/agent-process-registry')
    const { AgentIdleReaper } = await load<typeof import('../../../electron/main/services/diagnostics/agent-idle-reaper')>('electron/main/services/diagnostics/agent-idle-reaper')

    const registry = new ManagedAgentProcessRegistry()
    const now = 1_700_000_000_000
    const threadSessions = new Map<string, { nativeSessionId: string; processAlive: boolean }>([
      ['thread:stale', { nativeSessionId: 'native-sess-stale-001', processAlive: true }],
      ['thread:fresh', { nativeSessionId: 'native-sess-fresh-002', processAlive: true }]
    ])

    const staleHibernate = vi.fn(async () => {
      const state = threadSessions.get('thread:stale')!
      state.processAlive = false
      // nativeSessionId remains intact for transparent resume on the next turn
      return true
    })
    const freshHibernate = vi.fn(async () => true)

    registry.register({
      rootPid: 8100,
      provider: 'antigravity',
      kind: 'chat',
      contextId: 'thread:stale',
      label: 'Stale ACP chat',
      startedAt: now - 30 * MIN,
      state: 'idle',
      idleSinceMs: now - 16 * MIN,
      nativeSessionId: 'native-sess-stale-001',
      hibernate: staleHibernate
    })
    registry.register({
      rootPid: 8101,
      provider: 'claude',
      kind: 'chat',
      contextId: 'thread:fresh',
      label: 'Fresh idle chat',
      startedAt: now - 20 * MIN,
      state: 'idle',
      idleSinceMs: now - 14 * MIN,
      nativeSessionId: 'native-sess-fresh-002',
      hibernate: freshHibernate
    })

    const reaper = new AgentIdleReaper({
      registry,
      getPolicy: () => ({ autoEcoBackground: true, idleReaperEnabled: true, idleTtlMinutes: 15, maxConcurrentAgents: 8 })
    })

    const report = await reaper.sweep(now)
    expect(staleHibernate).toHaveBeenCalledTimes(1)
    expect(freshHibernate).not.toHaveBeenCalled()
    expect(report.reaped).toHaveLength(1)
    expect(report.reaped[0]).toMatchObject({
      rootPid: 8100,
      contextId: 'thread:stale',
      provider: 'antigravity',
      nativeSessionId: 'native-sess-stale-001'
    })
    expect(registry.has(8100)).toBe(false)
    expect(registry.has(8101)).toBe(true)
    expect(threadSessions.get('thread:stale')).toEqual({
      nativeSessionId: 'native-sess-stale-001',
      processAlive: false
    })
  })

  test('A3: respects disabled toggle and TTL 0 and never reaps active or held sessions', async () => {
    const { ManagedAgentProcessRegistry } = await load<typeof import('../../../electron/main/services/diagnostics/agent-process-registry')>('electron/main/services/diagnostics/agent-process-registry')
    const { AgentIdleReaper } = await load<typeof import('../../../electron/main/services/diagnostics/agent-idle-reaper')>('electron/main/services/diagnostics/agent-idle-reaper')

    const registry = new ManagedAgentProcessRegistry()
    const now = 1_700_000_000_000
    const activeHibernate = vi.fn(async () => true)
    const heldHibernate = vi.fn(async () => true)
    const idleHibernate = vi.fn(async () => true)

    registry.register({
      rootPid: 8200,
      provider: 'claude',
      kind: 'chat',
      contextId: 'thread:active',
      label: 'Running turn',
      startedAt: now - 60 * MIN,
      state: 'active',
      idleSinceMs: null,
      hibernate: activeHibernate
    })
    registry.register({
      rootPid: 8201,
      provider: 'codex',
      kind: 'chat',
      contextId: 'thread:held',
      label: 'Waiting approval',
      startedAt: now - 60 * MIN,
      state: 'idle',
      idleSinceMs: now - 45 * MIN,
      isHeld: () => true,
      hibernate: heldHibernate
    })
    registry.register({
      rootPid: 8202,
      provider: 'claude',
      kind: 'chat',
      contextId: 'thread:idle',
      label: 'Idle session',
      startedAt: now - 60 * MIN,
      state: 'idle',
      idleSinceMs: now - 45 * MIN,
      hibernate: idleHibernate
    })

    // Disabled toggle skips everything
    const disabledReaper = new AgentIdleReaper({
      registry,
      getPolicy: () => ({ autoEcoBackground: true, idleReaperEnabled: false, idleTtlMinutes: 15, maxConcurrentAgents: 8 })
    })
    expect((await disabledReaper.sweep(now)).reaped).toEqual([])
    expect(idleHibernate).not.toHaveBeenCalled()

    // TTL = 0 skips everything
    const zeroTtlReaper = new AgentIdleReaper({
      registry,
      getPolicy: () => ({ autoEcoBackground: true, idleReaperEnabled: true, idleTtlMinutes: 0, maxConcurrentAgents: 8 })
    })
    expect((await zeroTtlReaper.sweep(now)).reaped).toEqual([])
    expect(idleHibernate).not.toHaveBeenCalled()

    // Enabled with 15 min TTL reaps ONLY the unheld idle session
    const enabledReaper = new AgentIdleReaper({
      registry,
      getPolicy: () => ({ autoEcoBackground: true, idleReaperEnabled: true, idleTtlMinutes: 15, maxConcurrentAgents: 8 })
    })
    const report = await enabledReaper.sweep(now)
    expect(report.reaped.map(item => item.rootPid)).toEqual([8202])
    expect(activeHibernate).not.toHaveBeenCalled()
    expect(heldHibernate).not.toHaveBeenCalled()
    expect(registry.has(8200)).toBe(true)
    expect(registry.has(8201)).toBe(true)
    expect(registry.has(8202)).toBe(false)
  })
})
