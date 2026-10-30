import { describe, expect, it, vi } from 'vitest'
import { createOxeApi, type PreloadIpc } from '../electron/preload/api'
import { MCP_COVERAGE } from '../shared/mcp-coverage'
import { isMessageCode } from '../shared/messages'
import { DIAGNOSTICS_AREAS, DIAGNOSTICS_INCIDENT_CODES, DIAGNOSTICS_LIMITS } from '../shared/types/diagnostics'
import { IPC_CHANNELS } from '../shared/types/ipc'

describe('diagnostics contract (B8.3)', () => {
  it('uses stable channel names next to the existing ones', () => {
    expect(IPC_CHANNELS.diagnostics).toEqual({
      getSnapshot: 'diagnostics:get-snapshot', exportReport: 'diagnostics:export-report', reportInteractive: 'diagnostics:report-interactive',
      buildIssueReport: 'diagnostics:build-issue-report', recordFirstAnswer: 'diagnostics:record-first-answer',
      watch: 'diagnostics:watch', unwatch: 'diagnostics:unwatch', onMetrics: 'diagnostics:metrics', incidents: 'diagnostics:incidents',
      clearIncidents: 'diagnostics:clear-incidents', onIncidentsChanged: 'diagnostics:incidents-changed', previewBundle: 'diagnostics:preview-bundle',
      exportBundle: 'diagnostics:export-bundle', analysisSummary: 'diagnostics:analysis-summary'
    })
  })

  it('gives every incident kind a message code and a known area', () => {
    for (const [code, area] of Object.entries(DIAGNOSTICS_INCIDENT_CODES)) {
      expect(isMessageCode(code), code).toBe(true)
      expect(DIAGNOSTICS_AREAS, code).toContain(area)
      expect(code.startsWith(`incident.${area}.`), code).toBe(true)
    }
    expect(Object.keys(DIAGNOSTICS_INCIDENT_CODES)).toContain('incident.app.journalReset')
  })

  it('keeps the bounds the item sets', () => {
    expect(DIAGNOSTICS_LIMITS.incidentRetentionMs).toBe(30 * 24 * 60 * 60 * 1000)
    expect(DIAGNOSTICS_LIMITS.maxIncidents).toBe(500)
    expect(DIAGNOSTICS_LIMITS.maxJournalBytes).toBe(256 * 1024)
    expect(DIAGNOSTICS_LIMITS.maxSummaryChars).toBe(4000)
    expect(DIAGNOSTICS_LIMITS.minIntervalMs).toBeLessThanOrEqual(DIAGNOSTICS_LIMITS.defaultIntervalMs)
    expect(DIAGNOSTICS_LIMITS.defaultIntervalMs).toBeLessThanOrEqual(DIAGNOSTICS_LIMITS.maxIntervalMs)
  })

  it('reads the journal through the diagnostics tool and keeps everything else with the window', () => {
    const read = MCP_COVERAGE['diagnostics.read']
    expect('tools' in read && read.tools).toEqual({ oxespace_diagnostics: 'read' })
    expect(read.ipc).toEqual(['diagnostics.incidents'])
    const settings = MCP_COVERAGE['settings.diagnostics']
    expect('excluded' in settings).toBe(true)
    for (const channel of ['watch', 'unwatch', 'clearIncidents', 'previewBundle', 'exportBundle', 'analysisSummary']) expect(settings.ipc, channel).toContain(`diagnostics.${channel}`)
  })

  it('exposes the new calls through the preload', async () => {
    const ipc: PreloadIpc = { invoke: vi.fn().mockResolvedValue(undefined), on: vi.fn(), removeListener: vi.fn() }
    const diagnostics = createOxeApi(ipc).diagnostics
    await diagnostics.watch!()
    await diagnostics.watch!({ intervalMs: 10_000 })
    await diagnostics.unwatch!({ subscriptionId: 's' })
    await diagnostics.incidents!({ limit: 20 })
    await diagnostics.clearIncidents!()
    await diagnostics.previewBundle!()
    await diagnostics.exportBundle!()
    await diagnostics.analysisSummary!()
    expect(vi.mocked(ipc.invoke).mock.calls).toEqual([
      [IPC_CHANNELS.diagnostics.watch, {}], [IPC_CHANNELS.diagnostics.watch, { intervalMs: 10_000 }], [IPC_CHANNELS.diagnostics.unwatch, { subscriptionId: 's' }],
      [IPC_CHANNELS.diagnostics.incidents, { limit: 20 }], [IPC_CHANNELS.diagnostics.clearIncidents], [IPC_CHANNELS.diagnostics.previewBundle],
      [IPC_CHANNELS.diagnostics.exportBundle], [IPC_CHANNELS.diagnostics.analysisSummary]
    ])
    diagnostics.onMetrics!(vi.fn())
    diagnostics.onIncidentsChanged!(vi.fn())
    expect(vi.mocked(ipc.on).mock.calls.map(call => call[0])).toEqual([IPC_CHANNELS.diagnostics.onMetrics, IPC_CHANNELS.diagnostics.onIncidentsChanged])
  })
})
