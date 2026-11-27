// @vitest-environment node
// Frozen acceptance test for OXE-450 A4 (163-roadmap / F1): guarded killTree with Job Object seam,
// strict refusal of external/unmanaged PIDs, and forbidden MCP coverage boundary.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, test, vi } from 'vitest'
import { TOOL_REGISTRY } from '../../../electron/main/mcp-internal/tool-registry'
import { FORBIDDEN_CAPABILITIES, MCP_COVERAGE } from '../../../shared/mcp-coverage'
import { IPC_CHANNELS } from '../../../shared/types/ipc'

async function load<T>(rel: string): Promise<T> {
  const file = join(process.cwd(), `${rel}.ts`)
  if (!existsSync(file)) throw new Error(`${rel}.ts does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

describe('OXE-450 A4 · killTree and renderer-only security boundary', () => {
  test('A4: killTree terminates managed root and verified descendants without orphans and invokes Job Object close seam', async () => {
    const { ManagedAgentProcessRegistry } = await load<typeof import('../../../electron/main/services/diagnostics/agent-process-registry')>('electron/main/services/diagnostics/agent-process-registry')
    const { AgentProcessController } = await load<typeof import('../../../electron/main/services/diagnostics/agent-process-control')>('electron/main/services/diagnostics/agent-process-control')

    const registry = new ManagedAgentProcessRegistry()
    const stopSpy = vi.fn(async () => undefined)
    registry.register({ rootPid: 9100, provider: 'claude', kind: 'terminal', contextId: 'pane:9', label: 'Pane 9', startedAt: 1, state: 'active', stop: stopSpy })

    const killTreeSpy = vi.fn(async () => undefined)
    const closeGovernanceSpy = vi.fn(async () => true)
    const controller = new AgentProcessController({
      registry,
      sampler: async () => [
        { pid: 9100, ppid: 500, name: 'claude.exe', cpuPercent: 10, memoryBytes: 250e6 },
        { pid: 9101, ppid: 9100, name: 'node.exe', cpuPercent: 5, memoryBytes: 120e6 },
        { pid: 9102, ppid: 9101, name: 'subagent.exe', cpuPercent: 4, memoryBytes: 80e6 }
      ],
      getPolicy: () => ({ autoEcoBackground: true, idleReaperEnabled: true, idleTtlMinutes: 15, maxConcurrentAgents: 8 }),
      killTree: killTreeSpy,
      governance: { closeGovernance: closeGovernanceSpy }
    })

    const result = await controller.killTree(9100)
    expect(result).toMatchObject({
      ok: true,
      rootPid: 9100,
      terminatedPids: [9100, 9101, 9102]
    })
    expect(closeGovernanceSpy).toHaveBeenCalledWith(9100)
    expect(stopSpy).toHaveBeenCalledTimes(1)
    expect(killTreeSpy).toHaveBeenCalledWith(9100)
    expect(registry.has(9100)).toBe(false)
  })

  test('A4: strictly refuses external or unmanaged PIDs across setPriority, hibernate, and killTree', async () => {
    const { ManagedAgentProcessRegistry } = await load<typeof import('../../../electron/main/services/diagnostics/agent-process-registry')>('electron/main/services/diagnostics/agent-process-registry')
    const { AgentProcessController } = await load<typeof import('../../../electron/main/services/diagnostics/agent-process-control')>('electron/main/services/diagnostics/agent-process-control')

    const registry = new ManagedAgentProcessRegistry()
    const setPrioritySpy = vi.fn()
    const killTreeSpy = vi.fn(async () => undefined)
    const closeGovernanceSpy = vi.fn(async () => true)

    const controller = new AgentProcessController({
      registry,
      sampler: async () => [
        { pid: 9999, ppid: 1, name: 'agy.exe', cpuPercent: 30, memoryBytes: 900e6 }
      ],
      getPolicy: () => ({ autoEcoBackground: true, idleReaperEnabled: true, idleTtlMinutes: 15, maxConcurrentAgents: 8 }),
      setOsPriority: setPrioritySpy,
      killTree: killTreeSpy,
      governance: { closeGovernance: closeGovernanceSpy }
    })

    const prioRes = await controller.setPriority(9999, 'belowNormal')
    expect(prioRes.ok).toBe(false)
    expect(prioRes.appliedPids).toEqual([])

    const hibRes = await controller.hibernate(9999)
    expect(hibRes.ok).toBe(false)

    const killRes = await controller.killTree(9999)
    expect(killRes.ok).toBe(false)

    expect(setPrioritySpy).not.toHaveBeenCalled()
    expect(killTreeSpy).not.toHaveBeenCalled()
    expect(closeGovernanceSpy).not.toHaveBeenCalled()
  })

  test('A4: declares diagnostics.agentProcesses as forbidden in shared/mcp-coverage.ts with zero MCP tool reachability', () => {
    const channel = (IPC_CHANNELS.diagnostics as Record<string, string>).agentProcesses
    expect(channel).toBe('diagnostics:agent-processes')
    expect((FORBIDDEN_CAPABILITIES as readonly string[])).toContain('diagnostics.agent_processes')

    const entry = MCP_COVERAGE['diagnostics.agent_processes']
    expect(entry).toBeDefined()
    expect('forbidden' in entry).toBe(true)
    expect('tools' in entry).toBe(false)
    expect(entry.ipc).toContain('diagnostics.agentProcesses')

    // Zero MCP tools mention agentProcesses or killTree
    expect(TOOL_REGISTRY.some(tool => /agent_?process|kill_?tree|set_?priority/i.test(JSON.stringify(tool.descriptor)))).toBe(false)

    const doc = readFileSync(join(process.cwd(), 'docs/validation/mcp-coverage-1.4.md'), 'utf8')
    expect(doc).toContain('`diagnostics.agent_processes`')
  })
})
