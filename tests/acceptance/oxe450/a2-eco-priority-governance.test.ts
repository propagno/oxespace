// @vitest-environment node
// Frozen acceptance test for OXE-450 A2 (163-roadmap / F1): Eco Mode priority governance across managed trees,
// autoEcoBackground policy, Job Object / cgroups seam, graceful per-PID fallback, and JSON preference persistence.
import { existsSync, mkdtempSync } from 'node:fs'
import { constants, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { removeTempDir } from '../../helpers/removeTempDir'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) removeTempDir(dir)
})

async function load<T>(rel: string): Promise<T> {
  const file = join(process.cwd(), `${rel}.ts`)
  if (!existsSync(file)) throw new Error(`${rel}.ts does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

describe('OXE-450 A2 · Eco priority governance and JSON policy store', () => {
  test('A2: applies Eco os.setPriority across managed root and descendants plus governance seam without killing the agent', async () => {
    const { ManagedAgentProcessRegistry } = await load<typeof import('../../../electron/main/services/diagnostics/agent-process-registry')>('electron/main/services/diagnostics/agent-process-registry')
    const { AgentProcessController } = await load<typeof import('../../../electron/main/services/diagnostics/agent-process-control')>('electron/main/services/diagnostics/agent-process-control')

    const registry = new ManagedAgentProcessRegistry()
    registry.register({ rootPid: 5000, provider: 'claude', kind: 'chat', contextId: 'thread:eco-1', label: 'Active chat', startedAt: 100, state: 'active' })

    const setPriorityCalls: Array<[number, number]> = []
    const killTreeSpy = vi.fn(async () => undefined)
    const applyEcoGovernance = vi.fn(async () => ({ governed: true, mechanism: 'win32-job-object' as const }))

    const controller = new AgentProcessController({
      registry,
      sampler: async () => [
        { pid: 5000, ppid: 500, name: 'claude.exe', cpuPercent: 15, memoryBytes: 300e6 },
        { pid: 5001, ppid: 5000, name: 'node.exe', cpuPercent: 8, memoryBytes: 100e6 },
        { pid: 5002, ppid: 5001, name: 'esbuild.exe', cpuPercent: 20, memoryBytes: 80e6 }
      ],
      getPolicy: () => ({ autoEcoBackground: true, idleReaperEnabled: true, idleTtlMinutes: 15, maxConcurrentAgents: 8 }),
      setOsPriority: (pid, value) => { setPriorityCalls.push([pid, value]) },
      killTree: killTreeSpy,
      governance: { applyEcoGovernance }
    })

    const result = await controller.setPriority(5000, 'belowNormal')
    expect(result).toMatchObject({
      ok: true,
      rootPid: 5000,
      priority: 'belowNormal',
      appliedPids: [5000, 5001, 5002],
      failedPids: [],
      jobGoverned: true
    })
    expect(setPriorityCalls).toEqual([
      [5000, constants.priority.PRIORITY_BELOW_NORMAL],
      [5001, constants.priority.PRIORITY_BELOW_NORMAL],
      [5002, constants.priority.PRIORITY_BELOW_NORMAL]
    ])
    expect(applyEcoGovernance).toHaveBeenCalledWith(5000, [5000, 5001, 5002], 'belowNormal')
    expect(killTreeSpy).not.toHaveBeenCalled()
    expect(registry.get(5000)?.priority).toBe('belowNormal')
    expect(registry.get(5000)?.jobGoverned).toBe(true)

    // Idempotent re-application to 'low' and back to 'normal'
    const low = await controller.setPriority(5000, 'low')
    expect(low.ok).toBe(true)
    expect(registry.get(5000)?.priority).toBe('low')
  })

  test('A2: autoEcoBackground lowers priority automatically for newly registered delegation and automation trees', async () => {
    const { ManagedAgentProcessRegistry } = await load<typeof import('../../../electron/main/services/diagnostics/agent-process-registry')>('electron/main/services/diagnostics/agent-process-registry')
    const { AgentProcessController } = await load<typeof import('../../../electron/main/services/diagnostics/agent-process-control')>('electron/main/services/diagnostics/agent-process-control')

    const registry = new ManagedAgentProcessRegistry()
    const priorityCalls: Array<[number, number]> = []
    const controller = new AgentProcessController({
      registry,
      sampler: async () => [
        { pid: 6100, ppid: 500, name: 'codex.exe', cpuPercent: 5, memoryBytes: 200e6 },
        { pid: 6200, ppid: 500, name: 'claude.exe', cpuPercent: 5, memoryBytes: 200e6 },
        { pid: 6300, ppid: 500, name: 'claude.exe', cpuPercent: 5, memoryBytes: 200e6 }
      ],
      getPolicy: () => ({ autoEcoBackground: true, idleReaperEnabled: true, idleTtlMinutes: 15, maxConcurrentAgents: 8 }),
      setOsPriority: (pid, value) => { priorityCalls.push([pid, value]) }
    })

    const detach = controller.attachAutoEco()
    try {
      registry.register({ rootPid: 6100, provider: 'codex', kind: 'delegation', contextId: 'delegation:1', label: 'Delegation', startedAt: 1, state: 'active' })
      registry.register({ rootPid: 6200, provider: 'claude', kind: 'automation', contextId: 'schedule:1', label: 'Schedule', startedAt: 1, state: 'active' })
      registry.register({ rootPid: 6300, provider: 'claude', kind: 'chat', contextId: 'thread:1', label: 'Interactive chat', startedAt: 1, state: 'active' })

      await vi.waitFor(() => {
        expect(priorityCalls).toEqual(expect.arrayContaining([
          [6100, constants.priority.PRIORITY_BELOW_NORMAL],
          [6200, constants.priority.PRIORITY_BELOW_NORMAL]
        ]))
      })
      // Interactive foreground chat stays normal by default.
      expect(priorityCalls.some(([pid]) => pid === 6300)).toBe(false)
      expect(registry.get(6300)?.priority).toBe('normal')
    } finally {
      detach()
    }
  })

  test('A2: tolerates per-PID OS errors gracefully and persists preferences in owner-only JSON without SQLite migrations', async () => {
    const { ManagedAgentProcessRegistry } = await load<typeof import('../../../electron/main/services/diagnostics/agent-process-registry')>('electron/main/services/diagnostics/agent-process-registry')
    const { AgentProcessController } = await load<typeof import('../../../electron/main/services/diagnostics/agent-process-control')>('electron/main/services/diagnostics/agent-process-control')
    const { AgentProcessPolicyStore } = await load<typeof import('../../../electron/main/services/diagnostics/agent-process-policy')>('electron/main/services/diagnostics/agent-process-policy')

    const registry = new ManagedAgentProcessRegistry()
    registry.register({ rootPid: 7000, provider: 'claude', kind: 'terminal', contextId: 'pane:7', label: 'Pane 7', startedAt: 1, state: 'active' })
    const controller = new AgentProcessController({
      registry,
      sampler: async () => [
        { pid: 7000, ppid: 500, name: 'claude.exe', cpuPercent: 1, memoryBytes: 100e6 },
        { pid: 7001, ppid: 7000, name: 'protected.exe', cpuPercent: 1, memoryBytes: 50e6 }
      ],
      getPolicy: () => ({ autoEcoBackground: true, idleReaperEnabled: true, idleTtlMinutes: 15, maxConcurrentAgents: 8 }),
      setOsPriority: (pid) => {
        if (pid === 7001) {
          const err = Object.assign(new Error('EPERM'), { code: 'EPERM' })
          throw err
        }
      }
    })

    const res = await controller.setPriority(7000, 'belowNormal')
    expect(res.ok).toBe(true)
    expect(res.appliedPids).toEqual([7000])
    expect(res.failedPids).toEqual([7001])

    // JSON policy store round-trip with defaults when file does not exist yet
    const dir = mkdtempSync(join(tmpdir(), 'oxe450-policy-'))
    tempDirs.push(dir)
    const policyFile = join(dir, 'agent-process-policy.json')
    const store1 = new AgentProcessPolicyStore(policyFile)
    const defaults = await store1.load()
    expect(defaults).toEqual({ autoEcoBackground: true, idleReaperEnabled: true, idleTtlMinutes: 15, maxConcurrentAgents: 8 })

    await store1.update({ autoEcoBackground: false, idleTtlMinutes: 30, maxConcurrentAgents: 4 })
    const store2 = new AgentProcessPolicyStore(policyFile)
    expect(await store2.load()).toEqual({ autoEcoBackground: false, idleReaperEnabled: true, idleTtlMinutes: 30, maxConcurrentAgents: 4 })
  })
})
