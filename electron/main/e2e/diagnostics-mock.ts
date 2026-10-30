/**
 * The B8.3 diagnostics channels in E2E runs: measurements only while a window is subscribed (stopped when it closes or
 * reloads), a journal seeded with two incidents, and fixed bundle and summary text. Nothing touches the disk.
 */
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { DIAGNOSTICS_LIMITS, type DiagnosticsIncident, type DiagnosticsMetrics } from '../../../shared/types/diagnostics'

export function registerDiagnosticsMock(): void {
  const watching = new Map<string, { sender: WebContents; timer: ReturnType<typeof setInterval> }>()
  const incidents: DiagnosticsIncident[] = [
    { id: 'i1', code: 'incident.mcp.quarantined', area: 'mcp', firstAt: 1, lastAt: 2, count: 2, subject: '3fa9c1d2' },
    { id: 'i2', code: 'incident.oxequery.timeout', area: 'oxequery', firstAt: 3, lastAt: 3, count: 1 }
  ]
  const metrics = (): DiagnosticsMetrics => ({
    at: Date.now(),
    processes: [{ kind: 'main', pid: 1, cpuPercent: 1.5, memoryBytes: 150e6 }, { kind: 'renderer', pid: 2, cpuPercent: 3, memoryBytes: 220e6 }, { kind: 'gpu', pid: 3, cpuPercent: 0.5, memoryBytes: 90e6 }],
    terminals: { running: 2, agents: 1 },
    system: { totalMemoryBytes: 16 * 1024 ** 3 },
    storage: { freeBytes: 120e9, diskTotalBytes: 512e9, databaseBytes: 8e6, logsBytes: 2e6 },
    connectivity: { state: 'online', checkedAt: Date.now() },
    gateway: null,
    clis: [{ id: 'claude', found: true, version: '2.0.0' }, { id: 'codex', found: false }],
    accounts: [{ provider: 'claude', signedIn: true }, { provider: 'codex', signedIn: false }],
    mcpServers: { total: 3, healthy: 2, quarantined: 1, failing: 0 }
  })
  const stop = (id: string) => {
    const entry = watching.get(id)
    if (entry) clearInterval(entry.timer)
    watching.delete(id)
  }

  ipcMain.handle(IPC_CHANNELS.diagnostics.watch, (event: IpcMainInvokeEvent, input?: { intervalMs?: unknown }) => {
    const requested = input?.intervalMs ?? DIAGNOSTICS_LIMITS.defaultIntervalMs
    if (typeof requested !== 'number' || requested < DIAGNOSTICS_LIMITS.minIntervalMs || requested > DIAGNOSTICS_LIMITS.maxIntervalMs) throw new Error('Invalid interval')
    const id = randomUUID(), sender = event.sender
    const send = () => { if (sender.isDestroyed()) stop(id); else sender.send(IPC_CHANNELS.diagnostics.onMetrics, metrics()) }
    watching.set(id, { sender, timer: setInterval(send, requested) })
    sender.once('destroyed', () => stop(id))
    sender.once('did-start-navigation', () => stop(id))
    setTimeout(send, 0)
    return { subscriptionId: id }
  })
  ipcMain.handle(IPC_CHANNELS.diagnostics.unwatch, (_event, input: { subscriptionId?: unknown }) => {
    if (typeof input?.subscriptionId !== 'string') throw new Error('Invalid subscription')
    stop(input.subscriptionId)
  })
  ipcMain.handle(IPC_CHANNELS.diagnostics.incidents, (_event, input?: { since?: unknown; limit?: unknown }) => {
    const since = typeof input?.since === 'number' ? input.since : 0
    const limit = typeof input?.limit === 'number' ? Math.min(Math.max(1, input.limit), DIAGNOSTICS_LIMITS.maxIncidentsPage) : DIAGNOSTICS_LIMITS.maxIncidentsPage
    return incidents.filter(incident => incident.lastAt >= since).slice(0, limit)
  })
  ipcMain.handle(IPC_CHANNELS.diagnostics.clearIncidents, (event: IpcMainInvokeEvent) => {
    incidents.splice(0)
    event.sender.send(IPC_CHANNELS.diagnostics.onIncidentsChanged, { count: 0 })
  })
  ipcMain.handle(IPC_CHANNELS.diagnostics.previewBundle, () => ({
    files: [
      { name: 'snapshot.json', bytes: 2048, summary: { code: 'bundle.file.snapshot', params: {} } },
      { name: 'incidents.json', bytes: 512, summary: { code: 'bundle.file.incidents', params: {} } },
      { name: 'main-log-tail.txt', bytes: 4096, summary: { code: 'bundle.file.logTail', params: {} } }
    ],
    redactions: 3
  }))
  ipcMain.handle(IPC_CHANNELS.diagnostics.exportBundle, () => null)
  ipcMain.handle(IPC_CHANNELS.diagnostics.analysisSummary, () => [
    '# OXESpace diagnostics', '', '## Incidents (30 days)',
    ...incidents.map(incident => `- ${incident.code} (${incident.area}): ${incident.count}`),
    '', '## Snapshot', '- Processes: main 150 MB, renderer 220 MB, gpu 90 MB', '- Storage: 120 GB free; database 8 MB; logs 2 MB'
  ].join('\n').slice(0, DIAGNOSTICS_LIMITS.maxSummaryChars))
}
