// @vitest-environment node
import { homedir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import type { DiagnosticsSnapshot } from '../shared/types/diagnostics'

vi.mock('electron', () => ({ app: { getVersion: () => '1.4.0', getPath: () => '' } }))

const { buildIssueReport, recentRuntimeEvents } = await import('../electron/main/services/issue-report')

const snapshot: DiagnosticsSnapshot = {
  generatedAt: 1, appVersion: '1.4.0', platform: 'win32', arch: 'x64', nodeVersion: '24.0.0', electronVersion: '44.9.3', workspaceCount: 2,
  checks: [
    { id: 'database', label: 'SQLite', tone: 'ok', detail: 'ok' },
    { id: 'mcp', label: 'Internal MCP', tone: 'error', detail: 'token=ghp_abcdefghijklmnopqrstuvwxyz0123456789 failed' }
  ]
}

describe('issue report', () => {
  it('carries the version, the system and the health checks without their details', () => {
    const report = buildIssueReport({ snapshot, runtimeEvents: 'boot ok', osDescription: 'Windows 11 10.0.26200' })
    expect(report.title).toBe('[Bug] ')
    expect(report.body).toContain('- OXESpace: 1.4.0')
    expect(report.body).toContain('- System: Windows 11 10.0.26200 (win32 x64)')
    expect(report.body).toContain('- Electron 44.9.3, Node 24.0.0')
    expect(report.body).toContain('- SQLite: ok')
    expect(report.body).toContain('- Internal MCP: error')
    expect(report.body).not.toContain('ghp_')
    expect(report.body).toContain('## Steps to reproduce')
  })

  it('removes secrets and the home folder from the runtime events', () => {
    const home = homedir()
    const log = [`opened ${home}/project`, 'Authorization: Bearer abcdefghijklmnop', 'key sk-ant-abcdefghijklmnopqrstuvwxyz', 'password=hunter2', 'plain line'].join('\n')
    const report = buildIssueReport({ snapshot, runtimeEvents: log, osDescription: 'Linux' })
    expect(report.body).not.toContain(home)
    expect(report.body).not.toContain('abcdefghijklmnop')
    expect(report.body).not.toContain('hunter2')
    expect(report.body).toContain('plain line')
    expect(report.diagnosticLines).toBe(5)
  })

  it('keeps the newest lines when the log is long and caps very long lines', () => {
    const lines = Array.from({ length: 500 }, (_, index) => `event ${index}`)
    const recent = recentRuntimeEvents(lines.join('\n'))
    expect(recent.length).toBeLessThanOrEqual(40)
    expect(recent.at(-1)).toBe('event 499')
    expect(recentRuntimeEvents('y'.repeat(2_000))[0]).toHaveLength(400)
  })

  it('reports an empty log plainly', () => {
    const report = buildIssueReport({ snapshot: { ...snapshot, checks: [] }, runtimeEvents: '', osDescription: 'Linux' })
    expect(report.body).toContain('(none)')
    expect(report.body).toContain('No health checks reported')
    expect(report.diagnosticLines).toBe(0)
  })
})
