// @vitest-environment node
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentIdleReaper } from '../../electron/main/services/diagnostics/agent-idle-reaper'
import { AgentProcessPolicyStore } from '../../electron/main/services/diagnostics/agent-process-policy'
import { ManagedAgentProcessRegistry } from '../../electron/main/services/diagnostics/agent-process-registry'
import { removeTempDir } from '../helpers/removeTempDir'

const MIN = 60_000
const tempDirs: string[] = []

afterEach(() => {
  vi.useRealTimers()
  for (const dir of tempDirs.splice(0)) removeTempDir(dir)
})

describe('AgentIdleReaper integration (OXE-450 CA-3)', () => {
  it('reaps idle ACP/CLI sessions past TTL while keeping nativeSessionId intact for resume', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oxe450-reaper-'))
    tempDirs.push(dir)
    const policyStore = new AgentProcessPolicyStore(join(dir, 'agent-process-policy.json'))
    await policyStore.load()

    const registry = new ManagedAgentProcessRegistry()
    const now = 1_700_000_000_000
    const persistedNativeSessions = new Map<string, string>([
      ['thread:acp-1', 'acp-session-123'],
      ['thread:claude-1', 'claude-session-456'],
      ['thread:codex-1', 'codex-session-789']
    ])
    const closedContexts: string[] = []

    registry.register({
      rootPid: 10_100,
      provider: 'antigravity',
      kind: 'chat',
      contextId: 'thread:acp-1',
      label: 'Antigravity ACP',
      state: 'idle',
      idleSinceMs: now - 20 * MIN,
      nativeSessionId: persistedNativeSessions.get('thread:acp-1')
    })
    registry.register({
      rootPid: 10_101,
      provider: 'claude',
      kind: 'chat',
      contextId: 'thread:claude-1',
      label: 'Claude chat',
      state: 'idle',
      idleSinceMs: now - 15 * MIN,
      nativeSessionId: persistedNativeSessions.get('thread:claude-1')
    })
    registry.register({
      rootPid: 10_102,
      provider: 'codex',
      kind: 'chat',
      contextId: 'thread:codex-1',
      label: 'Codex active',
      state: 'active',
      idleSinceMs: null,
      nativeSessionId: persistedNativeSessions.get('thread:codex-1')
    })

    const reaper = new AgentIdleReaper({
      registry,
      getPolicy: () => policyStore.get(),
      hibernateManaged: async entry => {
        closedContexts.push(entry.contextId)
        return true
      }
    })

    const report = await reaper.sweep(now)
    expect(report.reaped.map(item => item.rootPid).sort((a, b) => a - b)).toEqual([10_100, 10_101])
    expect(closedContexts).toEqual(['thread:acp-1', 'thread:claude-1'])
    // nativeSessionId preserved in thread state for transparent next-turn resume
    expect(persistedNativeSessions.get('thread:acp-1')).toBe('acp-session-123')
    expect(persistedNativeSessions.get('thread:claude-1')).toBe('claude-session-456')
    expect(registry.has(10_100)).toBe(false)
    expect(registry.has(10_101)).toBe(false)
    expect(registry.has(10_102)).toBe(true)
  })

  it('honors runtime policy updates and clean start/stop interval lifecycle', async () => {
    vi.useFakeTimers()
    const now = 1_700_000_000_000
    vi.setSystemTime(now)

    const dir = mkdtempSync(join(tmpdir(), 'oxe450-reaper-timer-'))
    tempDirs.push(dir)
    const policyStore = new AgentProcessPolicyStore(join(dir, 'agent-process-policy.json'))
    await policyStore.update({ idleReaperEnabled: true, idleTtlMinutes: 5 })

    const registry = new ManagedAgentProcessRegistry()
    const hibernate = vi.fn(async () => true)
    registry.register({
      rootPid: 10_200,
      provider: 'claude',
      kind: 'chat',
      contextId: 'thread:timer-1',
      label: 'Timer chat',
      state: 'idle',
      idleSinceMs: now - 4 * MIN,
      hibernate
    })

    const reaper = new AgentIdleReaper({
      registry,
      getPolicy: () => policyStore.get(),
      sweepIntervalMs: 30_000
    })

    reaper.start()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(hibernate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(hibernate).toHaveBeenCalledTimes(1))
    reaper.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
