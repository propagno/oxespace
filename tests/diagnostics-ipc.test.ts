// @vitest-environment node
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  appEvents: new Map<string, (...args: unknown[]) => void>(),
  getAppMetrics: vi.fn(() => [
    { pid: 1, type: 'Browser', cpu: { percentCPUUsage: 1.25 }, memory: { workingSetSize: 150_000 } },
    { pid: 2, type: 'Tab', cpu: { percentCPUUsage: 3 }, memory: { workingSetSize: 220_000 } },
    { pid: 3, type: 'GPU', cpu: { percentCPUUsage: 0.5 }, memory: { workingSetSize: 90_000 } }
  ]),
  userData: ''
}))
vi.mock('electron', () => ({
  app: {
    getPath: () => hooks.userData, getVersion: () => '1.4.0', isPackaged: false, getAppMetrics: hooks.getAppMetrics,
    once: vi.fn(), on: (name: string, listener: (...args: unknown[]) => void) => hooks.appEvents.set(name, listener)
  },
  net: { isOnline: () => true },
  BrowserWindow: { fromWebContents: () => ({}), getAllWindows: () => [] },
  dialog: { showSaveDialog: vi.fn(async () => ({ canceled: true })) },
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => hooks.handlers.set(name, handler) }
}))
vi.mock('electron-log/main.js', () => ({ default: { transports: { file: { getFile: () => ({ path: join(hooks.userData, 'logs', 'main.log') }) } } } }))
vi.mock('../electron/main/db', () => ({ resolveAppDatabasePath: () => join(hooks.userData, 'oxespace.sqlite3') }))
vi.mock('../electron/main/updater', () => ({ getAppUpdateState: () => ({ preferences: { mode: 'auto', channel: 'stable', pinnedVersion: null } }) }))

import { installIncidentHooks, registerDiagnosticsIpc, resetDiagnosticsIpcForTests } from '../electron/main/ipc/diagnostics.ipc'
import { APP_READ_TOOLS } from '../electron/main/mcp-internal/app-read-tools'
import { incidentSubject } from '../electron/main/services/diagnostics/incident-sink'
import { IPC_CHANNELS } from '../shared/types/ipc'
import type { AppDatabase } from '../electron/main/db'
import type { InternalMcpHandle } from '../electron/main/mcp-internal/bootstrap'
import type { DiagnosticsService } from '../electron/main/services/diagnostics.service'
import type { DiagnosticsMetrics } from '../shared/types/diagnostics'

class Sender extends EventEmitter {
  readonly id = 7
  readonly mainFrame = {}
  destroyed = false
  readonly send = vi.fn()
  isDestroyed() { return this.destroyed }
}

const service = { getSnapshot: () => ({ generatedAt: 1, appVersion: '1.4.0', platform: 'win32', arch: 'x64', nodeVersion: '22', electronVersion: '44', workspaceCount: 1, checks: [] }) } as unknown as DiagnosticsService
let sender: Sender
const event = () => ({ sender, senderFrame: sender.mainFrame })
const call = (channel: string, ...args: unknown[]) => Promise.resolve(hooks.handlers.get(channel)!(event(), ...args))

beforeEach(() => {
  hooks.userData = mkdtempSync(join(tmpdir(), 'oxe-diag-ipc-'))
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(new Date('2026-10-30T12:00:00Z'))
  sender = new Sender()
  registerDiagnosticsIpc({} as AppDatabase, {} as InternalMcpHandle, {
    terminals: { counts: () => ({ running: 2, agents: 1 }) },
    mcp: { healthCounts: () => ({ total: 3, healthy: 2, quarantined: 1, failing: 0 }) }
  }, service)
})
afterEach(() => {
  vi.useRealTimers()
  resetDiagnosticsIpcForTests()
  hooks.handlers.clear(); hooks.appEvents.clear(); hooks.getAppMetrics.mockClear()
  if (dirname(resolve(hooks.userData)) !== resolve(tmpdir())) throw Error('Unsafe cleanup')
  rmSync(hooks.userData, { recursive: true, force: true })
})

describe('diagnostics measurement by subscription', () => {
  it('measures nothing and holds no timer without a subscription', async () => {
    await call(IPC_CHANNELS.diagnostics.incidents)
    await call(IPC_CHANNELS.diagnostics.unwatch, { subscriptionId: '00000000-0000-4000-8000-000000000000' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(hooks.getAppMetrics).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('sends metrics on its interval and stops on unwatch', async () => {
    const { subscriptionId } = await call(IPC_CHANNELS.diagnostics.watch, { intervalMs: 2_000 }) as { subscriptionId: string }
    expect(vi.getTimerCount()).toBe(1)
    await vi.waitFor(() => expect(sender.send).toHaveBeenCalledTimes(1))
    const [channel, metrics] = sender.send.mock.calls[0] as [string, DiagnosticsMetrics]
    expect(channel).toBe(IPC_CHANNELS.diagnostics.onMetrics)
    expect(metrics.processes.map(process => process.kind)).toEqual(['main', 'renderer', 'gpu'])
    expect(metrics.processes[0]).toMatchObject({ cpuPercent: 1.3, memoryBytes: 150_000 * 1024 })
    expect(metrics).toMatchObject({ terminals: { running: 2, agents: 1 }, gateway: null, mcpServers: { total: 3, quarantined: 1 }, connectivity: { state: 'online' } })
    expect(JSON.stringify(metrics)).not.toContain(hooks.userData.replace(/\\/g, '\\\\'))
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.waitFor(() => expect(sender.send).toHaveBeenCalledTimes(2))
    await call(IPC_CHANNELS.diagnostics.unwatch, { subscriptionId })
    expect(vi.getTimerCount()).toBe(0)
    const calls = hooks.getAppMetrics.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(hooks.getAppMetrics.mock.calls.length).toBe(calls)
  })

  it('stops when the window is destroyed or reloads, but not on an in-page navigation', async () => {
    await call(IPC_CHANNELS.diagnostics.watch)
    expect(vi.getTimerCount()).toBe(1)
    sender.destroyed = true
    sender.emit('destroyed')
    expect(vi.getTimerCount()).toBe(0)

    sender = new Sender()
    await call(IPC_CHANNELS.diagnostics.watch, { intervalMs: 30_000 })
    sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    expect(vi.getTimerCount()).toBe(1)
    sender.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
    expect(vi.getTimerCount()).toBe(1)
    sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    expect(vi.getTimerCount()).toBe(0)
    expect(sender.listenerCount('destroyed')).toBe(0)
  })

  it('validates input strictly', async () => {
    for (const input of [{ intervalMs: 1_999 }, { intervalMs: 30_001 }, { intervalMs: 2_500.5 }, { intervalMs: '5000' }, { intervalMs: 5_000, extra: 1 }, 'x', null]) {
      await expect(call(IPC_CHANNELS.diagnostics.watch, input), JSON.stringify(input)).rejects.toThrow()
    }
    await expect(call(IPC_CHANNELS.diagnostics.unwatch, { subscriptionId: 'nope' })).rejects.toThrow()
    await expect(call(IPC_CHANNELS.diagnostics.unwatch)).rejects.toThrow()
    await expect(call(IPC_CHANNELS.diagnostics.incidents, { limit: 0 })).rejects.toThrow()
    await expect(call(IPC_CHANNELS.diagnostics.incidents, { since: -1 })).rejects.toThrow()
    await expect(call(IPC_CHANNELS.diagnostics.incidents, { other: true })).rejects.toThrow('Unknown')
    await expect(call(IPC_CHANNELS.diagnostics.analysisSummary, { anything: 1 })).rejects.toThrow('no input')
    await expect(Promise.resolve(hooks.handlers.get(IPC_CHANNELS.diagnostics.analysisSummary)!({ sender, senderFrame: {} }))).rejects.toThrow('main frame')
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('diagnostics summary', () => {
  it('is the same text from the channel and from oxespace_diagnostics, within 4,000 characters', async () => {
    const tool = APP_READ_TOOLS.find(entry => entry.descriptor.name === 'oxespace_diagnostics')!
    const fromChannel = await call(IPC_CHANNELS.diagnostics.analysisSummary) as string
    const fromTool = await tool.handler({}, {} as never)
    expect(fromTool.isError).toBeFalsy()
    expect(fromTool.content).toEqual([{ type: 'text', text: fromChannel }])
    expect(fromChannel.length).toBeLessThanOrEqual(4_000)
    expect(fromChannel).toContain('# OXESpace diagnostics')
    expect(fromChannel).toContain('MCP servers: 3 total, 2 healthy, 1 quarantined, 0 failing')
    expect(vi.getTimerCount()).toBe(0) // a one-off measurement, no subscription left behind
  })
})

describe('recording points shared by the app', () => {
  it('records a throwing IPC handler and a crashed window without changing the error, and lists them', async () => {
    const target = { handle: (name: string, handler: (...args: unknown[]) => unknown) => hooks.handlers.set(name, handler) }
    const application = { on: (name: string, listener: (...args: unknown[]) => void) => hooks.appEvents.set(name, listener) }
    installIncidentHooks(target as never, application as never)
    target.handle('demo:fails', async () => { throw new Error('secret text from the person') })
    target.handle('demo:busy', () => { throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }) })
    target.handle('demo:works', () => 42)
    await expect(Promise.resolve(hooks.handlers.get('demo:fails')!({}))).rejects.toThrow('secret text from the person')
    expect(() => hooks.handlers.get('demo:busy')!({})).toThrow('database is locked')
    expect(hooks.handlers.get('demo:works')!({})).toBe(42)
    hooks.appEvents.get('render-process-gone')!({}, { getType: () => 'window' }, { reason: 'crashed' })
    hooks.appEvents.get('render-process-gone')!({}, { getType: () => 'window' }, { reason: 'clean-exit' })
    await vi.waitFor(async () => {
      const incidents = await call(IPC_CHANNELS.diagnostics.incidents) as Array<{ code: string; subject?: string }>
      expect(incidents.map(item => [item.code, item.subject]).sort()).toEqual([
        ['incident.database.busy', incidentSubject('demo:busy')],
        ['incident.ipc.handlerFailed', incidentSubject('demo:fails')],
        ['incident.window.crashed', incidentSubject('window')]
      ])
    })
    await call(IPC_CHANNELS.diagnostics.clearIncidents)
    expect(await call(IPC_CHANNELS.diagnostics.incidents)).toEqual([])
  })
})
