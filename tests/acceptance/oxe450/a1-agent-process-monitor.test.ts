// @vitest-environment node
// Frozen acceptance test for OXE-450 A1 (163-roadmap / F1): on-demand agent process tree monitoring,
// external agent read-only separation, Defender high-CPU diagnostic hint, and anonymous summary/bundle output.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'
import { buildBundle } from '../../../electron/main/services/diagnostics/bundle'
import { buildAnalysisSummary } from '../../../electron/main/services/diagnostics/summary'
import type { DiagnosticsMetrics } from '../../../shared/types/diagnostics'

async function load<T>(rel: string): Promise<T> {
  const file = join(process.cwd(), `${rel}.ts`)
  if (!existsSync(file)) throw new Error(`${rel}.ts does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

describe('OXE-450 A1 · agent process tree monitor and privacy boundary', () => {
  test('A1: groups managed chat, terminal, delegation, and automation process trees with descendant CPU and RAM totals', async () => {
    const { ManagedAgentProcessRegistry } = await load<typeof import('../../../electron/main/services/diagnostics/agent-process-registry')>('electron/main/services/diagnostics/agent-process-registry')
    const { collectAgentProcesses } = await load<typeof import('../../../electron/main/services/diagnostics/agent-processes')>('electron/main/services/diagnostics/agent-processes')

    const registry = new ManagedAgentProcessRegistry()
    const now = 1_700_000_000_000
    registry.register({ rootPid: 1000, provider: 'claude', kind: 'chat', contextId: 'thread:t-1', label: 'Payroll refactor chat', startedAt: now - 60_000, state: 'active' })
    // Idempotent re-registration updates metadata without creating duplicate tree entries.
    registry.register({ rootPid: 1000, provider: 'claude', kind: 'chat', contextId: 'thread:t-1', label: 'Payroll refactor chat', startedAt: now - 60_000, state: 'active' })
    registry.register({ rootPid: 2000, provider: 'codex', kind: 'terminal', contextId: 'pane:p-1', label: 'Code pane 1', startedAt: now - 120_000, state: 'idle', idleSinceMs: now - 30_000 })
    registry.register({ rootPid: 3000, provider: 'antigravity', kind: 'delegation', contextId: 'delegation:d-1', label: 'Delegated reviewer', startedAt: now - 45_000, state: 'active', priority: 'belowNormal' })
    registry.register({ rootPid: 4000, provider: 'claude', kind: 'automation', contextId: 'schedule:s-1', label: 'Nightly audit', startedAt: now - 15_000, state: 'idle', idleSinceMs: now - 10_000, priority: 'belowNormal' })

    const samples = [
      // Managed chat root 1000 + child 1001 + grandchild 1002
      { pid: 1000, ppid: 500, name: 'claude.exe', cpuPercent: 12.4, memoryBytes: 300 * 1024 * 1024 },
      { pid: 1001, ppid: 1000, name: 'node.exe', cpuPercent: 5.1, memoryBytes: 120 * 1024 * 1024 },
      { pid: 1002, ppid: 1001, name: 'rg.exe', cpuPercent: 2.5, memoryBytes: 30 * 1024 * 1024 },
      // Managed terminal root 2000 + child 2001
      { pid: 2000, ppid: 500, name: 'codex.exe', cpuPercent: 1.0, memoryBytes: 250 * 1024 * 1024 },
      { pid: 2001, ppid: 2000, name: 'mcp-server.exe', cpuPercent: 0.5, memoryBytes: 50 * 1024 * 1024 },
      // Managed delegation root 3000 (no children)
      { pid: 3000, ppid: 500, name: 'agy.exe', cpuPercent: 8.0, memoryBytes: 400 * 1024 * 1024 },
      // Managed automation root 4000 (no children)
      { pid: 4000, ppid: 500, name: 'claude.exe', cpuPercent: 0.2, memoryBytes: 150 * 1024 * 1024 }
    ]

    const snapshot = await collectAgentProcesses({
      registry,
      sampler: async () => samples,
      policy: { autoEcoBackground: true, idleReaperEnabled: true, idleTtlMinutes: 15, maxConcurrentAgents: 8 },
      now
    })

    expect(snapshot.managed).toHaveLength(4)
    const chatTree = snapshot.managed.find(tree => tree.rootPid === 1000)!
    expect(chatTree).toMatchObject({
      managed: true,
      provider: 'claude',
      kind: 'chat',
      contextId: 'thread:t-1',
      rootPid: 1000,
      childCount: 2,
      childPids: [1001, 1002],
      cpuPercent: 20,
      memoryBytes: 450 * 1024 * 1024,
      priority: 'normal',
      state: 'active',
      idleSinceMs: null
    })
    const terminalTree = snapshot.managed.find(tree => tree.rootPid === 2000)!
    expect(terminalTree).toMatchObject({ kind: 'terminal', childCount: 1, cpuPercent: 1.5, memoryBytes: 300 * 1024 * 1024, state: 'idle', idleSinceMs: now - 30_000 })
    expect(snapshot.managed.find(tree => tree.rootPid === 3000)).toMatchObject({ kind: 'delegation', priority: 'belowNormal' })
    expect(snapshot.managed.find(tree => tree.rootPid === 4000)).toMatchObject({ kind: 'automation', priority: 'belowNormal' })
    expect(snapshot.totals).toMatchObject({
      managedCount: 4,
      activeCount: 2,
      idleCount: 2,
      externalCount: 0,
      managedCpuPercent: 29.7,
      managedMemoryBytes: 1300 * 1024 * 1024
    })
  })

  test('A1: separates external agent processes as read-only and detects high antivirus CPU without mutating Defender', async () => {
    const { ManagedAgentProcessRegistry } = await load<typeof import('../../../electron/main/services/diagnostics/agent-process-registry')>('electron/main/services/diagnostics/agent-process-registry')
    const { collectAgentProcesses } = await load<typeof import('../../../electron/main/services/diagnostics/agent-processes')>('electron/main/services/diagnostics/agent-processes')

    const registry = new ManagedAgentProcessRegistry()
    registry.register({ rootPid: 1100, provider: 'claude', kind: 'chat', contextId: 'thread:owned', label: 'Owned chat', startedAt: 100, state: 'active' })

    const samples = [
      { pid: 1100, ppid: 500, name: 'claude.exe', cpuPercent: 4.0, memoryBytes: 200 * 1024 * 1024 },
      { pid: 1101, ppid: 1100, name: 'claude.exe', cpuPercent: 1.0, memoryBytes: 50 * 1024 * 1024 },
      // External agent processes outside OXESpace
      { pid: 9001, ppid: 1, name: 'agy.exe', cpuPercent: 18.2, memoryBytes: 600 * 1024 * 1024 },
      { pid: 9002, ppid: 1, name: 'codex', cpuPercent: 6.3, memoryBytes: 300 * 1024 * 1024 },
      { pid: 9003, ppid: 1, name: 'copilot.exe', cpuPercent: 2.1, memoryBytes: 120 * 1024 * 1024 },
      { pid: 9004, ppid: 1, name: 'Cursor.exe', cpuPercent: 9.4, memoryBytes: 450 * 1024 * 1024 },
      // Unrelated OS app should not appear as external agent
      { pid: 9099, ppid: 1, name: 'notepad.exe', cpuPercent: 0.1, memoryBytes: 10 * 1024 * 1024 },
      // Antivirus scanner exceeding 15% CPU
      { pid: 4444, ppid: 4, name: 'MsMpEng.exe', cpuPercent: 24.6, memoryBytes: 380 * 1024 * 1024 }
    ]

    const snapshot = await collectAgentProcesses({
      registry,
      sampler: async () => samples,
      policy: { autoEcoBackground: true, idleReaperEnabled: true, idleTtlMinutes: 15, maxConcurrentAgents: 8 },
      now: 200
    })

    expect(snapshot.managed).toHaveLength(1)
    expect(snapshot.managed[0].childPids).toEqual([1101])
    // Managed descendant 1101 must NOT be double-listed as external.
    expect(snapshot.external.map(item => item.pid).sort((a, b) => a - b)).toEqual([9001, 9002, 9003, 9004])
    expect(snapshot.external.every(item => item.managed === false)).toBe(true)
    expect(snapshot.antivirusHighCpu).toBe(true)
    expect(snapshot.antivirusCpuPercent).toBe(24.6)

    // When MsMpEng.exe is <= 15%, hint stays false/absent.
    const calm = await collectAgentProcesses({
      registry,
      sampler: async () => [{ pid: 4444, ppid: 4, name: 'MsMpEng.exe', cpuPercent: 9.2, memoryBytes: 200 * 1024 * 1024 }],
      policy: { autoEcoBackground: true, idleReaperEnabled: true, idleTtlMinutes: 15, maxConcurrentAgents: 8 },
      now: 300
    })
    expect(Boolean(calm.antivirusHighCpu)).toBe(false)
  })

  test('A1: keeps buildAnalysisSummary and buildBundle strictly anonymous without paths, titles, or arguments', async () => {
    const { collectMetrics } = await load<typeof import('../../../electron/main/services/diagnostics/metrics')>('electron/main/services/diagnostics/metrics')
    const secretLabel = 'Secret Payroll Merger C:\\Users\\alice\\clients\\secret-repo --api-key=sk-secret-999'

    const metrics = await collectMetrics({
      appMetrics: () => [{ pid: 10, type: 'Browser', cpu: { percentCPUUsage: 2 }, memory: { workingSetSize: 100_000 } }],
      storage: async () => ({ freeBytes: 50 * 1024 ** 3, diskTotalBytes: 100 * 1024 ** 3, databaseBytes: 4 * 1024 ** 2, logsBytes: 1024 ** 2 }),
      connectivity: () => ({ state: 'online', checkedAt: 1 }),
      clis: async () => [],
      accounts: () => [],
      mcpServers: () => ({ total: 1, healthy: 1, quarantined: 0, failing: 0 }),
      agentProcesses: async () => ({
        collectedAt: 1,
        managed: [{
          managed: true,
          rootPid: 7777,
          provider: 'claude',
          kind: 'chat',
          contextId: 'thread:secret-uuid-999',
          label: secretLabel,
          childCount: 2,
          childPids: [7778, 7779],
          cpuPercent: 14.5,
          memoryBytes: 512 * 1024 * 1024,
          priority: 'belowNormal',
          state: 'active',
          startedAt: 1,
          idleSinceMs: null,
          jobGoverned: false
        }],
        external: [{
          managed: false,
          pid: 8888,
          parentPid: 1,
          provider: 'codex',
          name: 'codex.exe',
          cpuPercent: 3.5,
          memoryBytes: 256 * 1024 * 1024
        }],
        totals: {
          managedCount: 1,
          activeCount: 1,
          idleCount: 0,
          externalCount: 1,
          managedCpuPercent: 14.5,
          managedMemoryBytes: 512 * 1024 * 1024,
          externalCpuPercent: 3.5,
          externalMemoryBytes: 256 * 1024 * 1024
        },
        antivirusHighCpu: true,
        antivirusCpuPercent: 19.4,
        policy: { autoEcoBackground: true, idleReaperEnabled: true, idleTtlMinutes: 15, maxConcurrentAgents: 8 }
      })
    } as never, 1) as DiagnosticsMetrics

    const summary = buildAnalysisSummary({
      incidents: [],
      metrics,
      version: '1.6.3',
      platform: 'win32',
      arch: 'x64',
      now: Date.UTC(2026, 10, 27)
    })

    expect(summary).toContain('managed agents: 1 (1 active, 0 idle)')
    expect(summary).toContain('external agents detected: 1')
    for (const forbidden of ['Secret Payroll', 'secret-repo', 'sk-secret-999', 'secret-uuid-999', 'alice']) {
      expect(summary).not.toContain(forbidden)
    }

    const bundle = await buildBundle({
      snapshot: () => ({ generatedAt: 1, appVersion: '1.6.3', platform: 'win32', arch: 'x64', nodeVersion: '22', electronVersion: '44', workspaceCount: 1, checks: [] }),
      metrics: async () => metrics,
      incidents: () => [],
      runtimeEvents: () => '',
      logFiles: () => [],
      readTail: async () => '',
      about: () => ({ version: '1.6.3' }),
      configuration: () => ({}),
      names: () => ['alice']
    })
    const snapshotText = bundle.entries.find(entry => entry.name === 'snapshot.json')!.data.toString('utf8')
    for (const forbidden of ['Secret Payroll', 'secret-repo', 'sk-secret-999', 'secret-uuid-999', 'alice']) {
      expect(snapshotText).not.toContain(forbidden)
    }
  })
})
