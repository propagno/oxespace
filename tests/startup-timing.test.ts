// @vitest-environment node
import { EventEmitter } from 'node:events'
import { performance } from 'node:perf_hooks'
import { beforeEach, expect, it, vi } from 'vitest'
import { createFakeIpcMain } from './helpers/fake-ipc-main'

const ipc = createFakeIpcMain()
const recorded: Array<{ event: string; detail: Record<string, unknown> }> = []
vi.mock('electron', () => ({ ipcMain: ipc }))
vi.mock('../electron/main/ipc/ipc-guards', () => ({ requireAppFrame: () => undefined }))
vi.mock('../electron/main/services/runtime-diagnostics', () => ({
  recordRuntime: (event: string, detail: Record<string, unknown>) => recorded.push({ event, detail })
}))

const { markAppReady, measureStartup, trackWindowStartup } = await import('../electron/main/startup-timing')
const { IPC_CHANNELS } = await import('../shared/types/ipc')

beforeEach(() => { recorded.length = 0; performance.clearMeasures() })

it('times sync and async phases without touching their results', async () => {
  expect(measureStartup('window-create', () => 42)).toBe(42)
  await expect(measureStartup('ipc-handlers', async () => { await new Promise(resolve => setTimeout(resolve, 20)); return 'ok' })).resolves.toBe('ok')
  expect(recorded.map(item => item.detail.phase)).toEqual(['window-create', 'ipc-handlers'])
  expect(recorded.every(item => item.event === 'startup-phase')).toBe(true)
  expect(Number(recorded[1].detail.durationMs)).toBeGreaterThanOrEqual(15)
  expect(performance.getEntriesByName('oxe:ipc-handlers', 'measure')).toHaveLength(1)
})

it('still records a phase whose async work fails', async () => {
  await expect(measureStartup('ipc-handlers', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
  expect(recorded).toEqual([expect.objectContaining({ detail: expect.objectContaining({ phase: 'ipc-handlers' }) })])
})

it('measures ready-to-show and interactive from process start, the first report only', async () => {
  markAppReady()
  const window = new EventEmitter() as unknown as import('electron').BrowserWindow
  expect(trackWindowStartup(window)).toBe(window)
  // The channel is already taken, as a catch-all mock would find it.
  expect(() => ipc.handle(IPC_CHANNELS.diagnostics.reportInteractive, () => null)).toThrow()
  ;(window as unknown as EventEmitter).emit('ready-to-show')
  await ipc.invoke(IPC_CHANNELS.diagnostics.reportInteractive)
  await ipc.invoke(IPC_CHANNELS.diagnostics.reportInteractive)
  expect(recorded.map(item => item.detail.phase)).toEqual(['app-ready', 'ready-to-show', 'interactive'])
  const interactive = performance.getEntriesByName('oxe:interactive', 'measure')[0]
  expect(interactive.startTime).toBe(0)
  // A second window (macOS reactivation) registers nothing twice.
  expect(() => trackWindowStartup(new EventEmitter() as unknown as import('electron').BrowserWindow)).not.toThrow()
})
