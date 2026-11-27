// @vitest-environment jsdom
// Frozen acceptance test for OXE-450 A5 (163-roadmap / F1): zero idle OS process polling when Diagnostics is closed,
// Settings -> Diagnostics AgentProcessesSection UI lifecycle/actions/confirmation/external read-only/Defender hint,
// preload contract, and EN/pt-BR settings locale parity.
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { MetricsWatcher } from '../../../electron/main/services/diagnostics/watcher'
import { createOxeApi, type PreloadIpc } from '../../../electron/preload/api'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AgentProcessesSnapshot, DiagnosticsMetrics } from '../../../shared/types/diagnostics'
import { changeLanguage } from '../../../src/i18n'

async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

class FakeSender extends EventEmitter {
  readonly id = 11
  destroyed = false
  readonly send = vi.fn()
  isDestroyed() { return this.destroyed }
}

const SAMPLE_SNAPSHOT: AgentProcessesSnapshot = {
  collectedAt: 1_700_000_000_000,
  managed: [
    {
      managed: true,
      rootPid: 3001,
      provider: 'claude',
      kind: 'chat',
      contextId: 'thread:active-1',
      label: 'Active thread',
      childCount: 2,
      childPids: [3002, 3003],
      cpuPercent: 18.5,
      memoryBytes: 640 * 1024 * 1024,
      priority: 'normal',
      state: 'active',
      startedAt: 1_699_999_900_000,
      idleSinceMs: null,
      jobGoverned: false
    },
    {
      managed: true,
      rootPid: 3101,
      provider: 'codex',
      kind: 'terminal',
      contextId: 'pane:idle-1',
      label: 'Idle pane',
      childCount: 0,
      childPids: [],
      cpuPercent: 0.4,
      memoryBytes: 512 * 1024 * 1024,
      priority: 'belowNormal',
      state: 'idle',
      startedAt: 1_699_999_000_000,
      idleSinceMs: 1_699_999_400_000,
      jobGoverned: true
    }
  ],
  external: [
    {
      managed: false,
      pid: 9501,
      parentPid: 1,
      provider: 'agy',
      name: 'agy.exe',
      cpuPercent: 12.1,
      memoryBytes: 720 * 1024 * 1024
    }
  ],
  totals: {
    managedCount: 2,
    activeCount: 1,
    idleCount: 1,
    externalCount: 1,
    managedCpuPercent: 18.9,
    managedMemoryBytes: 1152 * 1024 * 1024,
    externalCpuPercent: 12.1,
    externalMemoryBytes: 720 * 1024 * 1024
  },
  antivirusHighCpu: true,
  antivirusCpuPercent: 22.3,
  policy: {
    autoEcoBackground: true,
    idleReaperEnabled: true,
    idleTtlMinutes: 15,
    maxConcurrentAgents: 8
  }
}

afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  await changeLanguage('en')
})

describe('OXE-450 A5 · on-demand polling, Diagnostics UI, preload, and i18n', () => {
  test('A5: executes zero OS process sampling when MetricsWatcher has no active subscribers', async () => {
    vi.useFakeTimers()
    const { collectMetrics } = await load<typeof import('../../../electron/main/services/diagnostics/metrics')>('electron/main/services/diagnostics/metrics')
    const sampler = vi.fn(async () => SAMPLE_SNAPSHOT)
    const watcher = new MetricsWatcher(
      () => collectMetrics({
        appMetrics: () => [],
        storage: async () => ({ freeBytes: null, diskTotalBytes: null, databaseBytes: 0, logsBytes: 0 }),
        connectivity: () => ({ state: 'online', checkedAt: 1 }),
        clis: async () => [],
        accounts: () => [],
        agentProcesses: sampler
      }),
      IPC_CHANNELS.diagnostics.onMetrics
    )

    // Closed state: advancing timers triggers zero sampling.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sampler).not.toHaveBeenCalled()

    // Open state: subscribing triggers immediate on-demand sample, unwatching stops all polling.
    const sender = new FakeSender()
    const subId = watcher.watch(sender, 5_000)
    await vi.waitFor(() => expect(sampler).toHaveBeenCalledTimes(1))
    watcher.unwatch(subId, sender)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(sampler).toHaveBeenCalledTimes(1)
  })

  test('A5: AgentProcessesSection subscribes on mount, unsubscribes on unmount, confirms active Stop tree, and renders read-only external agents and Defender hint', async () => {
    const { AgentProcessesSection } = await load<{ AgentProcessesSection: () => ReturnType<typeof createElement> }>('src/components/Settings/AgentProcessesSection')
    let metricsListener: ((metrics: DiagnosticsMetrics) => void) | null = null
    const unwatch = vi.fn(async () => undefined)
    const watch = vi.fn(async () => ({ subscriptionId: '11111111-1111-4111-8111-111111111111' }))
    const onMetrics = vi.fn((listener: (metrics: DiagnosticsMetrics) => void) => {
      metricsListener = listener
      return () => { metricsListener = null }
    })
    const agentProcesses = vi.fn(async (req: { op: string; [key: string]: unknown }) => {
      if (req.op === 'snapshot') return SAMPLE_SNAPSHOT
      if (req.op === 'setPolicy') return { ...SAMPLE_SNAPSHOT.policy, ...(req.policy as object) }
      if (req.op === 'setPriority') return { ok: true, rootPid: req.rootPid, priority: req.priority, appliedPids: [req.rootPid], failedPids: [], jobGoverned: false }
      if (req.op === 'hibernate') return { ok: true, rootPid: req.rootPid }
      if (req.op === 'killTree') return { ok: true, rootPid: req.rootPid, terminatedPids: [req.rootPid] }
      return SAMPLE_SNAPSHOT
    })

    Object.assign(window, {
      oxe: {
        ...(window as unknown as { oxe?: object }).oxe,
        diagnostics: { watch, unwatch, onMetrics, agentProcesses }
      }
    })

    const { unmount } = render(createElement(AgentProcessesSection))

    await waitFor(() => expect(watch).toHaveBeenCalledTimes(1))
    expect(await screen.findByTestId('agent-processes-summary')).toBeInTheDocument()
    expect(screen.getByTestId('agent-processes-antivirus-hint')).toBeInTheDocument()

    const managedTable = screen.getByTestId('agent-processes-managed-table')
    expect(within(managedTable).getByText('3001')).toBeInTheDocument()
    expect(within(managedTable).getByText('3101')).toBeInTheDocument()

    // External agents table is strictly read-only (no control buttons inside it)
    const externalTable = screen.getByTestId('agent-processes-external-table')
    expect(within(externalTable).getByText('9501')).toBeInTheDocument()
    expect(within(externalTable).queryAllByRole('button')).toHaveLength(0)

    // Clicking Stop on active tree 3001 opens ConfirmDialog before sending killTree
    const activeRow = within(managedTable).getByText('3001').closest('tr') as HTMLElement
    const stopBtn = within(activeRow).getByRole('button', { name: /stop/i })
    await userEvent.click(stopBtn)
    expect(agentProcesses).not.toHaveBeenCalledWith(expect.objectContaining({ op: 'killTree' }))

    const dialog = await screen.findByRole('dialog')
    const confirmBtn = within(dialog).getByRole('button', { name: /stop/i })
    await userEvent.click(confirmBtn)
    await waitFor(() => {
      expect(agentProcesses).toHaveBeenCalledWith({ op: 'killTree', rootPid: 3001 })
    })

    // Live metrics push updates without crashing
    metricsListener?.({
      at: Date.now(),
      processes: [],
      terminals: { running: 1, agents: 1 },
      system: { totalMemoryBytes: 16 * 1024 ** 3 },
      storage: { freeBytes: null, diskTotalBytes: null, databaseBytes: 0, logsBytes: 0 },
      connectivity: { state: 'online', checkedAt: 1 },
      gateway: null,
      clis: [],
      accounts: [],
      mcpServers: { total: 0, healthy: 0, quarantined: 0, failing: 0 },
      agentProcesses: SAMPLE_SNAPSHOT
    })

    unmount()
    await waitFor(() => expect(unwatch).toHaveBeenCalledWith({ subscriptionId: '11111111-1111-4111-8111-111111111111' }))
  })

  test('A5: exposes diagnostics.agentProcesses through preload and keeps EN/pt-BR settings locale parity', async () => {
    const ipc: PreloadIpc = { invoke: vi.fn().mockResolvedValue(SAMPLE_SNAPSHOT), on: vi.fn(), removeListener: vi.fn() }
    const api = createOxeApi(ipc)
    await api.diagnostics.agentProcesses!({ op: 'snapshot' })
    expect(ipc.invoke).toHaveBeenCalledWith((IPC_CHANNELS.diagnostics as Record<string, string>).agentProcesses, { op: 'snapshot' })

    const en = JSON.parse(readFileSync(join(process.cwd(), 'shared/locales/en/settings.json'), 'utf8')) as { diagnostics?: { agentProcesses?: Record<string, unknown> } }
    const pt = JSON.parse(readFileSync(join(process.cwd(), 'shared/locales/pt-BR/settings.json'), 'utf8')) as { diagnostics?: { agentProcesses?: Record<string, unknown> } }
    expect(en.diagnostics?.agentProcesses).toBeDefined()
    expect(pt.diagnostics?.agentProcesses).toBeDefined()
  })
})
