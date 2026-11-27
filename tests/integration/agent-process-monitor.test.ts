// @vitest-environment node
import { mkdtempSync } from 'node:fs'
import { constants, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentProcessController } from '../../electron/main/services/diagnostics/agent-process-control'
import { AgentProcessPolicyStore } from '../../electron/main/services/diagnostics/agent-process-policy'
import { ManagedAgentProcessRegistry } from '../../electron/main/services/diagnostics/agent-process-registry'
import {
  collectAgentProcesses,
  parsePosixPsOutput,
  parseWindowsProcessJson,
  sampleOsProcesses
} from '../../electron/main/services/diagnostics/agent-processes'
import { removeTempDir } from '../helpers/removeTempDir'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) removeTempDir(dir)
})

describe('Agent process monitor and governance integration (OXE-450 CA-1, CA-2, CA-4)', () => {
  it('parses both POSIX ps output and Windows CIM JSON safely', async () => {
    const posix = parsePosixPsOutput([
      ' 1200  500  12.5  102400 claude',
      ' 1201 1200   3.2   51200 node',
      ' invalid line',
      ' 9001    1  18.0  204800 agy'
    ].join('\n'))
    expect(posix).toEqual([
      { pid: 1200, ppid: 500, name: 'claude', cpuPercent: 12.5, memoryBytes: 102400 * 1024 },
      { pid: 1201, ppid: 1200, name: 'node', cpuPercent: 3.2, memoryBytes: 51200 * 1024 },
      { pid: 9001, ppid: 1, name: 'agy', cpuPercent: 18, memoryBytes: 204800 * 1024 }
    ])

    const win = parseWindowsProcessJson(JSON.stringify([
      { pid: 2200, ppid: 100, name: 'codex.exe', cpuPercent: 40, memoryBytes: 300_000_000 },
      { pid: 4444, ppid: 4, name: 'MsMpEng.exe', cpuPercent: 80, memoryBytes: 400_000_000 }
    ]), 4)
    expect(win).toEqual([
      { pid: 2200, ppid: 100, name: 'codex.exe', cpuPercent: 10, memoryBytes: 300_000_000 },
      { pid: 4444, ppid: 4, name: 'MsMpEng.exe', cpuPercent: 20, memoryBytes: 400_000_000 }
    ])

    // Malformed output degrades cleanly to []
    expect(parseWindowsProcessJson('not-json')).toEqual([])
    expect(await sampleOsProcesses({ platform: 'linux', exec: async () => '' })).toEqual([])
  })

  it('aggregates managed trees, enforces Eco priority, kills managed trees cleanly, and refuses external processes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oxe450-monitor-'))
    tempDirs.push(dir)
    const policyStore = new AgentProcessPolicyStore(join(dir, 'agent-process-policy.json'))
    const policy = await policyStore.load()
    const registry = new ManagedAgentProcessRegistry()

    const stopFn = vi.fn(async () => undefined)
    registry.register({
      rootPid: 3000,
      provider: 'claude',
      kind: 'chat',
      contextId: 'thread:int-1',
      label: 'Claude chat',
      state: 'active',
      stop: stopFn
    })

    const samples = [
      { pid: 3000, ppid: 500, name: 'claude.exe', cpuPercent: 10.5, memoryBytes: 300e6 },
      { pid: 3001, ppid: 3000, name: 'node.exe', cpuPercent: 4.5, memoryBytes: 120e6 },
      { pid: 9500, ppid: 1, name: 'codex.exe', cpuPercent: 7.0, memoryBytes: 250e6 }
    ]

    const snap = await collectAgentProcesses({ registry, sampler: async () => samples, policy, now: 1000 })
    expect(snap.managed).toHaveLength(1)
    expect(snap.managed[0]).toMatchObject({ rootPid: 3000, childCount: 1, cpuPercent: 15, memoryBytes: 420e6 })
    expect(snap.external).toHaveLength(1)
    expect(snap.external[0]).toMatchObject({ pid: 9500, managed: false, provider: 'codex' })

    const prioCalls: Array<[number, number]> = []
    const killFn = vi.fn(async () => undefined)
    const controller = new AgentProcessController({
      registry,
      sampler: async () => samples,
      getPolicy: () => policyStore.get(),
      setOsPriority: (pid, val) => { prioCalls.push([pid, val]) },
      killTree: killFn
    })

    const eco = await controller.setPriority(3000, 'belowNormal')
    expect(eco.ok).toBe(true)
    expect(prioCalls).toEqual([
      [3000, constants.priority.PRIORITY_BELOW_NORMAL],
      [3001, constants.priority.PRIORITY_BELOW_NORMAL]
    ])

    // External process cannot be altered or killed
    expect((await controller.setPriority(9500, 'low')).ok).toBe(false)
    expect((await controller.killTree(9500)).ok).toBe(false)
    expect(killFn).not.toHaveBeenCalled()

    // Managed tree kill terminates cleanly and unregisters root
    const killed = await controller.killTree(3000)
    expect(killed).toMatchObject({ ok: true, rootPid: 3000, terminatedPids: [3000, 3001] })
    expect(stopFn).toHaveBeenCalledTimes(1)
    expect(killFn).toHaveBeenCalledWith(3000)
    expect(registry.has(3000)).toBe(false)
  })
})
